import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';

import { createDatabase, V1_STORES, V2_STORES } from '@/db/db';
import { checksumOf } from '@/lib/checksum';
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  countsOf,
  exportBackup,
  importBackupText,
  type BackupDataV1,
  type BackupDataV2,
} from '@/services/backup';

/**
 * S8 升级/回滚演练。
 *
 * 真正的「手工演练」需要在浏览器里用 rescue 工具导出、删库、再导入，
 * 而本会话禁止启动服务、禁止访问真实 IndexedDB。这里用 fake-indexeddb
 * 复刻同一组状态迁移，覆盖 T12 的数据层部分：
 *   A 升级：v1 八表有数据 → v2 十一表，计数不变、deletedAt 齐备、新表为空；
 *   B 失败后重试：upgrade 抛错 → 库仍是 v1 → 用生产声明重新打开可成功升级；
 *   C 回滚：用升级前的 v1 备份导入空库 → 八表恢复、三张新表为空、migratedFrom=1；
 *   D 往返：升级后导出 v2 备份 → 空库导入 → 十一表计数与关键字段一致。
 */

const opened: Dexie[] = [];
const names = new Set<string>();

function nextName(): string {
  const name = `test-db-drill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  names.add(name);
  return name;
}

afterEach(async () => {
  for (const database of opened.splice(0)) {
    database.close();
  }
  for (const name of names) {
    await Dexie.delete(name);
  }
  names.clear();
});

const timestamp = '2026-11-01T09:00:00.000Z';

function makeTask(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `任务 ${id}`,
    description: '',
    projectId: 'p-1',
    status: 'todo',
    priority: 'medium',
    planDate: '2026-11-02',
    dueDate: null,
    completedAt: null,
    parentId: null,
    tags: ['t-1'],
    note: '',
    archivedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

/** v1 的八表快照：升级前先读出来，供场景 C 构造 v1 备份。 */
interface V1Snapshot {
  projects: unknown[];
  tags: unknown[];
  tasks: unknown[];
  dailyPlans: unknown[];
  workLogs: unknown[];
  reports: unknown[];
  settings: unknown[];
  meta: unknown[];
}

async function seedV1(name: string): Promise<{ v1: Dexie; snapshot: V1Snapshot }> {
  const v1 = new Dexie(name);
  v1.version(1).stores(V1_STORES);
  opened.push(v1);
  await v1.open();

  await v1.table('projects').bulkPut([
    {
      id: 'p-1',
      name: '项目一',
      description: '',
      status: 'active',
      startDate: '2026-11-01',
      endDate: null,
      tags: ['t-1'],
      progressMode: 'auto',
      manualProgress: null,
      milestones: [],
      risks: [],
      archivedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ]);
  await v1
    .table('tags')
    .bulkPut([{ id: 't-1', name: '标签一', color: '#2563eb', kind: 'task', createdAt: timestamp }]);
  await v1
    .table('tasks')
    .bulkPut([makeTask('task-1'), makeTask('task-2', { status: 'done', completedAt: timestamp })]);
  await v1.table('dailyPlans').bulkPut([
    {
      date: '2026-11-02',
      taskIds: ['task-1'],
      extras: ['补充事项'],
      note: '',
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ]);
  await v1.table('workLogs').bulkPut([
    {
      id: 'log-1',
      date: '2026-11-02',
      title: '日志一',
      content: '内容',
      insight: '',
      problem: '',
      solution: '',
      projectId: 'p-1',
      taskId: 'task-1',
      tags: ['t-1'],
      taskTitleSnapshot: '任务 task-1',
      projectNameSnapshot: '项目一',
      searchText: '日志一 内容',
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ]);
  await v1.table('reports').bulkPut([
    {
      id: 'report-1',
      kind: 'day',
      periodStart: '2026-11-02',
      periodEnd: '2026-11-02',
      generatedAt: timestamp,
      metrics: { planned: 1 },
      body: '日报',
      isEdited: false,
      isSnapshot: false,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ]);
  await v1.table('settings').bulkPut([
    {
      key: 'app-settings',
      value: { weekStart: 1, theme: 'system', backupReminderDays: 7 },
    },
  ]);
  await v1.table('meta').bulkPut([{ key: 'lastOpenedAt', value: timestamp }]);

  const snapshot: V1Snapshot = {
    projects: await v1.table('projects').toArray(),
    tags: await v1.table('tags').toArray(),
    tasks: await v1.table('tasks').toArray(),
    dailyPlans: await v1.table('dailyPlans').toArray(),
    workLogs: await v1.table('workLogs').toArray(),
    reports: await v1.table('reports').toArray(),
    settings: await v1.table('settings').toArray(),
    meta: await v1.table('meta').toArray(),
  };
  return { v1, snapshot };
}

const V1_TABLE_COUNTS = {
  projects: 1,
  tags: 1,
  tasks: 2,
  dailyPlans: 1,
  workLogs: 1,
  reports: 1,
  settings: 1,
  meta: 1,
} as const;

describe('S8 演练 A：v1 八表升级到 v2 十一表', () => {
  it('计数不变、deletedAt 齐备、新表为空、索引可查', async () => {
    const name = nextName();
    const { v1 } = await seedV1(name);
    v1.close();

    const database = createDatabase(name);
    opened.push(database);
    await database.open();

    expect(database.tables.map((table) => table.name).sort()).toEqual(
      [
        'dailyPlans',
        'longTaskExceptions',
        'longTaskRuleVersions',
        'longTasks',
        'meta',
        'projects',
        'reports',
        'settings',
        'tags',
        'tasks',
        'workLogs',
      ].sort(),
    );

    for (const [table, count] of Object.entries(V1_TABLE_COUNTS)) {
      expect(await database.table(table).count(), `${table} 行数应保持不变`).toBe(count);
    }
    for (const table of ['longTasks', 'longTaskRuleVersions', 'longTaskExceptions']) {
      expect(await database.table(table).count()).toBe(0);
    }

    const tasks = await database.tasks.toArray();
    expect(tasks.every((task) => task.deletedAt !== undefined)).toBe(true);
    expect(tasks.every((task) => task.deletedAt === null)).toBe(true);

    // C6：新增索引真的可用（不是只在声明里存在）。
    // 注意：IndexedDB 不索引 null，因此 deletedAt=null 的行走过滤而非索引；
    // 回收站查询用 above('')，这里同时验证「索引存在且可查」与「未删行数为 2」。
    const softDeleted = await database.tasks.where('deletedAt').above('').count();
    expect(softDeleted).toBe(0);
    const live = await database.tasks.filter((task) => task.deletedAt === null).count();
    expect(live).toBe(2);
    const unfinished = await database.tasks.where('status').equals('todo').count();
    expect(unfinished).toBe(1);
  });
});

describe('S8 演练 B：升级失败后仍可重试', () => {
  it('upgrade 抛错停在 v1，随后用生产声明可成功升级', async () => {
    const name = nextName();
    const { v1 } = await seedV1(name);
    v1.close();

    // 与生产完全同构的表声明，只在 upgrade 里主动失败。
    // 这里直接用 Dexie 实例而非子类：Dexie 的泛型在子类 constructor 里会被深度推导。
    const failing = new Dexie(name);
    failing.version(1).stores(V1_STORES);
    failing
      .version(2)
      .stores(V2_STORES)
      .upgrade(async () => {
        throw new Error('模拟升级中途失败');
      });
    opened.push(failing);
    await expect(failing.open()).rejects.toThrow();

    const afterFailure = new Dexie(name);
    opened.push(afterFailure);
    afterFailure.version(1).stores(V1_STORES);
    await afterFailure.open();
    expect(afterFailure.verno).toBe(1);
    expect(await afterFailure.table('tasks').count()).toBe(2);

    // 重试：同一份数据走生产声明，应当成功并完成回填。
    const retry = createDatabase(name);
    opened.push(retry);
    await retry.open();
    expect(retry.verno).toBe(2);
    expect(await retry.tasks.count()).toBe(2);
    expect((await retry.tasks.toArray()).every((task) => task.deletedAt === null)).toBe(true);
  });
});

describe('S8 演练 C：用 v1 备份回滚到升级前数据', () => {
  it('v1 八表备份可导入 v2 空库，新表为空且 migratedFrom=1', async () => {
    const name = nextName();
    const { v1, snapshot } = await seedV1(name);
    v1.close();

    const data: BackupDataV1 = {
      projects: snapshot.projects,
      tags: snapshot.tags,
      tasks: snapshot.tasks,
      dailyPlans: snapshot.dailyPlans,
      workLogs: snapshot.workLogs,
      reports: snapshot.reports,
      settings: snapshot.settings,
      meta: snapshot.meta,
    } as unknown as BackupDataV1;
    const counts = {};
    for (const [table, rows] of Object.entries(data)) {
      (counts as Record<string, number>)[table] = (rows as unknown[]).length;
    }

    const envelope = {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      schemaVersion: 1,
      appVersion: '0.9.0',
      exportedAt: timestamp,
      counts,
      checksum: checksumOf(data as unknown as BackupDataV2),
      data,
    };

    const targetName = nextName();
    const target = createDatabase(targetName);
    opened.push(target);
    await target.open();

    const result = await importBackupText(`${JSON.stringify(envelope, null, 2)}\n`, target);
    expect(result.migratedFrom).toBe(1);
    for (const [table, count] of Object.entries(V1_TABLE_COUNTS)) {
      // meta 会多出导入动作写入的 lastImportedAt，因此按「至少 count 行」断言。
      const expected = table === 'meta' ? count + 1 : count;
      expect(await target.table(table).count(), `${table} 应恢复 ${expected} 行`).toBe(expected);
    }
    for (const table of ['longTasks', 'longTaskRuleVersions', 'longTaskExceptions']) {
      expect(await target.table(table).count()).toBe(0);
    }
    const tasks = await target.tasks.toArray();
    expect(tasks.every((task) => task.deletedAt === null)).toBe(true);
    expect(await target.workLogs.get('log-1')).toMatchObject({ taskId: 'task-1' });
  });
});

describe('S8 演练 D：v2 备份往返', () => {
  it('升级后导出并导入空库，十一表计数与软删除状态一致', async () => {
    const name = nextName();
    const { v1 } = await seedV1(name);
    v1.close();

    const source = createDatabase(name);
    opened.push(source);
    await source.open();

    // 升级后再造一行软删除数据，确认备份不会过滤 deleted。
    await source.tasks.update('task-2', { deletedAt: timestamp, updatedAt: timestamp });

    const { text, envelope } = await exportBackup({ database: source, now: new Date(timestamp) });
    expect(envelope.schemaVersion).toBe(2);
    expect(Object.keys(envelope.counts).sort()).toEqual(
      [
        'dailyPlans',
        'longTaskExceptions',
        'longTaskRuleVersions',
        'longTasks',
        'meta',
        'projects',
        'reports',
        'settings',
        'tags',
        'tasks',
        'workLogs',
      ].sort(),
    );

    const targetName = nextName();
    const target = createDatabase(targetName);
    opened.push(target);
    await target.open();
    const result = await importBackupText(text, target);

    expect(result.migratedFrom).toBeNull();
    expect(result.counts.tasks).toBe(2);
    expect(await target.tasks.get('task-2')).toMatchObject({ deletedAt: timestamp });
    expect(countsOf(envelope.data as BackupDataV2).tasks).toBe(2);
  });
});
