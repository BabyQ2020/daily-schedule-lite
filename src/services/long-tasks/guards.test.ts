import { describe, expect, it } from 'vitest';

import type {
  LifecycleEvent,
  LongTask,
  LongTaskException,
  LongTaskRuleVersion,
} from '@/domain/long-task';

import {
  canChangeRuleOn,
  canEndOn,
  canExceptionOn,
  canPauseOn,
  canReopenOn,
  canResumeOn,
  validateCorrection,
  validateExceptionChain,
  validateExceptionWrite,
  validateLifecycle,
  validateLifecycleUpdate,
  validateLongTask,
  validateRuleVersion,
} from './guards';

function event(type: LifecycleEvent['type'], date: string): LifecycleEvent {
  return { id: `${type}-${date}`, type, date, note: null, createdAt: `${date}T00:00:00.000Z` };
}

function task(events: LifecycleEvent[], over: Partial<LongTask> = {}): LongTask {
  return {
    id: 'task-1',
    title: '每周复盘',
    description: '',
    note: '',
    priority: 'medium',
    startDate: '2026-11-02',
    endDate: null,
    endCondition: { type: 'never' },
    tags: [],
    events,
    deletedAt: null,
    archivedAt: null,
    createdAt: '2026-11-02T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
    ...over,
  };
}

function version(effectiveFrom: string): LongTaskRuleVersion {
  return {
    id: `v-${effectiveFrom}`,
    taskId: 'task-1',
    versionNo: 1,
    effectiveFrom,
    spec: { kind: 'daily' },
    changeNote: null,
    createdAt: `${effectiveFrom}T00:00:00.000Z`,
  };
}

const TODAY = '2026-11-10';

describe('生命周期校验', () => {
  it('只有创建事件时合法', () => {
    expect(
      validateLifecycle([event('created', '2026-11-02')], {
        startDate: '2026-11-02',
        today: TODAY,
      }),
    ).toEqual([]);
  });

  it('创建日与首次计划日不一致时报 L0', () => {
    const issues = validateLifecycle([event('created', '2026-11-03')], {
      startDate: '2026-11-02',
      today: TODAY,
    });
    expect(issues.map((issue) => issue.code)).toContain('L0');
  });

  it('重复创建事件报 L0', () => {
    const issues = validateLifecycle(
      [event('created', '2026-11-02'), event('created', '2026-11-02')],
      {
        startDate: '2026-11-02',
        today: TODAY,
      },
    );
    expect(issues.some((issue) => issue.code === 'L0')).toBe(true);
  });

  it('创建当天暂停一次是允许的（created 不算状态转换）', () => {
    const issues = validateLifecycle(
      [event('created', '2026-11-02'), event('paused', '2026-11-02')],
      { startDate: '2026-11-02', today: '2026-11-02' },
    );
    expect(issues).toEqual([]);
  });

  it('同一天两次状态转换报 L1', () => {
    const issues = validateLifecycle(
      [
        event('created', '2026-11-02'),
        event('paused', '2026-11-03'),
        event('resumed', '2026-11-03'),
      ],
      { startDate: '2026-11-02', today: TODAY },
    );
    expect(issues.some((issue) => issue.code === 'L1')).toBe(true);
  });

  it('状态转换倒填到过去报 L3', () => {
    const issues = validateLifecycle(
      [event('created', '2026-11-02'), event('paused', '2026-11-05')],
      { startDate: '2026-11-02', today: TODAY },
    );
    expect(issues.some((issue) => issue.code === 'L3')).toBe(true);
  });

  it('关闭历史校验时允许读取旧数据', () => {
    const issues = validateLifecycle(
      [event('created', '2026-11-02'), event('paused', '2026-11-05')],
      { startDate: '2026-11-02', today: TODAY, enforceHistory: false },
    );
    expect(issues).toEqual([]);
  });

  it('未暂停就恢复、未结束就重开都报 L4', () => {
    const resumed = validateLifecycle(
      [event('created', '2026-11-02'), event('resumed', '2026-11-05')],
      { startDate: '2026-11-02', today: TODAY, enforceHistory: false },
    );
    expect(resumed.some((issue) => issue.code === 'L4')).toBe(true);

    const reopened = validateLifecycle(
      [event('created', '2026-11-02'), event('reopened', '2026-11-05')],
      { startDate: '2026-11-02', today: TODAY, enforceHistory: false },
    );
    expect(reopened.some((issue) => issue.code === 'L4')).toBe(true);
  });
});

describe('规则版本校验', () => {
  it('无版本时今天可以生效', () => {
    expect(
      validateRuleVersion({
        versions: [],
        effectiveFrom: TODAY,
        spec: { kind: 'daily' },
        today: TODAY,
      }),
    ).toEqual([]);
  });

  it('过去日期报 R1', () => {
    const issues = validateRuleVersion({
      versions: [],
      effectiveFrom: '2026-11-09',
      spec: { kind: 'daily' },
      today: TODAY,
    });
    expect(issues.map((issue) => issue.code)).toContain('R1');
  });

  it('与上一版同一天报 R2（同一天只能一个版本）', () => {
    const issues = validateRuleVersion({
      versions: [version(TODAY)],
      effectiveFrom: TODAY,
      spec: { kind: 'daily' },
      today: TODAY,
    });
    expect(issues.map((issue) => issue.code)).toContain('R2');
  });

  it('空的每周规则报 R0', () => {
    const issues = validateRuleVersion({
      versions: [],
      effectiveFrom: TODAY,
      spec: { kind: 'weekly', weekdays: [] },
      today: TODAY,
    });
    expect(issues.map((issue) => issue.code)).toContain('R0');
  });

  it('晚于结束日生效报 R3', () => {
    const issues = validateRuleVersion({
      versions: [],
      effectiveFrom: '2026-12-01',
      spec: { kind: 'daily' },
      today: TODAY,
      hardStop: '2026-11-30',
    });
    expect(issues.map((issue) => issue.code)).toContain('R3');
  });
});

describe('日期守卫', () => {
  it('规则修改：今天可改，昨天不可改，与上一版同日不可改', () => {
    const versions = [version('2026-11-08')];
    expect(canChangeRuleOn(TODAY, { versions, today: TODAY }).ok).toBe(true);
    expect(canChangeRuleOn('2026-11-09', { versions, today: TODAY })).toEqual({
      ok: false,
      reason: '规则只能从今天（2026-11-10）起调整。',
    });
    expect(canChangeRuleOn('2026-11-08', { versions, today: TODAY }).ok).toBe(false);
  });

  it('暂停：进行中才能暂停，且必须晚于最近状态变更', () => {
    const active = task([event('created', '2026-11-02')]);
    expect(canPauseOn(TODAY, active, TODAY).ok).toBe(true);

    const paused = task([event('created', '2026-11-02'), event('paused', '2026-11-05')]);
    expect(canPauseOn(TODAY, paused, TODAY).ok).toBe(false);
  });

  it('恢复：暂停中的任务，日期必须严格晚于暂停日', () => {
    const paused = task([event('created', '2026-11-02'), event('paused', '2026-11-05')]);
    expect(canResumeOn(TODAY, paused, TODAY).ok).toBe(true);
    expect(canResumeOn('2026-11-05', paused, TODAY).ok).toBe(false);
  });

  it('结束：已结束的任务不能再结束', () => {
    const ended = task([event('created', '2026-11-02'), event('ended', '2026-11-06')]);
    expect(canEndOn(TODAY, ended, TODAY).ok).toBe(false);
  });

  it('重新启用：只有已结束且日期晚于结束日才可', () => {
    const active = task([event('created', '2026-11-02')]);
    expect(canReopenOn(TODAY, active, TODAY).ok).toBe(false);

    const ended = task([event('created', '2026-11-02'), event('ended', '2026-11-06')]);
    expect(canReopenOn(TODAY, ended, TODAY).ok).toBe(true);
    expect(canReopenOn('2026-11-06', ended, TODAY).ok).toBe(false);
  });

  it('过去的例外必须走 correction 并填写原因', () => {
    expect(validateCorrection(null).map((issue) => issue.code)).toContain('E1');
    expect(validateCorrection('  ').map((issue) => issue.code)).toContain('E1');
    expect(validateCorrection('日期填错了')).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * P2 修复：聚合校验、真实日期、增量生命周期、例外槽位与修订链
 * ------------------------------------------------------------------ */

function rule(
  versionNo: number,
  effectiveFrom: string,
  spec: LongTaskRuleVersion['spec'] = { kind: 'daily' },
): LongTaskRuleVersion {
  return {
    id: `v-${versionNo}-${effectiveFrom}`,
    taskId: 'task-1',
    versionNo,
    effectiveFrom,
    spec,
    changeNote: null,
    createdAt: `${effectiveFrom}T00:00:00.000Z`,
  };
}

function exc(date: string, over: Partial<LongTaskException> = {}): LongTaskException {
  const revision = over.revision ?? 1;
  return {
    id: over.id ?? `x-${date}-${revision}`,
    taskId: 'task-1',
    occurrenceDate: date,
    revision,
    previousRevisionId: revision > 1 ? `x-${date}-${revision - 1}` : null,
    changeKind: revision > 1 ? 'correction' : 'initial',
    baseOccurrence: {
      date,
      slotIndex: 1,
      versionId: 'v-1',
      title: '每周复盘',
      description: '',
      note: '',
      priority: 'medium',
      dueDate: null,
      tags: [],
    },
    before: { mode: 'rule' },
    after: { mode: 'skip' },
    reason: revision > 1 ? '调整' : null,
    createdAt: `${date}T00:00:00.000Z`,
    ...over,
  };
}

describe('聚合校验', () => {
  it('count=0、负数、小数都报 A3', () => {
    for (const count of [0, -1, 1.5]) {
      const issues = validateLongTask({
        task: task([event('created', '2026-11-02')], {
          endCondition: { type: 'count', count },
        }),
        versions: [rule(1, '2026-11-02')],
        today: TODAY,
      });
      expect(issues.map((issue) => issue.code)).toContain('A3');
    }
  });

  it('截止日与重复结束日同时设置时报 A2', () => {
    const issues = validateLongTask({
      task: task([event('created', '2026-11-02')], {
        endDate: '2026-11-30',
        endCondition: { type: 'until', until: '2026-11-20' },
      }),
      versions: [rule(1, '2026-11-02')],
      today: TODAY,
    });
    expect(issues.map((issue) => issue.code)).toContain('A2');
  });

  it('识别不存在的日期（2026-02-30），闰年 2 月 29 日合法', () => {
    const bad = validateLongTask({
      task: task([event('created', '2026-02-30')], { startDate: '2026-02-30' }),
      versions: [rule(1, '2026-02-30')],
      today: TODAY,
    });
    expect(bad.map((issue) => issue.code)).toContain('A1');

    const leap = validateLongTask({
      task: task([event('created', '2028-02-29')], { startDate: '2028-02-29' }),
      versions: [rule(1, '2028-02-29')],
      today: '2028-02-29',
    });
    expect(leap).toEqual([]);
  });

  it('规则生效日早于首次计划日报 A7', () => {
    const issues = validateLongTask({
      task: task([event('created', '2026-11-10')], { startDate: '2026-11-10' }),
      versions: [rule(1, '2026-11-02')],
      today: TODAY,
    });
    expect(issues.map((issue) => issue.code)).toContain('A7');
  });

  it('同一天两个版本报 A8，版本号不递增报 A9', () => {
    const sameDay = validateLongTask({
      task: task([event('created', '2026-11-02')]),
      versions: [rule(1, '2026-11-02'), rule(2, '2026-11-02')],
      today: TODAY,
    });
    expect(sameDay.map((issue) => issue.code)).toContain('A8');

    const badNo = validateLongTask({
      task: task([event('created', '2026-11-02')]),
      versions: [rule(2, '2026-11-02'), rule(1, '2026-11-05')],
      today: TODAY,
    });
    expect(badNo.map((issue) => issue.code)).toContain('A9');
  });

  it('传入例外时一并校验修订链（断链报 E8）', () => {
    const issues = validateLongTask({
      task: task([event('created', '2026-11-02')]),
      versions: [rule(1, '2026-11-02')],
      today: TODAY,
      exceptions: [exc('2026-11-05', { revision: 2, previousRevisionId: 'nope' })],
    });
    expect(issues.map((issue) => issue.code)).toContain('E8');
  });
});

describe('生命周期增量校验', () => {
  const existing = [
    event('created', '2026-11-02'),
    event('paused', '2026-11-05'),
    event('resumed', '2026-11-08'),
  ];

  it('编辑历史任务的非日期字段不会被历史保护误拒', () => {
    const next = existing.map((item) => ({ ...item }));
    expect(
      validateLifecycleUpdate(existing, next, { startDate: '2026-11-02', today: TODAY }),
    ).toEqual([]);
  });

  it('删除既有事件报 L5', () => {
    const next = existing.slice(0, 2);
    const issues = validateLifecycleUpdate(existing, next, {
      startDate: '2026-11-02',
      today: TODAY,
    });
    expect(issues.map((issue) => issue.code)).toContain('L5');
  });

  it('修改既有事件日期报 L5', () => {
    const next = existing.map((item) =>
      item.type === 'paused' ? { ...item, date: '2026-11-06' } : item,
    );
    const issues = validateLifecycleUpdate(existing, next, {
      startDate: '2026-11-02',
      today: TODAY,
    });
    expect(issues.map((issue) => issue.code)).toContain('L5');
  });

  it('新增倒填到过去的状态转换报 L3', () => {
    const next = [...existing, event('paused', '2026-11-09')];
    const issues = validateLifecycleUpdate(existing, next, {
      startDate: '2026-11-02',
      today: TODAY,
    });
    expect(issues.map((issue) => issue.code)).toContain('L3');
  });
});

describe('例外槽位与修订链', () => {
  const baseTask = task([event('created', '2026-11-02')]);
  const versions = [rule(1, '2026-11-02')];

  it('非执行日不能写例外（E3）', () => {
    const issues = validateExceptionWrite({
      task: baseTask,
      versions,
      exceptions: [],
      occurrenceDate: '2026-10-30',
      changeKind: 'initial',
      after: { mode: 'skip' },
      reason: null,
      today: TODAY,
      revision: 1,
      previousRevisionId: null,
    });
    expect(issues.map((issue) => issue.code)).toContain('E3');
  });

  it('过去日期直接 initial 报 E11，correction 缺原因报 E1', () => {
    const initial = validateExceptionWrite({
      task: baseTask,
      versions,
      exceptions: [],
      occurrenceDate: '2026-11-05',
      changeKind: 'initial',
      after: { mode: 'skip' },
      reason: null,
      today: TODAY,
      revision: 1,
      previousRevisionId: null,
    });
    expect(initial.map((issue) => issue.code)).toContain('E11');

    const correction = validateExceptionWrite({
      task: baseTask,
      versions,
      exceptions: [exc('2026-11-05', { after: { mode: 'skip' } })],
      occurrenceDate: '2026-11-05',
      changeKind: 'correction',
      after: { mode: 'skip' },
      reason: '  ',
      today: TODAY,
      revision: 2,
      previousRevisionId: 'x-2026-11-05-1',
    });
    expect(correction.map((issue) => issue.code)).toContain('E1');
  });

  it('重复修订号与断链分别报 E7、E8', () => {
    const duplicate = validateExceptionChain([
      exc('2026-11-05', { revision: 1 }),
      exc('2026-11-05', { revision: 1, id: 'x-other' }),
    ]);
    expect(duplicate.map((issue) => issue.code)).toContain('E7');

    const broken = validateExceptionChain([
      exc('2026-11-05', { revision: 1 }),
      exc('2026-11-05', { revision: 2, previousRevisionId: 'not-exist' }),
    ]);
    expect(broken.map((issue) => issue.code)).toContain('E8');
  });

  it('skip 之后可以 correction 改成 override', () => {
    const issues = validateExceptionWrite({
      task: baseTask,
      versions,
      exceptions: [exc('2026-11-05', { after: { mode: 'skip' } })],
      occurrenceDate: '2026-11-05',
      changeKind: 'correction',
      after: { mode: 'override', patch: { title: '改期评审' } },
      reason: '临时调整',
      today: TODAY,
      revision: 2,
      previousRevisionId: 'x-2026-11-05-1',
    });
    expect(issues).toEqual([]);
  });

  it('revocation 恢复原始规则安排（after 必须是 rule）', () => {
    const issues = validateExceptionWrite({
      task: baseTask,
      versions,
      exceptions: [exc('2026-11-05', { after: { mode: 'override', patch: { title: 'x' } } })],
      occurrenceDate: '2026-11-05',
      changeKind: 'revocation',
      after: { mode: 'rule' },
      reason: '撤销之前的修改',
      today: TODAY,
      revision: 2,
      previousRevisionId: 'x-2026-11-05-1',
    });
    expect(issues).toEqual([]);

    const wrong = validateExceptionWrite({
      task: baseTask,
      versions,
      exceptions: [exc('2026-11-05', { after: { mode: 'override', patch: { title: 'x' } } })],
      occurrenceDate: '2026-11-05',
      changeKind: 'revocation',
      after: { mode: 'skip' },
      reason: '撤销',
      today: TODAY,
      revision: 2,
      previousRevisionId: 'x-2026-11-05-1',
    });
    expect(wrong.map((issue) => issue.code)).toContain('E12');
  });

  it('该日期不是执行日时 canExceptionOn 返回不可用', () => {
    const gate = canExceptionOn('2026-10-30', {
      today: TODAY,
      task: baseTask,
      versions,
      exceptions: [],
    });
    expect(gate.ok).toBe(false);
    expect(gate.requiresCorrection).toBe(true);
  });

  it('修订号跳号或前序指向错误报 E15', () => {
    const jump = validateExceptionWrite({
      task: baseTask,
      versions,
      exceptions: [exc('2026-11-05', { after: { mode: 'skip' } })],
      occurrenceDate: '2026-11-05',
      changeKind: 'correction',
      after: { mode: 'skip' },
      reason: '调整',
      today: TODAY,
      revision: 3,
      previousRevisionId: 'x-2026-11-05-1',
    });
    expect(jump.map((issue) => issue.code)).toContain('E15');

    const wrongPrevious = validateExceptionWrite({
      task: baseTask,
      versions,
      exceptions: [exc('2026-11-05', { after: { mode: 'skip' } })],
      occurrenceDate: '2026-11-05',
      changeKind: 'correction',
      after: { mode: 'skip' },
      reason: '调整',
      today: TODAY,
      revision: 2,
      previousRevisionId: null,
    });
    expect(wrongPrevious.map((issue) => issue.code)).toContain('E15');
  });

  it('单次截止日非法报 E16', () => {
    const issues = validateExceptionWrite({
      task: baseTask,
      versions,
      exceptions: [],
      occurrenceDate: '2026-11-12',
      changeKind: 'initial',
      after: { mode: 'override', patch: { dueDate: '2026-02-30' } },
      reason: null,
      today: TODAY,
      revision: 1,
      previousRevisionId: null,
    });
    expect(issues.map((issue) => issue.code)).toContain('E16');
  });
});
