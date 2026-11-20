import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { WorkbenchDatabase } from '@/db/db';
import type { LongTask, LongTaskException, LongTaskRuleVersion } from '@/domain/long-task';
import { computeSlots } from '@/services/long-tasks/schedule';
import { createTestDatabase, destroyTestDatabase } from '@/test/db';

import { ConflictError, ValidationError } from './errors';
import {
  appendLongTaskException,
  appendLongTaskLifecycleEvent,
  appendLongTaskRuleVersion,
  createLongTask,
  purgeLongTask,
  reopenLongTaskWithRuleVersion,
  restoreLongTask,
  revokeLongTaskException,
  setLongTaskArchived,
  softDeleteLongTask,
  updateLongTaskInfo,
  type LongTaskCreateInput,
  type WriteContext,
} from './long-tasks';

const TODAY = '2026-11-19';
const TOMORROW = '2026-11-20';
const NOW = '2026-11-19T09:00:00.000Z';

let database: WorkbenchDatabase;

beforeEach(() => {
  database = createTestDatabase('long-tasks-write');
});

afterEach(async () => {
  await destroyTestDatabase(database);
});

interface HookableTable {
  hook(event: 'creating' | 'updating' | 'deleting'): {
    subscribe(fn: () => void): void;
    unsubscribe(fn: () => void): void;
  };
}

/** 在持久化阶段注入一次失败，用来验证事务整体回滚。 */
function injectFailure(
  table: HookableTable,
  event: 'creating' | 'updating' | 'deleting',
  nth = 1,
): () => void {
  let seen = 0;
  const handler = (): void => {
    seen += 1;
    if (seen === nth) {
      throw new Error('注入失败');
    }
  };
  const hook = table.hook(event);
  hook.subscribe(handler);
  return () => hook.unsubscribe(handler);
}

async function seedTask(overrides: Partial<LongTaskCreateInput> = {}) {
  return createLongTask(
    {
      title: '长期任务',
      startDate: TODAY,
      spec: { kind: 'daily' },
      ...overrides,
    },
    { now: NOW, today: TODAY },
    database,
  );
}

async function reload(id: string): Promise<LongTask> {
  const task = await database.longTasks.get(id);
  if (!task) {
    throw new Error('任务不存在');
  }
  return task;
}

function ctx(task: LongTask, overrides: Partial<WriteContext> = {}): WriteContext {
  return { expectedUpdatedAt: task.updatedAt, now: NOW, today: TODAY, ...overrides };
}

async function counts() {
  return {
    tasks: await database.longTasks.count(),
    versions: await database.longTaskRuleVersions.count(),
    exceptions: await database.longTaskExceptions.count(),
  };
}

describe('createLongTask', () => {
  it('写入主记录、首版规则与创建事件', async () => {
    const { task, versions, exceptions, issues } = await seedTask({ tags: ['tag-1'] });

    expect(issues).toEqual([]);
    expect(exceptions).toEqual([]);
    expect(task.deletedAt).toBeNull();
    expect(task.archivedAt).toBeNull();
    expect(task.createdAt).toBe(NOW);
    expect(task.updatedAt).toBe(NOW);
    expect(task.events).toHaveLength(1);
    expect(task.events[0]).toMatchObject({ type: 'created', date: TODAY });

    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      taskId: task.id,
      versionNo: 1,
      effectiveFrom: TODAY,
      spec: { kind: 'daily' },
    });

    const stored = await reload(task.id);
    expect(stored.title).toBe('长期任务');
    expect(await counts()).toEqual({ tasks: 1, versions: 1, exceptions: 0 });
  });

  it('拒绝非法重复规则与非法结束条件', async () => {
    await expect(seedTask({ spec: { kind: 'weekly', weekdays: [] } })).rejects.toBeInstanceOf(
      ValidationError,
    );

    await expect(
      seedTask({
        endDate: '2026-11-30',
        endCondition: { type: 'until', until: '2026-11-30' },
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(seedTask({ endCondition: { type: 'count', count: 0 } })).rejects.toBeInstanceOf(
      ValidationError,
    );

    expect(await counts()).toEqual({ tasks: 0, versions: 0, exceptions: 0 });
  });

  it('拒绝不存在的日期', async () => {
    await expect(seedTask({ startDate: '2026-02-30' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('首版规则写入失败时主记录一起回滚', async () => {
    const stop = injectFailure(
      database.longTaskRuleVersions as unknown as HookableTable,
      'creating',
    );
    try {
      await expect(seedTask()).rejects.toThrow('注入失败');
    } finally {
      stop();
    }
    expect(await counts()).toEqual({ tasks: 0, versions: 0, exceptions: 0 });
  });

  it('允许补录首次计划日已过去的系列', async () => {
    const { task } = await seedTask({ startDate: '2026-11-01' });
    expect(task.startDate).toBe('2026-11-01');
    expect(task.events[0]?.date).toBe('2026-11-01');
  });
});

describe('updateLongTaskInfo', () => {
  it('按白名单更新运行字段', async () => {
    const { task } = await seedTask();
    const next = await updateLongTaskInfo(
      task.id,
      { title: '  新标题  ', note: '备注', priority: 'high', tags: ['t1'] },
      ctx(task),
      database,
    );

    expect(next.title).toBe('新标题');
    expect(next.note).toBe('备注');
    expect(next.priority).toBe('high');
    expect(next.tags).toEqual(['t1']);
    expect(next.updatedAt > task.updatedAt).toBe(true);
  });

  it('拒绝受保护字段并且不写入', async () => {
    const { task } = await seedTask();
    await expect(
      updateLongTaskInfo(task.id, { startDate: '2026-12-01' } as never, ctx(task), database),
    ).rejects.toBeInstanceOf(ValidationError);

    const stored = await reload(task.id);
    expect(stored.startDate).toBe(TODAY);
    expect(stored.updatedAt).toBe(task.updatedAt);
  });

  it('expectedUpdatedAt 不匹配时抛出 ConflictError 且无写入', async () => {
    const { task } = await seedTask();
    await expect(
      updateLongTaskInfo(task.id, { note: 'x' }, ctx(task, { expectedUpdatedAt: 'old' }), database),
    ).rejects.toBeInstanceOf(ConflictError);

    expect((await reload(task.id)).note).toBe('');
  });

  it('任务不存在时抛出 NotFoundError', async () => {
    await expect(
      updateLongTaskInfo('missing', { note: 'x' }, { expectedUpdatedAt: NOW }, database),
    ).rejects.toThrow('不存在');
  });

  it('软删除任务禁止普通修改', async () => {
    const { task } = await seedTask();
    const deleted = await softDeleteLongTask(task.id, ctx(task), database);
    await expect(
      updateLongTaskInfo(task.id, { note: 'x' }, ctx(deleted), database),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('同毫秒连续写入仍严格递增', async () => {
    const { task } = await seedTask();
    const first = await updateLongTaskInfo(task.id, { note: 'a' }, ctx(task), database);
    const second = await updateLongTaskInfo(task.id, { note: 'b' }, ctx(first), database);

    expect(first.updatedAt > task.updatedAt).toBe(true);
    expect(second.updatedAt > first.updatedAt).toBe(true);
  });

  it('注入更早的 now 也不会让 updatedAt 倒退', async () => {
    const { task } = await seedTask();
    const next = await updateLongTaskInfo(
      task.id,
      { note: 'a' },
      ctx(task, { now: '2026-11-18T09:00:00.000Z' }),
      database,
    );
    expect(next.updatedAt > task.updatedAt).toBe(true);
  });
});

describe('appendLongTaskRuleVersion', () => {
  it('追加新版本并推进主记录 updatedAt', async () => {
    const { task } = await seedTask();
    const { task: next, version } = await appendLongTaskRuleVersion(
      task.id,
      { effectiveFrom: TOMORROW, spec: { kind: 'weekly', weekdays: [1, 3] } },
      ctx(task),
      database,
    );

    expect(version.versionNo).toBe(2);
    expect(version.effectiveFrom).toBe(TOMORROW);
    expect(next.updatedAt > task.updatedAt).toBe(true);
    expect(await database.longTaskRuleVersions.where('taskId').equals(task.id).count()).toBe(2);
  });

  it('拒绝同日、过去的生效日', async () => {
    const { task } = await seedTask();
    await expect(
      appendLongTaskRuleVersion(
        task.id,
        { effectiveFrom: TODAY, spec: { kind: 'daily' } },
        ctx(task),
        database,
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      appendLongTaskRuleVersion(
        task.id,
        { effectiveFrom: '2026-11-18', spec: { kind: 'daily' } },
        ctx(task),
        database,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('已结束任务必须走原子重开接口', async () => {
    const { task } = await seedTask();
    const ended = await appendLongTaskLifecycleEvent(
      task.id,
      { type: 'ended', date: TODAY },
      ctx(task),
      database,
    );

    await expect(
      appendLongTaskRuleVersion(
        task.id,
        { effectiveFrom: TOMORROW, spec: { kind: 'daily' } },
        ctx(ended),
        database,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await database.longTaskRuleVersions.where('taskId').equals(task.id).count()).toBe(1);
  });

  it('版本链损坏时拒绝继续追加', async () => {
    const { task } = await seedTask();
    await database.longTaskRuleVersions.add({
      id: 'ltv-manual',
      taskId: task.id,
      versionNo: 3,
      effectiveFrom: '2026-11-25',
      spec: { kind: 'daily' },
      changeNote: null,
      createdAt: NOW,
    });

    await expect(
      appendLongTaskRuleVersion(
        task.id,
        { effectiveFrom: TOMORROW, spec: { kind: 'daily' } },
        ctx(task),
        database,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('持久化阶段失败时版本与 updatedAt 都回滚', async () => {
    const { task } = await seedTask();
    const stop = injectFailure(
      database.longTaskRuleVersions as unknown as HookableTable,
      'creating',
    );
    try {
      await expect(
        appendLongTaskRuleVersion(
          task.id,
          { effectiveFrom: TOMORROW, spec: { kind: 'daily' } },
          ctx(task),
          database,
        ),
      ).rejects.toThrow('注入失败');
    } finally {
      stop();
    }

    expect(await database.longTaskRuleVersions.where('taskId').equals(task.id).count()).toBe(1);
    expect((await reload(task.id)).updatedAt).toBe(task.updatedAt);
  });

  it('并发写入同一生效日只会成功一次', async () => {
    const { task } = await seedTask();
    const attempt = () =>
      appendLongTaskRuleVersion(
        task.id,
        { effectiveFrom: TOMORROW, spec: { kind: 'daily' } },
        ctx(task),
        database,
      );

    const results = await Promise.allSettled([attempt(), attempt()]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(await database.longTaskRuleVersions.where('taskId').equals(task.id).count()).toBe(2);
  });
});

describe('appendLongTaskException / revokeLongTaskException', () => {
  it('首版 skip：revision=1、prev=null、before=rule', async () => {
    const { task } = await seedTask();
    const { exception, task: next } = await appendLongTaskException(
      task.id,
      { occurrenceDate: TODAY, changeKind: 'initial', state: { mode: 'skip' } },
      ctx(task),
      database,
    );

    expect(exception).toMatchObject({
      revision: 1,
      previousRevisionId: null,
      before: { mode: 'rule' },
      after: { mode: 'skip' },
      baseOccurrence: { date: TODAY, slotIndex: 1, title: '长期任务', dueDate: null },
    });
    expect(next.updatedAt > task.updatedAt).toBe(true);
  });

  it('首版 override 只覆盖给定字段，baseOccurrence 仍是原始安排', async () => {
    const { task } = await seedTask();
    const { exception } = await appendLongTaskException(
      task.id,
      {
        occurrenceDate: TODAY,
        changeKind: 'initial',
        state: { mode: 'override', patch: { title: '临时标题', note: '改一次' } },
      },
      ctx(task),
      database,
    );

    expect(exception.baseOccurrence.title).toBe('长期任务');
    expect(exception.after).toEqual({
      mode: 'override',
      patch: { title: '临时标题', note: '改一次' },
    });
  });

  it('correction 追加修订并保留 before/after', async () => {
    const { task } = await seedTask();
    const first = await appendLongTaskException(
      task.id,
      {
        occurrenceDate: TODAY,
        changeKind: 'initial',
        state: { mode: 'override', patch: { note: '第一次' } },
      },
      ctx(task),
      database,
    );
    const second = await appendLongTaskException(
      task.id,
      {
        occurrenceDate: TODAY,
        changeKind: 'correction',
        state: { mode: 'override', patch: { note: '修正后' } },
        reason: '写错了',
      },
      { expectedUpdatedAt: first.task.updatedAt, now: NOW, today: TODAY },
      database,
    );

    expect(second.exception.revision).toBe(2);
    expect(second.exception.previousRevisionId).toBe(first.exception.id);
    expect(second.exception.before).toEqual(first.exception.after);
    expect(second.exception.reason).toBe('写错了');
  });

  it('correction 缺原因、过去日期首版、非槽位日期都被拒绝', async () => {
    const { task } = await seedTask();
    const first = await appendLongTaskException(
      task.id,
      { occurrenceDate: TODAY, changeKind: 'initial', state: { mode: 'skip' } },
      ctx(task),
      database,
    );

    await expect(
      appendLongTaskException(
        task.id,
        { occurrenceDate: TODAY, changeKind: 'correction', state: { mode: 'skip' } },
        { expectedUpdatedAt: first.task.updatedAt, now: NOW, today: TODAY },
        database,
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    const past = await seedTask({ startDate: '2026-11-01' });
    await expect(
      appendLongTaskException(
        past.task.id,
        { occurrenceDate: '2026-11-10', changeKind: 'initial', state: { mode: 'skip' } },
        { expectedUpdatedAt: past.task.updatedAt, now: NOW, today: TODAY },
        database,
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    const weekly = await seedTask({ spec: { kind: 'weekly', weekdays: [1, 3] } });
    // 2026-11-20 是周五，不在周一/周三规则里。
    await expect(
      appendLongTaskException(
        weekly.task.id,
        { occurrenceDate: TOMORROW, changeKind: 'initial', state: { mode: 'skip' } },
        { expectedUpdatedAt: weekly.task.updatedAt, now: NOW, today: TODAY },
        database,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('过去的记录允许 correction（前提是已存在历史修订）', async () => {
    const { task, versions } = await seedTask({ startDate: '2026-11-01' });
    const base: LongTaskException = {
      id: 'ltx-manual',
      taskId: task.id,
      occurrenceDate: '2026-11-10',
      revision: 1,
      previousRevisionId: null,
      changeKind: 'initial',
      baseOccurrence: {
        date: '2026-11-10',
        slotIndex: 10,
        versionId: versions[0]!.id,
        title: task.title,
        description: task.description,
        note: task.note,
        priority: task.priority,
        dueDate: null,
        tags: [...task.tags],
      },
      before: { mode: 'rule' },
      after: { mode: 'skip' },
      reason: null,
      createdAt: NOW,
    };
    await database.longTaskExceptions.add(base);

    const { exception } = await appendLongTaskException(
      task.id,
      {
        occurrenceDate: '2026-11-10',
        changeKind: 'correction',
        state: { mode: 'override', patch: { note: '补记' } },
        reason: '历史修正',
      },
      ctx(task),
      database,
    );

    expect(exception.revision).toBe(2);
    expect(exception.changeKind).toBe('correction');
  });

  it('撤销恢复原始安排，重复撤销被拒绝，撤销后仍可再修正', async () => {
    const { task } = await seedTask();
    const first = await appendLongTaskException(
      task.id,
      { occurrenceDate: TODAY, changeKind: 'initial', state: { mode: 'skip' } },
      ctx(task),
      database,
    );
    const revoked = await revokeLongTaskException(
      task.id,
      { occurrenceDate: TODAY, reason: '不跳过了' },
      { expectedUpdatedAt: first.task.updatedAt, now: NOW, today: TODAY },
      database,
    );

    expect(revoked.exception.after).toEqual({ mode: 'rule' });
    expect(revoked.exception.changeKind).toBe('revocation');

    await expect(
      revokeLongTaskException(
        task.id,
        { occurrenceDate: TODAY, reason: '再撤一次' },
        { expectedUpdatedAt: revoked.task.updatedAt, now: NOW, today: TODAY },
        database,
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    const corrected = await appendLongTaskException(
      task.id,
      {
        occurrenceDate: TODAY,
        changeKind: 'correction',
        state: { mode: 'override', patch: { note: '又改了' } },
        reason: '重新调整',
      },
      { expectedUpdatedAt: revoked.task.updatedAt, now: NOW, today: TODAY },
      database,
    );
    expect(corrected.exception.revision).toBe(3);
    expect(corrected.exception.before).toEqual({ mode: 'rule' });
  });

  it('持久化阶段失败时例外与 updatedAt 整体回滚', async () => {
    const { task } = await seedTask();
    const stop = injectFailure(database.longTaskExceptions as unknown as HookableTable, 'creating');
    try {
      await expect(
        appendLongTaskException(
          task.id,
          { occurrenceDate: TODAY, changeKind: 'initial', state: { mode: 'skip' } },
          ctx(task),
          database,
        ),
      ).rejects.toThrow('注入失败');
    } finally {
      stop();
    }

    expect(await database.longTaskExceptions.count()).toBe(0);
    expect((await reload(task.id)).updatedAt).toBe(task.updatedAt);
  });
});

describe('appendLongTaskLifecycleEvent', () => {
  it('暂停与恢复按日期链式写入', async () => {
    const { task } = await seedTask();
    const paused = await appendLongTaskLifecycleEvent(
      task.id,
      { type: 'paused', date: TODAY, note: '出差' },
      ctx(task),
      database,
    );
    const resumed = await appendLongTaskLifecycleEvent(
      task.id,
      { type: 'resumed', date: TOMORROW },
      { expectedUpdatedAt: paused.updatedAt, now: NOW, today: TODAY },
      database,
    );

    expect(resumed.events.map((event) => event.type)).toEqual(['created', 'paused', 'resumed']);
    expect(resumed.events[1]?.note).toBe('出差');
  });

  it('拒绝同日重复转换与倒填过去', async () => {
    const { task } = await seedTask();
    const paused = await appendLongTaskLifecycleEvent(
      task.id,
      { type: 'paused', date: TODAY },
      ctx(task),
      database,
    );

    await expect(
      appendLongTaskLifecycleEvent(
        task.id,
        { type: 'resumed', date: TODAY },
        { expectedUpdatedAt: paused.updatedAt, now: NOW, today: TODAY },
        database,
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      appendLongTaskLifecycleEvent(
        task.id,
        { type: 'ended', date: '2026-11-18' },
        { expectedUpdatedAt: paused.updatedAt, now: NOW, today: TODAY },
        database,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('持久化失败时 events 与 updatedAt 回滚', async () => {
    const { task } = await seedTask();
    const stop = injectFailure(database.longTasks as unknown as HookableTable, 'updating');
    try {
      await expect(
        appendLongTaskLifecycleEvent(task.id, { type: 'paused', date: TODAY }, ctx(task), database),
      ).rejects.toThrow('注入失败');
    } finally {
      stop();
    }

    const stored = await reload(task.id);
    expect(stored.events).toHaveLength(1);
    expect(stored.updatedAt).toBe(task.updatedAt);
  });
});

describe('reopenLongTaskWithRuleVersion', () => {
  async function endedTask() {
    const { task } = await seedTask();
    const ended = await appendLongTaskLifecycleEvent(
      task.id,
      { type: 'ended', date: TODAY },
      ctx(task),
      database,
    );
    return ended;
  }

  it('同一个事务写入 reopened 与新版本', async () => {
    const ended = await endedTask();
    const { task, version } = await reopenLongTaskWithRuleVersion(
      ended.id,
      { date: TOMORROW, spec: { kind: 'weekly', weekdays: [1, 3] } },
      ctx(ended),
      database,
    );

    expect(task.events.map((event) => event.type)).toEqual(['created', 'ended', 'reopened']);
    expect(version.versionNo).toBe(2);
    expect(version.effectiveFrom).toBe(TOMORROW);
  });

  it('effectiveFrom 更晚时版本从该日生效（中间段沿用上一版）', async () => {
    const ended = await endedTask();
    const { version } = await reopenLongTaskWithRuleVersion(
      ended.id,
      { date: TOMORROW, effectiveFrom: '2026-11-22', spec: { kind: 'daily' } },
      ctx(ended),
      database,
    );

    expect(version.effectiveFrom).toBe('2026-11-22');
  });

  it('effectiveFrom 早于重开日、非 ended 状态都被拒绝', async () => {
    const ended = await endedTask();
    await expect(
      reopenLongTaskWithRuleVersion(
        ended.id,
        { date: TOMORROW, effectiveFrom: TODAY, spec: { kind: 'daily' } },
        ctx(ended),
        database,
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    const { task } = await seedTask({ title: '未结束' });
    await expect(
      reopenLongTaskWithRuleVersion(
        task.id,
        { date: TOMORROW, spec: { kind: 'daily' } },
        ctx(task),
        database,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('版本写入失败时 reopened 事件也不存在', async () => {
    const ended = await endedTask();
    const stop = injectFailure(
      database.longTaskRuleVersions as unknown as HookableTable,
      'creating',
    );
    try {
      await expect(
        reopenLongTaskWithRuleVersion(
          ended.id,
          { date: TOMORROW, spec: { kind: 'daily' } },
          ctx(ended),
          database,
        ),
      ).rejects.toThrow('注入失败');
    } finally {
      stop();
    }

    const stored = await reload(ended.id);
    expect(stored.events).toHaveLength(2);
    expect(await database.longTaskRuleVersions.where('taskId').equals(ended.id).count()).toBe(1);
  });

  it('主记录写入失败时新版本一起回滚', async () => {
    const ended = await endedTask();
    const stop = injectFailure(database.longTasks as unknown as HookableTable, 'updating');
    try {
      await expect(
        reopenLongTaskWithRuleVersion(
          ended.id,
          { date: TOMORROW, spec: { kind: 'daily' } },
          ctx(ended),
          database,
        ),
      ).rejects.toThrow('注入失败');
    } finally {
      stop();
    }

    expect(await database.longTaskRuleVersions.where('taskId').equals(ended.id).count()).toBe(1);
  });

  it('count 不重置：重开后的槽位继续累计', async () => {
    const { task } = await seedTask({
      startDate: TODAY,
      endCondition: { type: 'count', count: 5 },
    });
    const ended = await appendLongTaskLifecycleEvent(
      task.id,
      { type: 'ended', date: TOMORROW },
      ctx(task),
      database,
    );
    const { task: reopened } = await reopenLongTaskWithRuleVersion(
      ended.id,
      { date: '2026-11-22', spec: { kind: 'daily' } },
      ctx(ended, { today: '2026-11-21' }),
      database,
    );
    const versions = await database.longTaskRuleVersions
      .where('taskId')
      .equals(reopened.id)
      .toArray();

    const slots = computeSlots({
      task: reopened,
      versions,
      exceptions: [],
      dateUpper: '2026-11-30',
    });

    expect(slots.map((slot) => slot.date)).toEqual([
      '2026-11-19',
      '2026-11-22',
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
    ]);
    expect(slots.map((slot) => slot.slotIndex)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('归档 / 软删除 / 恢复 / 彻底删除', () => {
  it('归档与取消归档幂等且不推进 updatedAt', async () => {
    const { task } = await seedTask();
    const archived = await setLongTaskArchived(task.id, true, ctx(task), database);
    expect(archived.archivedAt).toBe(NOW);

    const again = await setLongTaskArchived(task.id, true, ctx(archived), database);
    expect(again.updatedAt).toBe(archived.updatedAt);

    const restored = await setLongTaskArchived(task.id, false, ctx(again), database);
    expect(restored.archivedAt).toBeNull();
    expect(restored.updatedAt > archived.updatedAt).toBe(true);
  });

  it('软删除保留归档标记与计划关联，恢复只清 deletedAt', async () => {
    const { task } = await seedTask();
    const archived = await setLongTaskArchived(task.id, true, ctx(task), database);
    const deleted = await softDeleteLongTask(task.id, ctx(archived), database);

    expect(deleted.deletedAt).toBe(NOW);
    expect(deleted.archivedAt).toBe(archived.archivedAt);

    const twice = await softDeleteLongTask(task.id, ctx(deleted), database);
    expect(twice.updatedAt).toBe(deleted.updatedAt);

    const restored = await restoreLongTask(task.id, ctx(twice), database);
    expect(restored.deletedAt).toBeNull();
    expect(restored.archivedAt).toBe(archived.archivedAt);

    const twiceRestore = await restoreLongTask(task.id, ctx(restored), database);
    expect(twiceRestore.updatedAt).toBe(restored.updatedAt);
  });

  it('彻底删除三张表并返回删除条数', async () => {
    const { task } = await seedTask();
    const first = await appendLongTaskException(
      task.id,
      { occurrenceDate: TODAY, changeKind: 'initial', state: { mode: 'skip' } },
      ctx(task),
      database,
    );

    const result = await purgeLongTask(task.id, ctx(first.task), database);

    expect(result).toEqual({ task: 1, versions: 1, exceptions: 1 });
    expect(await counts()).toEqual({ tasks: 0, versions: 0, exceptions: 0 });
  });

  it('彻底删除要求乐观锁匹配且任务存在', async () => {
    const { task } = await seedTask();
    await expect(
      purgeLongTask(task.id, { expectedUpdatedAt: 'old' }, database),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await counts()).toEqual({ tasks: 1, versions: 1, exceptions: 0 });

    await expect(purgeLongTask('missing', ctx(task), database)).rejects.toThrow('不存在');
  });

  it('删除中途失败时三张表全部保留', async () => {
    const { task } = await seedTask();
    await appendLongTaskException(
      task.id,
      { occurrenceDate: TODAY, changeKind: 'initial', state: { mode: 'skip' } },
      ctx(task),
      database,
    );
    const before = await counts();

    const stop = injectFailure(database.longTasks as unknown as HookableTable, 'deleting');
    try {
      await expect(
        purgeLongTask(task.id, { expectedUpdatedAt: (await reload(task.id)).updatedAt }, database),
      ).rejects.toThrow('注入失败');
    } finally {
      stop();
    }

    expect(await counts()).toEqual(before);
  });
});

describe('并发与隔离', () => {
  it('两次并发基本信息修改只有一次成功', async () => {
    const { task } = await seedTask();
    const results = await Promise.allSettled([
      updateLongTaskInfo(task.id, { note: 'A' }, ctx(task), database),
      updateLongTaskInfo(task.id, { note: 'B' }, ctx(task), database),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('不同长期任务的写入互不影响', async () => {
    const a = await seedTask({ title: 'A' });
    const b = await seedTask({ title: 'B' });

    const [nextA] = await Promise.all([
      updateLongTaskInfo(a.task.id, { note: 'a' }, ctx(a.task), database),
      updateLongTaskInfo(b.task.id, { note: 'b' }, ctx(b.task), database),
    ]);

    expect(nextA.note).toBe('a');
    expect((await reload(b.task.id)).note).toBe('b');
  });
});

describe('写入层不破坏读取层', () => {
  it('写入后聚合读取仍返回完整历史', async () => {
    const { task } = await seedTask();
    const { exception } = await appendLongTaskException(
      task.id,
      { occurrenceDate: TODAY, changeKind: 'initial', state: { mode: 'skip' } },
      ctx(task),
      database,
    );
    const taskRow = (await reload(task.id)) as LongTask;
    const versions = (await database.longTaskRuleVersions
      .where('taskId')
      .equals(task.id)
      .toArray()) as LongTaskRuleVersion[];

    expect(taskRow.events).toHaveLength(1);
    expect(versions).toHaveLength(1);
    expect(exception.occurrenceDate).toBe(TODAY);
  });
});
