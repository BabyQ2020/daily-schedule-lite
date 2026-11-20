import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { WorkbenchDatabase } from '@/db/db';
import type { ISODate } from '@/lib/period';
import { createTestDatabase, destroyTestDatabase } from '@/test/db';

import { ConflictError, NotFoundError, ValidationError } from '@/repositories/errors';
import {
  addLifecycleEvent,
  appendRuleVersion,
  createLongTask,
  getAggregate,
  listOccurrences,
  move,
  reopenWithRuleVersion,
  replaceRule,
  revokeException,
  updateLongTaskInfoById,
  writeException,
  type CreateLongTaskRequest,
  type ServiceDeps,
} from './service';

const TODAY: ISODate = '2026-11-19';
const NOW = '2026-11-19T08:00:00.000Z';

let database: WorkbenchDatabase;
let deps: ServiceDeps;

beforeEach(() => {
  database = createTestDatabase('long-task-service');
  deps = { database, now: NOW, today: TODAY };
});

afterEach(async () => {
  await destroyTestDatabase(database);
});

async function seed(overrides: Partial<CreateLongTaskRequest> = {}) {
  const { id } = await createLongTask(
    { title: '每日复盘', startDate: TODAY, spec: { kind: 'daily' }, ...overrides },
    deps,
  );
  const aggregate = await getAggregate(id, deps);
  if (!aggregate) throw new Error('测试夹具创建失败');
  return { id, aggregate };
}

function ctxOf(aggregate: { task: { updatedAt: string } }) {
  return { expectedUpdatedAt: aggregate.task.updatedAt };
}

describe('createLongTask', () => {
  it('默认首次计划日取今天，并写入创建事件与首版规则', async () => {
    const { id, aggregate } = await seed({ startDate: undefined });

    expect(aggregate.task.startDate).toBe(TODAY);
    expect(aggregate.task.events).toHaveLength(1);
    expect(aggregate.task.events[0]?.type).toBe('created');
    expect(aggregate.task.events[0]?.date).toBe(TODAY);
    expect(aggregate.versions).toHaveLength(1);
    expect(aggregate.versions[0]?.versionNo).toBe(1);
    expect(aggregate.versions[0]?.effectiveFrom).toBe(TODAY);
    expect(await getAggregate(id, deps)).not.toBeNull();
  });

  it('允许显式传入过去的首次计划日（补录历史系列）', async () => {
    const { aggregate } = await seed({ startDate: '2026-11-01' });
    expect(aggregate.task.startDate).toBe('2026-11-01');
  });
});

describe('getAggregate', () => {
  it('不存在的任务返回 null', async () => {
    expect(await getAggregate('missing', deps)).toBeNull();
  });

  it('返回完整聚合（版本与例外），供页面直接渲染', async () => {
    const { id, aggregate } = await seed();
    await writeException(
      id,
      {
        ...ctxOf(aggregate),
        occurrenceDate: '2026-11-20',
        changeKind: 'initial',
        state: { mode: 'skip' },
      },
      deps,
    );

    const next = await getAggregate(id, deps);
    expect(next?.versions).toHaveLength(1);
    expect(next?.exceptions).toHaveLength(1);
    expect(next?.exceptions[0]?.revision).toBe(1);
  });
});

describe('listOccurrences', () => {
  it('按窗口返回可见安排', async () => {
    const { id } = await seed();
    const occurrences = await listOccurrences(id, TODAY, '2026-11-21', deps);

    expect(occurrences.map((item) => item.date)).toEqual([
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
    ]);
    expect(occurrences.map((item) => item.slotIndex)).toEqual([1, 2, 3]);
    expect(occurrences[0]?.overridden).toBe(false);
  });

  it('skip 例外不返回，但仍占用槽位号', async () => {
    const { id, aggregate } = await seed();
    await writeException(
      id,
      {
        ...ctxOf(aggregate),
        occurrenceDate: '2026-11-20',
        changeKind: 'initial',
        state: { mode: 'skip' },
      },
      deps,
    );

    const occurrences = await listOccurrences(id, TODAY, '2026-11-21', deps);
    expect(occurrences.map((item) => item.date)).toEqual(['2026-11-19', '2026-11-21']);
    expect(occurrences.map((item) => item.slotIndex)).toEqual([1, 3]);
  });

  it('override 的标题与单次截止日反映在安排上，且原始安排不变', async () => {
    const { id, aggregate } = await seed();
    await writeException(
      id,
      {
        ...ctxOf(aggregate),
        occurrenceDate: '2026-11-20',
        changeKind: 'initial',
        state: { mode: 'override', patch: { title: '只改这一次', dueDate: '2026-11-22' } },
      },
      deps,
    );

    const occurrences = await listOccurrences(id, '2026-11-20', '2026-11-20', deps);
    expect(occurrences[0]).toMatchObject({
      title: '只改这一次',
      dueDate: '2026-11-22',
      overridden: true,
    });

    const next = await getAggregate(id, deps);
    expect(next?.exceptions[0]?.baseOccurrence.title).toBe('每日复盘');
    expect(next?.exceptions[0]?.baseOccurrence.dueDate).toBeNull();
  });

  it('窗口只做过滤：分窗拼接与整段查询结果一致', async () => {
    const { id } = await seed({ endCondition: { type: 'count', count: 5 } });

    const whole = await listOccurrences(id, TODAY, '2026-11-30', deps);
    const first = await listOccurrences(id, TODAY, '2026-11-20', deps);
    const second = await listOccurrences(id, '2026-11-21', '2026-11-30', deps);

    expect([...first, ...second].map((item) => item.date)).toEqual(whole.map((item) => item.date));
    expect(whole.map((item) => item.date)).toEqual([
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
      '2026-11-23',
    ]);
  });

  it('ended 当天起不再生成安排', async () => {
    const { id, aggregate } = await seed();
    await addLifecycleEvent(id, { ...ctxOf(aggregate), type: 'ended', date: '2026-11-20' }, deps);

    const occurrences = await listOccurrences(id, TODAY, '2026-11-22', deps);
    expect(occurrences.map((item) => item.date)).toEqual([TODAY]);
  });

  it('暂停区间内不生成安排，恢复后继续', async () => {
    const { id, aggregate } = await seed();
    await addLifecycleEvent(id, { ...ctxOf(aggregate), type: 'paused', date: '2026-11-20' }, deps);
    const afterPause = await getAggregate(id, deps);
    if (!afterPause) throw new Error('聚合丢失');
    await addLifecycleEvent(
      id,
      { ...ctxOf(afterPause), type: 'resumed', date: '2026-11-22' },
      { ...deps, today: '2026-11-20' },
    );

    const occurrences = await listOccurrences(id, TODAY, '2026-11-23', deps);
    expect(occurrences.map((item) => item.date)).toEqual([TODAY, '2026-11-22', '2026-11-23']);
  });

  it('查询区间反向时报错', async () => {
    const { id } = await seed();
    await expect(listOccurrences(id, '2026-11-21', TODAY, deps)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('任务不存在时报 NotFoundError', async () => {
    await expect(listOccurrences('missing', TODAY, TODAY, deps)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('写入编排', () => {
  it('追加规则版本后按新规则生成安排', async () => {
    const { id, aggregate } = await seed();
    const version = await appendRuleVersion(
      id,
      { ...ctxOf(aggregate), effectiveFrom: '2026-11-21', spec: { kind: 'weekly', weekdays: [1] } },
      deps,
    );

    expect(version.versionNo).toBe(2);
    const occurrences = await listOccurrences(id, '2026-11-21', '2026-11-30', deps);
    // 2026-11-23 是周一；11-30 也是周一，但窗口止于 11-30 含当日。
    expect(occurrences.map((item) => item.date)).toEqual(['2026-11-23', '2026-11-30']);
  });

  it('基本信息修改走白名单并推进 updatedAt', async () => {
    const { id, aggregate } = await seed();
    const updated = await updateLongTaskInfoById(
      id,
      { ...ctxOf(aggregate), patch: { title: '每周复盘', note: '补充说明' } },
      deps,
    );

    expect(updated.title).toBe('每周复盘');
    expect(updated.note).toBe('补充说明');
    expect(updated.updatedAt > aggregate.task.updatedAt).toBe(true);
  });

  it('乐观锁不匹配时抛 ConflictError 且不写入', async () => {
    const { id } = await seed();
    await expect(
      updateLongTaskInfoById(
        id,
        { expectedUpdatedAt: '2000-01-01T00:00:00.000Z', patch: { title: '覆盖' } },
        deps,
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    const aggregate = await getAggregate(id, deps);
    expect(aggregate?.task.title).toBe('每日复盘');
  });

  it('撤销例外后恢复原始安排', async () => {
    const { id, aggregate } = await seed();
    await writeException(
      id,
      {
        ...ctxOf(aggregate),
        occurrenceDate: '2026-11-20',
        changeKind: 'initial',
        state: { mode: 'override', patch: { title: '改过' } },
      },
      deps,
    );
    const afterWrite = await getAggregate(id, deps);
    if (!afterWrite) throw new Error('聚合丢失');

    await revokeException(
      id,
      { ...ctxOf(afterWrite), occurrenceDate: '2026-11-20', reason: '改回原计划' },
      deps,
    );

    const occurrences = await listOccurrences(id, '2026-11-20', '2026-11-20', deps);
    expect(occurrences[0]?.title).toBe('每日复盘');
  });

  it('重开必须是 ended 状态，并原子追加新版本（DECISION-1 中间段沿用旧版）', async () => {
    const { id, aggregate } = await seed();
    await addLifecycleEvent(id, { ...ctxOf(aggregate), type: 'ended', date: TOMORROW() }, deps);
    const afterEnded = await getAggregate(id, deps);
    if (!afterEnded) throw new Error('聚合丢失');

    const version = await reopenWithRuleVersion(
      id,
      {
        expectedUpdatedAt: afterEnded.task.updatedAt,
        date: '2026-11-23',
        spec: { kind: 'weekly', weekdays: [1, 3] },
        effectiveFrom: '2026-11-25',
        changeNote: '改为每周一三',
      },
      { ...deps, today: '2026-11-23' },
    );

    expect(version.versionNo).toBe(2);
    const after = await getAggregate(id, deps);
    expect(after?.task.events.map((event) => event.type)).toEqual(['created', 'ended', 'reopened']);

    // 23–24 仍沿用上一版（每日），25 起才是每周一三（周三）。
    const occurrences = await listOccurrences(id, '2026-11-23', '2026-11-27', deps);
    expect(occurrences.map((item) => item.date)).toEqual([
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
    ]);
  });
});

describe('replaceRule / move', () => {
  it('覆盖规则：改写当前版本，立即生效且不新增版本', async () => {
    const { id, aggregate } = await seed();

    const version = await replaceRule(
      id,
      {
        expectedUpdatedAt: aggregate.task.updatedAt,
        spec: { kind: 'weekly', weekdays: [1, 3] },
        changeNote: '换成一三五',
      },
      deps,
    );

    expect(version.versionNo).toBe(1);
    expect(version.spec).toEqual({ kind: 'weekly', weekdays: [1, 3] });

    const after = await getAggregate(id, deps);
    expect(after?.versions).toHaveLength(1);
    expect(after?.versions[0]?.spec).toEqual({ kind: 'weekly', weekdays: [1, 3] });

    const occurrences = await listOccurrences(id, TODAY, '2026-11-25', deps);
    // 2026-11-19 是周四：覆盖后只剩周一（11-23）与周三（11-25）。
    expect(occurrences.map((item) => item.date)).toEqual(['2026-11-23', '2026-11-25']);
  });

  it('覆盖规则需要最新的 updatedAt，过期则拒绝', async () => {
    const { id, aggregate } = await seed();
    await expect(
      replaceRule(
        id,
        {
          expectedUpdatedAt: '2000-01-01T00:00:00.000Z',
          spec: { kind: 'daily' },
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(aggregate.task.updatedAt).toBeTruthy();
  });

  it('上移改变两条长期任务的手动顺序', async () => {
    const first = await seed({ title: '第一条' });
    const second = await seed({ title: '第二条' });

    await move(second.id, 'up', { expectedUpdatedAt: second.aggregate.task.updatedAt }, deps);

    const afterFirst = await getAggregate(first.id, deps);
    const afterSecond = await getAggregate(second.id, deps);
    expect(afterSecond?.task.sortOrder ?? 0).toBeLessThan(afterFirst?.task.sortOrder ?? 0);
  });

  it('已经是第一条时上移不改变顺序', async () => {
    const first = await seed({ title: '第一条' });
    const second = await seed({ title: '第二条' });

    await move(first.id, 'up', { expectedUpdatedAt: first.aggregate.task.updatedAt }, deps);

    const afterFirst = await getAggregate(first.id, deps);
    const afterSecond = await getAggregate(second.id, deps);
    expect(afterFirst?.task.sortOrder ?? 0).toBeLessThan(afterSecond?.task.sortOrder ?? 0);
  });
});

function TOMORROW(): ISODate {
  return '2026-11-20';
}
