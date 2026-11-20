import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LongTaskException, LongTaskRuleVersion } from '@/domain/long-task';
import type { WorkbenchDatabase } from '@/db/db';
import {
  appendLongTaskRuleVersion,
  createLongTask as createLongTaskRecord,
  softDeleteLongTask,
} from '@/repositories/long-tasks';
import { diagnoseLongTasks } from '@/services/long-tasks/diagnose';
import { createTestDatabase, destroyTestDatabase } from '@/test/db';

const TODAY = '2026-11-19';

let database: WorkbenchDatabase;

beforeEach(() => {
  database = createTestDatabase('diagnose');
});

afterEach(async () => {
  await destroyTestDatabase(database);
});

async function seedTask(title = '晨间复盘') {
  return createLongTaskRecord(
    { title, startDate: '2026-11-02', spec: { kind: 'daily' } },
    { now: '2026-11-02T00:00:00.000Z', today: TODAY },
    database,
  );
}

function versionOf(taskId: string, versionNo: number, effectiveFrom: string): LongTaskRuleVersion {
  return {
    id: `ltv-${taskId}-${versionNo}`,
    taskId,
    versionNo,
    effectiveFrom,
    spec: { kind: 'daily' },
    changeNote: null,
    createdAt: '2026-11-02T00:00:00.000Z',
  };
}

function exceptionOf(
  taskId: string,
  revision: number,
  previousRevisionId: string | null,
): LongTaskException {
  return {
    id: `ltx-${taskId}-${revision}`,
    taskId,
    occurrenceDate: '2026-11-10',
    revision,
    previousRevisionId,
    changeKind: revision === 1 ? 'initial' : 'correction',
    baseOccurrence: {
      date: '2026-11-10',
      slotIndex: 1,
      versionId: `${taskId}-v1`,
      title: '晨间复盘',
      description: '',
      note: '',
      priority: 'medium',
      dueDate: null,
      tags: [],
    },
    before: { mode: 'rule' },
    after: revision === 1 ? { mode: 'skip' } : { mode: 'override', patch: { title: '改过' } },
    reason: revision === 1 ? null : '补记',
    createdAt: '2026-11-10T00:00:00.000Z',
  };
}

describe('diagnoseLongTasks', () => {
  it('健康库返回零问题', async () => {
    const { task } = await seedTask();
    const report = await diagnoseLongTasks(database);

    expect(report.total).toBe(1);
    expect(report.healthy).toBe(1);
    expect(report.entries).toEqual([]);
    expect(report.orphanVersions).toBe(0);
    expect(report.orphanExceptions).toBe(0);
    expect(report.scannedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(task.id).toBeTruthy();
  });

  it('版本号断档会被诊断出来', async () => {
    const { task } = await seedTask();
    // 直接写库造坏数据：v1 之后跳到 v3，模拟迁移或外部写坏。
    await database.longTaskRuleVersions.add(versionOf(task.id, 3, '2026-12-01'));
    const report = await diagnoseLongTasks(database);

    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]?.taskId).toBe(task.id);
    expect(report.entries[0]?.issues.map((issue) => issue.code)).toContain('A11');
    expect(report.healthy).toBe(0);
  });

  it('例外修订链断档会被诊断出来', async () => {
    const { task } = await seedTask();
    await database.longTaskExceptions.add(exceptionOf(task.id, 1, null));
    await database.longTaskExceptions.add(exceptionOf(task.id, 3, 'ltx-missing'));
    const report = await diagnoseLongTasks(database);

    const codes = report.entries[0]?.issues.map((issue) => issue.code) ?? [];
    expect(codes).toContain('E7');
    expect(codes).toContain('E8');
  });

  it('生命周期事件乱序会被诊断出来', async () => {
    const { task } = await seedTask();
    await database.longTasks.put({
      ...task,
      events: [
        ...task.events,
        {
          id: 'lte-pause-1',
          type: 'paused',
          date: '2026-11-20',
          note: null,
          createdAt: '2026-11-19T00:00:00.000Z',
        },
        {
          id: 'lte-pause-2',
          type: 'paused',
          date: '2026-11-25',
          note: null,
          createdAt: '2026-11-19T00:00:00.000Z',
        },
      ],
    });
    const report = await diagnoseLongTasks(database);

    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]?.issues.length).toBeGreaterThan(0);
  });

  it('孤儿版本与孤儿例外单独统计', async () => {
    await seedTask();
    await database.longTaskRuleVersions.add(versionOf('ghost-task', 1, '2026-11-02'));
    await database.longTaskExceptions.add(exceptionOf('ghost-task', 1, null));
    const report = await diagnoseLongTasks(database);

    expect(report.orphanVersions).toBe(1);
    expect(report.orphanExceptions).toBe(1);
    expect(report.entries).toEqual([]);
  });

  it('已软删除的任务仍参与诊断', async () => {
    const { task } = await seedTask();
    await softDeleteLongTask(
      task.id,
      { expectedUpdatedAt: task.updatedAt, now: '2026-11-19T01:00:00.000Z' },
      database,
    );
    const stored = await database.longTasks.get(task.id);
    await database.longTaskRuleVersions.add(versionOf(task.id, 3, '2026-12-01'));

    const report = await diagnoseLongTasks(database);
    expect(report.total).toBe(1);
    expect(report.entries[0]?.deleted).toBe(true);
    expect(stored?.deletedAt).not.toBeNull();
  });

  it('坏聚合拒绝写入，但仍可软删除移走', async () => {
    const { task } = await seedTask();
    await database.longTaskRuleVersions.add(versionOf(task.id, 3, '2026-12-01'));

    await expect(
      appendLongTaskRuleVersion(
        task.id,
        { effectiveFrom: '2026-12-05', spec: { kind: 'daily' } },
        { expectedUpdatedAt: task.updatedAt, today: TODAY },
        database,
      ),
    ).rejects.toThrow(/链已损坏|已阻止写入/);

    await expect(
      softDeleteLongTask(
        task.id,
        { expectedUpdatedAt: task.updatedAt, now: '2026-11-19T02:00:00.000Z' },
        database,
      ),
    ).resolves.toBeDefined();

    const stored = await database.longTasks.get(task.id);
    expect(stored?.deletedAt).not.toBeNull();
  });
});
