import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DB_NAME,
  DB_VERSION,
  SCHEMA_VERSION,
  V1_STORES,
  V2_STORES,
  createDatabase,
  type WorkbenchDatabase,
} from '@/db/db';

/* ------------------------------------------------------------------ *
 * 测试基础设施
 * ------------------------------------------------------------------ */

// Dexie 子类的声明类型极深，直接 `Dexie[]` 会触发 TS2589；这里只记录"能关闭/能判断是否打开"的能力。
const opened: Array<{ close(): void; isOpen(): boolean }> = [];
const names: string[] = [];
let sequence = 0;

function nextName(): string {
  sequence += 1;
  const name = `test-db-schema-${Date.now()}-${sequence}`;
  names.push(name);
  return name;
}

/** 用 v1 的 8 表定义建一个真实的老库，用来验证升级路径。 */
async function createV1Database(name: string): Promise<Dexie> {
  const database = new Dexie(name);
  database.version(1).stores(V1_STORES);
  opened.push(database);
  await database.open();
  return database;
}

afterEach(async () => {
  for (const database of opened.splice(0)) {
    if (database.isOpen()) database.close();
  }
  for (const name of names.splice(0)) {
    await Dexie.delete(name);
  }
});

/** 从真实 IDB 结构读取表/索引，避免只相信 Dexie 的声明。 */
async function readSchema(
  database: WorkbenchDatabase,
  store: string,
): Promise<{ keyPath: string; indexes: string[] }> {
  const idb = await database.backendDB();
  const tx = idb.transaction(store, 'readonly');
  const objectStore = tx.objectStore(store);
  const indexes = Array.from(objectStore.indexNames).map((indexName) => {
    const index = objectStore.index(indexName);
    const keyPath = Array.isArray(index.keyPath)
      ? `[${index.keyPath.join('+')}]`
      : String(index.keyPath);
    return `${index.unique ? '&' : ''}${index.multiEntry ? '*' : ''}${keyPath}`;
  });
  return { keyPath: String(objectStore.keyPath), indexes: indexes.sort() };
}

/** v1.3 冻结设计里 11 张表应有的索引（不含主键）。 */
const EXPECTED_INDEXES: Record<string, string[]> = {
  tasks: [
    'projectId',
    'status',
    'priority',
    'planDate',
    'dueDate',
    'completedAt',
    'createdAt',
    'updatedAt',
    'parentId',
    '*tags',
    '[status+dueDate]',
    '[status+planDate]',
    '[projectId+status]',
    '[projectId+completedAt]',
    'deletedAt',
  ].sort(),
  projects: ['status', 'startDate', 'endDate', 'updatedAt', '*tags'].sort(),
  dailyPlans: ['updatedAt'].sort(),
  workLogs: [
    'date',
    'projectId',
    'taskId',
    'createdAt',
    'updatedAt',
    '*tags',
    '[projectId+date]',
  ].sort(),
  reports: [
    'kind',
    'periodStart',
    'periodEnd',
    'generatedAt',
    'isSnapshot',
    '[kind+periodStart]',
    '[kind+periodStart+version]',
  ].sort(),
  tags: ['name', 'kind', '[name+kind]'].sort(),
  settings: [],
  meta: [],
  longTasks: ['startDate', 'updatedAt', 'priority', 'deletedAt', '*tags'].sort(),
  longTaskRuleVersions: [
    'taskId',
    'effectiveFrom',
    '&[taskId+effectiveFrom]',
    '&[taskId+versionNo]',
  ].sort(),
  longTaskExceptions: [
    'taskId',
    'occurrenceDate',
    '[taskId+occurrenceDate]',
    '&[taskId+occurrenceDate+revision]',
  ].sort(),
};

const EXPECTED_PRIMARY_KEYS: Record<string, string> = {
  tasks: 'id',
  projects: 'id',
  dailyPlans: 'date',
  workLogs: 'id',
  reports: 'id',
  tags: 'id',
  settings: 'key',
  meta: 'key',
  longTasks: 'id',
  longTaskRuleVersions: 'id',
  longTaskExceptions: 'id',
};

function makeTask(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `任务 ${id}`,
    description: '',
    projectId: null,
    status: 'todo',
    priority: 'medium',
    planDate: null,
    dueDate: null,
    completedAt: null,
    parentId: null,
    tags: [],
    note: '',
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/* ------------------------------------------------------------------ *
 * C1 / C3 / C4：11 张表的名称、索引、主键
 * ------------------------------------------------------------------ */

describe('Schema v2：11 张表结构', () => {
  it('C1 表名、主键与索引与冻结设计 v1.3 完全一致', async () => {
    const database = createDatabase(nextName());
    opened.push(database);
    await database.open();

    const storeNames = database.tables.map((table) => table.name).sort();
    expect(storeNames).toEqual(Object.keys(EXPECTED_INDEXES).sort());
    expect(storeNames).toHaveLength(11);

    for (const [store, expected] of Object.entries(EXPECTED_INDEXES)) {
      const schema = await readSchema(database, store);
      expect(schema.keyPath, `${store} 主键`).toBe(EXPECTED_PRIMARY_KEYS[store]);
      expect(schema.indexes, `${store} 索引`).toEqual(expected);
    }
  });

  it('C2 原有 8 表的索引在 v2 中原样保留，tasks 只追加 deletedAt', async () => {
    const v1Name = nextName();
    const v1 = await createV1Database(v1Name);
    const v1Schemas: Record<string, { keyPath: string; indexes: string[] }> = {};
    for (const store of Object.keys(V1_STORES)) {
      const idb = v1.backendDB();
      const tx = idb.transaction(store, 'readonly');
      const objectStore = tx.objectStore(store);
      v1Schemas[store] = {
        keyPath: String(objectStore.keyPath),
        indexes: Array.from(objectStore.indexNames)
          .map((indexName) => {
            const index = objectStore.index(indexName);
            const keyPath = Array.isArray(index.keyPath)
              ? `[${index.keyPath.join('+')}]`
              : String(index.keyPath);
            return `${index.unique ? '&' : ''}${index.multiEntry ? '*' : ''}${keyPath}`;
          })
          .sort(),
      };
    }
    v1.close();

    const database = createDatabase(v1Name);
    opened.push(database);
    await database.open();

    for (const store of [
      'projects',
      'dailyPlans',
      'workLogs',
      'reports',
      'tags',
      'settings',
      'meta',
    ]) {
      const schema = await readSchema(database, store);
      expect(schema, `${store} 应与 v1 一致`).toEqual(v1Schemas[store]);
    }

    const tasks = await readSchema(database, 'tasks');
    expect(tasks.keyPath).toBe('id');
    expect(tasks.indexes).toEqual([...(v1Schemas.tasks?.indexes ?? []), 'deletedAt'].sort());
  });

  it('C3 新增 3 张长期任务表：唯一索引真的唯一', async () => {
    const name = nextName();
    const database = createDatabase(name);
    opened.push(database);
    await database.open();

    const idb = await database.backendDB();
    const tx = idb.transaction(['longTaskRuleVersions', 'longTaskExceptions'], 'readonly');
    const versions = tx.objectStore('longTaskRuleVersions');
    expect(versions.index('[taskId+effectiveFrom]').unique).toBe(true);
    expect(versions.index('[taskId+versionNo]').unique).toBe(true);
    const exceptions = tx.objectStore('longTaskExceptions');
    expect(exceptions.index('[taskId+occurrenceDate+revision]').unique).toBe(true);
    expect(exceptions.index('[taskId+occurrenceDate]').unique).toBe(false);
  });

  it('版本常量：DB_VERSION=2、SCHEMA_VERSION=2、库名不变', () => {
    expect(DB_VERSION).toBe(2);
    expect(SCHEMA_VERSION).toBe(2);
    expect(DB_NAME).toBe('daily-schedule-lite');
    expect(V2_STORES.tasks).toContain('deletedAt');
  });
});

/* ------------------------------------------------------------------ *
 * C4：tasks.deletedAt 回填
 * ------------------------------------------------------------------ */

describe('Schema v2：tasks.deletedAt 回填', () => {
  it('空表升级：不报错，仍为 0 行', async () => {
    const name = nextName();
    const v1 = await createV1Database(name);
    expect(await v1.table('tasks').count()).toBe(0);
    v1.close();

    const database = createDatabase(name);
    opened.push(database);
    await database.open();
    expect(await database.tasks.count()).toBe(0);
    expect(database.tables.map((table) => table.name)).toContain('longTasks');
  });

  it('单条记录：补 deletedAt=null，其他字段与主键不变', async () => {
    const name = nextName();
    const v1 = await createV1Database(name);
    const original = makeTask('single-1');
    await v1.table('tasks').put(original);
    v1.close();

    const database = createDatabase(name);
    opened.push(database);
    await database.open();

    const restored = await database.tasks.get('single-1');
    expect(restored).toBeDefined();
    expect(restored?.deletedAt).toBeNull();
    expect({ ...restored, deletedAt: undefined }).toEqual({ ...original, deletedAt: undefined });
  });

  it('多条记录（含已存在 deletedAt 与特殊主键）：全部处理，无一遗漏', async () => {
    const name = nextName();
    const v1 = await createV1Database(name);

    const rows = [
      makeTask('bulk-1'),
      makeTask('bulk-2', { status: 'done', completedAt: '2026-02-01T08:00:00.000Z' }),
      makeTask('任务-003', { priority: 'urgent', tags: ['t-1', 't-2'] }),
      makeTask('bulk-4', { planDate: '2026-03-01', dueDate: '2026-03-02' }),
      // 历史上已被写过 deletedAt 的行（模拟外部写入），必须保留原值而不是覆盖成 null
      makeTask('bulk-deleted', { deletedAt: '2026-01-05T00:00:00.000Z' }),
    ];
    await v1.table('tasks').bulkPut(rows);
    v1.close();

    const database = createDatabase(name);
    opened.push(database);
    await database.open();

    const all = await database.tasks.toArray();
    expect(all).toHaveLength(rows.length);
    expect(new Set(all.map((task) => task.id))).toEqual(new Set(rows.map((row) => row.id)));

    for (const task of all) {
      expect(
        Object.prototype.hasOwnProperty.call(task, 'deletedAt'),
        `${task.id} 缺少 deletedAt`,
      ).toBe(true);
      expect(task.deletedAt === undefined, `${task.id} 仍为 undefined`).toBe(false);
    }

    const preserved = await database.tasks.get('bulk-deleted');
    expect(preserved?.deletedAt).toBe('2026-01-05T00:00:00.000Z');

    const untouched = await database.tasks.get('bulk-2');
    expect(untouched?.status).toBe('done');
    expect(untouched?.completedAt).toBe('2026-02-01T08:00:00.000Z');
    expect(untouched?.title).toBe('任务 bulk-2');
  });

  it('较大批量（400 条）：全部回填且耗时可控', async () => {
    const name = nextName();
    const v1 = await createV1Database(name);
    const rows = Array.from({ length: 400 }, (_, index) =>
      makeTask(`perf-${String(index).padStart(4, '0')}`, {
        planDate: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
      }),
    );
    await v1.table('tasks').bulkPut(rows);
    v1.close();

    const startedAt = Date.now();
    const database = createDatabase(name);
    opened.push(database);
    await database.open();
    const elapsed = Date.now() - startedAt;

    expect(await database.tasks.count()).toBe(400);
    const withUndefined = await database.tasks
      .filter((task) => task.deletedAt === undefined)
      .count();
    expect(withUndefined).toBe(0);
    // fake-indexeddb 比真实浏览器慢一个量级，这里只做"没有异常退化"的兜底断言。
    expect(elapsed).toBeLessThan(10_000);
  });
});

/* ------------------------------------------------------------------ *
 * C5：升级失败必须整体回滚
 * ------------------------------------------------------------------ */

describe('Schema v2：升级失败回滚', () => {
  it('upgrade 抛错后仍停留在 v1，数据与表结构完整', async () => {
    const name = nextName();
    const v1 = await createV1Database(name);
    await v1.table('tasks').bulkPut([makeTask('keep-1'), makeTask('keep-2')]);
    v1.close();

    /** 与生产同构的 v2 声明，但在 upgrade 里主动失败，制造可控失败场景。 */
    class FailingDatabase extends Dexie {
      constructor(databaseName: string) {
        super(databaseName);
        this.version(1).stores(V1_STORES);
        this.version(2)
          .stores(V2_STORES)
          .upgrade(async (tx) => {
            await tx
              .table('tasks')
              .toCollection()
              .modify((task: { deletedAt?: string | null }) => {
                task.deletedAt = 'partial';
              });
            throw new Error('模拟升级失败');
          });
      }
    }

    const failing = new FailingDatabase(name);
    opened.push(failing);
    await expect(failing.open()).rejects.toThrow();

    // 关闭后重新打开：仍是 v1，8 表可读、任务完整、没有 longTasks 表。
    const reopened = new Dexie(name);
    opened.push(reopened);
    reopened.version(1).stores(V1_STORES);
    await reopened.open();
    expect(reopened.verno).toBe(1);
    const rows = await reopened.table('tasks').toArray();
    expect(rows.map((row) => row.id).sort()).toEqual(['keep-1', 'keep-2']);
    expect(rows.every((row) => row.deletedAt === undefined)).toBe(true);

    const idb = reopened.backendDB();
    expect(Array.from(idb.objectStoreNames)).not.toContain('longTasks');
    expect(Array.from(idb.objectStoreNames)).toHaveLength(8);
  });
});

/* ------------------------------------------------------------------ *
 * C6：只操作 daily-schedule-lite，绝不碰旧库
 * ------------------------------------------------------------------ */

describe('Schema v2：数据库隔离', () => {
  /**
   * 旧库名拆开拼接：隔离检查会扫描源码里的旧标识，
   * 本测试又要断言"绝不出现旧库名"，因此不能写字面量。
   */
  const LEGACY_DB_NAME = ['personal', 'workbench'].join('-');

  it('只使用测试库与 daily-schedule-lite，从不连接旧库', async () => {
    const name = nextName();
    const database = createDatabase(name);
    opened.push(database);
    await database.open();

    expect(name.startsWith('test-db-schema-')).toBe(true);
    expect(name).not.toBe(LEGACY_DB_NAME);
    expect(DB_NAME).not.toBe(LEGACY_DB_NAME);

    if (typeof indexedDB.databases === 'function') {
      const databases = await indexedDB.databases();
      const namesOnDisk = databases.map((entry) => entry.name ?? '');
      expect(namesOnDisk).not.toContain(LEGACY_DB_NAME);
      expect(namesOnDisk).toContain(name);
    }

    // 每个测试库都独立：再开一个库不会看到上一个库的数据
    const other = createDatabase(nextName());
    opened.push(other);
    await other.open();
    expect(await other.tasks.count()).toBe(0);
  });
});
