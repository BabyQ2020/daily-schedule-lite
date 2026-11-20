import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { WorkbenchDatabase } from '@/db/db';
import { SCHEMA_VERSION } from '@/db/db';
import {
  appendLongTaskException,
  createLongTask,
  softDeleteLongTask,
} from '@/repositories/long-tasks';
import { createLog } from '@/repositories/logs';
import { setPlanTasks } from '@/repositories/plans';
import { createProject } from '@/repositories/projects';
import { createReport } from '@/repositories/reports';
import { createTag } from '@/repositories/tags';
import { createTask } from '@/repositories/tasks';
import type { BackupDataV2 } from '@/services/backup';
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  BackupValidationError,
  applyBackup,
  countsOf,
  exportBackup,
  importBackupText,
  inspectBackupText,
} from '@/services/backup';
import { loadSettings, saveSettings } from '@/services/settings';
import { checksumOf } from '@/lib/checksum';
import { createTestDatabase, destroyTestDatabase } from '@/test/db';

let source: WorkbenchDatabase;
let target: WorkbenchDatabase;

beforeEach(() => {
  source = createTestDatabase('backup-source');
  target = createTestDatabase('backup-target');
});

afterEach(async () => {
  await destroyTestDatabase(source);
  await destroyTestDatabase(target);
});

async function seed(database: WorkbenchDatabase) {
  const tag = await createTag({ name: '核心', color: '#2563eb', kind: 'general' }, database);
  const project = await createProject(
    { name: '备份项目', startDate: '2026-11-01', tags: [tag.id] },
    database,
  );
  const task = await createTask(
    { title: '备份任务', projectId: project.id, planDate: '2026-11-16', dueDate: '2026-11-20' },
    database,
  );
  await setPlanTasks('2026-11-16', [task.id], database);
  await createLog(
    {
      date: '2026-11-16',
      title: '备份日志',
      projectId: project.id,
      taskId: task.id,
      tags: [tag.id],
    },
    database,
  );
  await createReport(
    {
      kind: 'day',
      periodStart: '2026-11-16',
      periodEnd: '2026-11-16',
      metrics: { planned: 1, completed: 0 },
      body: '# 日报',
    },
    database,
  );
  await saveSettings({ weekStart: 7, backupReminderDays: 3 }, database);
  return { tag, project, task };
}

/** 构造一个合法信封，便于在不改动导出逻辑的前提下做反向用例。 */
async function buildEnvelope(database: WorkbenchDatabase) {
  const { envelope } = await exportBackup({ database });
  return envelope;
}

describe('备份导出', () => {
  it('导出包含版本号、计数与校验和，并记录备份时间', async () => {
    await seed(source);
    const { envelope, text, fileName } = await exportBackup({ database: source });

    expect(envelope.format).toBe(BACKUP_FORMAT);
    expect(envelope.formatVersion).toBe(BACKUP_FORMAT_VERSION);
    expect(envelope.schemaVersion).toBe(SCHEMA_VERSION);
    expect(envelope.counts.tasks).toBe(1);
    expect(envelope.counts.workLogs).toBe(1);
    expect(envelope.counts.projects).toBe(1);
    expect(envelope.checksum).toHaveLength(16);
    expect(envelope.checksum).toBe(checksumOf(envelope.data));
    expect(text.endsWith('\n')).toBe(true);
    expect(fileName).toMatch(/^daily-schedule-lite-backup-\d{8}-\d{4}\.json$/);
    expect(envelope.data.meta.some((record) => record.key === 'lastBackupAt')).toBe(true);
  });
});

describe('备份导入', () => {
  it('导出的备份可在空库完整恢复', async () => {
    const { project, task } = await seed(source);
    const { text } = await exportBackup({ database: source });

    const result = await importBackupText(text, target);
    expect(result.totalRecords).toBeGreaterThan(0);
    expect(result.migratedFrom).toBeNull();

    expect(await target.projects.count()).toBe(1);
    expect(await target.tasks.count()).toBe(1);
    expect(await target.dailyPlans.count()).toBe(1);
    expect(await target.workLogs.count()).toBe(1);
    expect(await target.reports.count()).toBe(1);
    expect(await target.tags.count()).toBe(1);

    const restoredTask = await target.tasks.get(task.id);
    expect(restoredTask?.projectId).toBe(project.id);
    const settings = await loadSettings(target);
    expect(settings.weekStart).toBe(7);
    expect(settings.backupReminderDays).toBe(3);
  });

  it('导入前可预览条数而不写库', async () => {
    await seed(source);
    const { text } = await exportBackup({ database: source });
    const inspection = inspectBackupText(text);
    expect(inspection.counts.tasks).toBe(1);
    expect(inspection.totalRecords).toBe(
      Object.values(inspection.counts).reduce((sum, value) => sum + value, 0),
    );
    expect(await target.tasks.count()).toBe(0);

    await applyBackup(inspection, target);
    expect(await target.tasks.count()).toBe(1);
  });

  it('导入覆盖已有数据而不是合并', async () => {
    await createTask({ title: '目标库旧任务' }, target);
    await seed(source);
    const { text } = await exportBackup({ database: source });

    await importBackupText(text, target);
    const titles = (await target.tasks.toArray()).map((task) => task.title);
    expect(titles).toEqual(['备份任务']);
  });
});

describe('非法备份一律拒绝且不写入', () => {
  const assertRejected = async (text: string, matcher: RegExp) => {
    const before = await target.tasks.count();
    await expect(importBackupText(text, target)).rejects.toThrow(matcher);
    const after = await target.tasks.count();
    expect(after).toBe(before);
  };

  it('非 JSON 文本', async () => {
    await assertRejected('这不是 JSON', /不是有效的 JSON/);
  });

  it('缺少 format 标识', async () => {
    const envelope = await buildEnvelope(source);
    const broken = { ...envelope, format: 'other-app/backup' };
    await assertRejected(JSON.stringify(broken), /format 标识不匹配/);
  });

  it('schema 版本高于当前应用', async () => {
    const envelope = await buildEnvelope(source);
    const broken = { ...envelope, schemaVersion: SCHEMA_VERSION + 1 };
    await assertRejected(JSON.stringify(broken), /高于当前应用支持/);
  });

  it('字段类型错误', async () => {
    await seed(source);
    const envelope = await buildEnvelope(source);
    const data = {
      ...envelope.data,
      tasks: [{ ...envelope.data.tasks[0]!, status: 'unknown' }],
    };
    const broken = { ...envelope, data, checksum: checksumOf(data) };
    await assertRejected(JSON.stringify(broken), /字段校验失败/);
  });

  it('引用断裂', async () => {
    await seed(source);
    const envelope = await buildEnvelope(source);
    const data = {
      ...envelope.data,
      tasks: [{ ...envelope.data.tasks[0]!, projectId: 'proj_missing' }],
    };
    const broken = {
      ...envelope,
      data,
      counts: countsOf(data as BackupDataV2),
      checksum: checksumOf(data),
    };
    await assertRejected(JSON.stringify(broken), /悬空引用/);
  });

  it('校验和不匹配', async () => {
    await seed(source);
    const envelope = await buildEnvelope(source);
    const data = {
      ...envelope.data,
      tasks: [{ ...envelope.data.tasks[0]!, title: '被篡改的标题' }],
    };
    const broken = {
      ...envelope,
      data,
      counts: countsOf(data as BackupDataV2),
      checksum: envelope.checksum,
    };
    await assertRejected(JSON.stringify(broken), /校验和不匹配/);
  });

  it('错误类型是 BackupValidationError，可直接展示给用户', async () => {
    try {
      await importBackupText('{}', target);
      expect.unreachable('应当抛错');
    } catch (error) {
      expect(error).toBeInstanceOf(BackupValidationError);
      if (error instanceof BackupValidationError) {
        expect(error.message).toContain('format');
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * v2：长期任务三表、v1 兼容与链完整性
 * ------------------------------------------------------------------ */

async function seedLongTask(database: WorkbenchDatabase) {
  const aggregate = await createLongTask(
    {
      title: '长期任务',
      startDate: '2026-11-02',
      spec: { kind: 'daily' },
      endCondition: { type: 'count', count: 5 },
    },
    { today: '2026-11-02' },
    database,
  );
  const withException = await appendLongTaskException(
    aggregate.task.id,
    {
      occurrenceDate: '2026-11-03',
      changeKind: 'initial',
      state: { mode: 'override', patch: { title: '单次改名' } },
      reason: '临时调整',
    },
    { expectedUpdatedAt: aggregate.task.updatedAt, today: '2026-11-02' },
    database,
  );
  const deleted = await softDeleteLongTask(
    withException.task.id,
    { expectedUpdatedAt: withException.task.updatedAt },
    database,
  );
  return {
    task: deleted,
    versionId: aggregate.versions[0]!.id,
    exceptionId: withException.exception.id,
  };
}

describe('备份 v2（长期任务三表）', () => {
  it('导出包含 11 张表的计数与数据，checksum 覆盖整体', async () => {
    await seed(source);
    const longTask = await seedLongTask(source);
    const { envelope } = await exportBackup({ database: source });

    expect(envelope.schemaVersion).toBe(2);
    expect(Object.keys(envelope.counts)).toHaveLength(11);
    expect(envelope.counts.longTasks).toBe(1);
    expect(envelope.counts.longTaskRuleVersions).toBe(1);
    expect(envelope.counts.longTaskExceptions).toBe(1);
    expect(envelope.checksum).toBe(checksumOf(envelope.data));
    expect(longTask.task.deletedAt).not.toBeNull();
  });

  it('导出的备份可在空库恢复长期任务、规则版本、例外与回收站状态', async () => {
    await seedLongTask(source);
    const { text } = await exportBackup({ database: source });

    const result = await importBackupText(text, target);
    expect(result.migratedFrom).toBeNull();

    const [restored] = await target.longTasks.toArray();
    const [version] = await target.longTaskRuleVersions.toArray();
    const [exception] = await target.longTaskExceptions.toArray();
    expect(restored?.id).toBeDefined();
    expect(restored?.deletedAt).not.toBeNull();
    expect(restored?.events.map((event) => event.type)).toContain('created');
    expect(version?.taskId).toBe(restored?.id);
    expect(exception?.baseOccurrence.title).toBe('长期任务');
    expect(exception?.after.mode).toBe('override');
  });

  it('v1 备份（8 数组、无 deletedAt）可导入，并补出 v2 结构', async () => {
    await seed(source);
    const { envelope } = await exportBackup({ database: source });
    const v2 = envelope.data as unknown as BackupDataV2;

    const v1Data = {
      projects: v2.projects,
      tags: v2.tags,
      tasks: v2.tasks.map(({ deletedAt: _deletedAt, ...rest }) => rest),
      dailyPlans: v2.dailyPlans,
      workLogs: v2.workLogs,
      reports: v2.reports,
      settings: v2.settings,
      meta: v2.meta,
    };
    const v1 = {
      ...envelope,
      schemaVersion: 1,
      counts: {
        projects: v1Data.projects.length,
        tags: v1Data.tags.length,
        tasks: v1Data.tasks.length,
        dailyPlans: v1Data.dailyPlans.length,
        workLogs: v1Data.workLogs.length,
        reports: v1Data.reports.length,
        settings: v1Data.settings.length,
        meta: v1Data.meta.length,
      },
      checksum: checksumOf(v1Data),
      data: v1Data,
    };

    const result = await importBackupText(JSON.stringify(v1), target);
    expect(result.migratedFrom).toBe(1);
    expect(await target.tasks.count()).toBe(1);
    expect(await target.longTasks.count()).toBe(0);
    const [task] = await target.tasks.toArray();
    expect(task?.deletedAt).toBeNull();
  });

  it('声称 v2 却缺少长期任务数组时拒绝', async () => {
    await seedLongTask(source);
    const envelope = await buildEnvelope(source);
    const { longTaskExceptions: _omitted, ...data } = envelope.data as unknown as Record<
      string,
      unknown
    >;
    const broken = { ...envelope, data, checksum: checksumOf(data) };

    await expect(importBackupText(JSON.stringify(broken), target)).rejects.toThrow(/缺少数据表/);
    expect(await target.longTasks.count()).toBe(0);
  });

  it('修订链断裂（revision 从 2 开始）时拒绝', async () => {
    await seedLongTask(source);
    const envelope = await buildEnvelope(source);
    const valid = envelope.data as unknown as {
      longTaskExceptions: Array<Record<string, unknown>>;
    };
    const data = {
      ...envelope.data,
      longTaskExceptions: [
        {
          ...valid.longTaskExceptions[0]!,
          revision: 2,
          previousRevisionId: 'missing-revision',
        },
      ],
    };
    const broken = {
      ...envelope,
      data,
      counts: { ...envelope.counts, longTaskExceptions: 1 },
      checksum: checksumOf(data),
    };

    await expect(importBackupText(JSON.stringify(broken), target)).rejects.toThrow(/修订链断裂/);
  });

  it('规则版本引用不存在的长期任务时拒绝', async () => {
    await seedLongTask(source);
    const envelope = await buildEnvelope(source);
    const sourceData = envelope.data as unknown as BackupDataV2;
    const data = {
      ...sourceData,
      longTaskRuleVersions: [{ ...sourceData.longTaskRuleVersions[0]!, taskId: 'lt_missing' }],
    };
    const broken = {
      ...envelope,
      data,
      counts: { ...envelope.counts, longTaskRuleVersions: 1 },
      checksum: checksumOf(data),
    };

    await expect(importBackupText(JSON.stringify(broken), target)).rejects.toThrow(/悬空引用/);
  });
});
