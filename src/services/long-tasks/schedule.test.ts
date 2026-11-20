import { describe, expect, it } from 'vitest';

import type {
  LifecycleEvent,
  LongTask,
  LongTaskException,
  LongTaskRuleVersion,
  RecurrenceSpec,
} from '@/domain/long-task';

import {
  activeVersionOf,
  addDaysIso,
  computeSlots,
  deriveState,
  resolveMonthDays,
  resolveOccurrence,
  slotsInRange,
  upcomingSlots,
} from './schedule';

let seq = 0;

function event(type: LifecycleEvent['type'], date: string): LifecycleEvent {
  seq += 1;
  return { id: `e${seq}`, type, date, note: null, createdAt: `${date}T00:00:00.000Z` };
}

function task(over: Partial<LongTask> = {}): LongTask {
  return {
    id: 'task-1',
    title: '每日复盘',
    description: '',
    note: '',
    priority: 'medium',
    startDate: '2026-11-02',
    endDate: null,
    endCondition: { type: 'never' },
    tags: [],
    events: [event('created', '2026-11-02')],
    deletedAt: null,
    archivedAt: null,
    createdAt: '2026-11-02T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
    ...over,
  };
}

function version(
  versionNo: number,
  effectiveFrom: string,
  spec: RecurrenceSpec,
): LongTaskRuleVersion {
  return {
    id: `v${versionNo}`,
    taskId: 'task-1',
    versionNo,
    effectiveFrom,
    spec,
    changeNote: null,
    createdAt: `${effectiveFrom}T00:00:00.000Z`,
  };
}

function exception(
  date: string,
  after: LongTaskException['after'],
  revision = 1,
): LongTaskException {
  return {
    id: `x-${date}-${revision}`,
    taskId: 'task-1',
    occurrenceDate: date,
    revision,
    previousRevisionId: revision > 1 ? `x-${date}-${revision - 1}` : null,
    changeKind: revision > 1 ? 'correction' : 'initial',
    baseOccurrence: {
      date,
      slotIndex: 0,
      versionId: 'v1',
      title: '每日复盘',
      description: '',
      note: '',
      priority: 'medium',
      dueDate: null,
      tags: [],
    },
    before: { mode: 'rule' },
    after,
    reason: revision > 1 ? '日期写错了' : null,
    createdAt: `${date}T00:00:00.000Z`,
  };
}

const daily: RecurrenceSpec = { kind: 'daily' };

describe('重复规则展开', () => {
  it('每天：从首次计划日到上界逐日生成，槽位从 1 开始', () => {
    const slots = computeSlots({
      task: task(),
      versions: [version(1, '2026-11-02', daily)],
      exceptions: [],
      dateUpper: '2026-11-06',
    });
    expect(slots.map((slot) => slot.date)).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
    ]);
    expect(slots.map((slot) => slot.slotIndex)).toEqual([1, 2, 3, 4, 5]);
  });

  it('每周：只落在选中的星期', () => {
    const slots = computeSlots({
      task: task(),
      versions: [version(1, '2026-11-02', { kind: 'weekly', weekdays: [1, 3] })],
      exceptions: [],
      dateUpper: '2026-11-08',
    });
    expect(slots.map((slot) => slot.date)).toEqual(['2026-11-02', '2026-11-04']);
  });

  it('每月 31 日：在 30 天月份收敛到 30，在 2 月收敛到月末', () => {
    expect(resolveMonthDays({ kind: 'monthly', monthDays: [31] }, 2027, 2)).toEqual([28]);
    expect(resolveMonthDays({ kind: 'monthly', monthDays: [31] }, 2027, 4)).toEqual([30]);
    expect(resolveMonthDays({ kind: 'monthly', monthDays: [29] }, 2028, 2)).toEqual([29]);
  });

  it('每月最后一天：-1 跟随当月天数', () => {
    expect(resolveMonthDays({ kind: 'monthly', monthDays: [-1] }, 2028, 2)).toEqual([29]);
    expect(resolveMonthDays({ kind: 'monthly', monthDays: [-1] }, 2027, 2)).toEqual([28]);
    expect(resolveMonthDays({ kind: 'monthly', monthDays: [-1] }, 2027, 12)).toEqual([31]);
  });

  it('版本切换：前一段止于新版本生效日前一天，不重复也不留空档', () => {
    const slots = computeSlots({
      task: task(),
      versions: [
        version(1, '2026-11-02', { kind: 'weekly', weekdays: [1] }),
        version(2, '2026-11-16', { kind: 'weekly', weekdays: [5] }),
      ],
      exceptions: [],
      dateUpper: '2026-11-30',
    });
    expect(slots.map((slot) => slot.date)).toEqual([
      '2026-11-02',
      '2026-11-09',
      '2026-11-20',
      '2026-11-27',
    ]);
  });

  it('起始日早于版本生效日时，以较晚者为准', () => {
    const slots = computeSlots({
      task: task({ startDate: '2026-11-10' }),
      versions: [version(1, '2026-11-02', daily)],
      exceptions: [],
      dateUpper: '2026-11-12',
    });
    expect(slots.map((slot) => slot.date)).toEqual(['2026-11-10', '2026-11-11', '2026-11-12']);
  });
});

describe('生命周期与槽位', () => {
  it('暂停区间 [pause, resume) 内的候选日不占槽位，恢复当天恢复安排', () => {
    const slots = computeSlots({
      task: task({
        events: [
          event('created', '2026-11-02'),
          event('paused', '2026-11-06'),
          event('resumed', '2026-11-09'),
        ],
      }),
      versions: [version(1, '2026-11-02', daily)],
      exceptions: [],
      dateUpper: '2026-11-10',
    });
    expect(slots.map((slot) => slot.date)).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-09',
      '2026-11-10',
    ]);
    expect(slots.map((slot) => slot.slotIndex)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('暂停后未恢复：暂停日之后不再生成', () => {
    const slots = computeSlots({
      task: task({ events: [event('created', '2026-11-02'), event('paused', '2026-11-06')] }),
      versions: [version(1, '2026-11-02', daily)],
      exceptions: [],
      dateUpper: '2026-11-20',
    });
    expect(slots.map((slot) => slot.date)).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
    ]);
  });

  it('暂停导致的状态推导：暂停中、恢复后、结束后', () => {
    const paused = task({
      events: [event('created', '2026-11-02'), event('paused', '2026-11-06')],
    });
    expect(deriveState(paused, '2026-11-07')).toBe('paused');
    expect(deriveState(paused, '2026-11-05')).toBe('active');

    const ended = task({
      events: [event('created', '2026-11-02'), event('ended', '2026-11-10')],
    });
    expect(deriveState(ended, '2026-11-11')).toBe('ended');
    expect(deriveState(ended, '2026-11-09')).toBe('active');
  });

  it('结束日与 until 都含当日，取较早者', () => {
    const until = computeSlots({
      task: task({ endCondition: { type: 'until', until: '2026-11-05' } }),
      versions: [version(1, '2026-11-02', daily)],
      exceptions: [],
      dateUpper: '2026-11-20',
    });
    expect(until.map((slot) => slot.date)).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
    ]);

    const endDate = computeSlots({
      task: task({ endDate: '2026-11-04', endCondition: { type: 'until', until: '2026-11-09' } }),
      versions: [version(1, '2026-11-02', daily)],
      exceptions: [],
      dateUpper: '2026-11-20',
    });
    expect(endDate.map((slot) => slot.date)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04']);
  });
});

describe('count 是系列级累计', () => {
  it('暂停日不占槽位，因此 count=4 会跨过暂停继续数', () => {
    const slots = computeSlots({
      task: task({
        endCondition: { type: 'count', count: 4 },
        events: [
          event('created', '2026-11-02'),
          event('paused', '2026-11-04'),
          event('resumed', '2026-11-06'),
        ],
      }),
      versions: [version(1, '2026-11-02', daily)],
      exceptions: [],
      dateUpper: '2026-11-30',
    });
    expect(slots.map((slot) => slot.date)).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-06',
      '2026-11-07',
    ]);
  });

  it('count 跨版本继续累计，不因改规则重置', () => {
    const slots = computeSlots({
      task: task({ endCondition: { type: 'count', count: 3 } }),
      versions: [version(1, '2026-11-02', daily), version(2, '2026-11-04', daily)],
      exceptions: [],
      dateUpper: '2026-11-20',
    });
    expect(slots.map((slot) => slot.date)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04']);
    expect(slots.map((slot) => slot.slotIndex)).toEqual([1, 2, 3]);
  });

  it('skip 例外仍占槽位（计次），只是不产生可见安排', () => {
    const slots = computeSlots({
      task: task({ endCondition: { type: 'count', count: 2 } }),
      versions: [version(1, '2026-11-02', daily)],
      exceptions: [exception('2026-11-02', { mode: 'skip' })],
      dateUpper: '2026-11-20',
    });
    expect(slots.map((slot) => slot.date)).toEqual(['2026-11-02', '2026-11-03']);
    expect(resolveOccurrence(slots[0]!)).toBeNull();
    expect(resolveOccurrence(slots[1]!)?.date).toBe('2026-11-03');
  });
});

describe('查询窗口与计数无关', () => {
  it('分段查询的并集等于整段查询，且没有重复', () => {
    const base = {
      task: task({ endCondition: { type: 'count', count: 12 } }),
      versions: [version(1, '2026-11-02', daily)],
      exceptions: [exception('2026-11-05', { mode: 'skip' })],
      dateUpper: '2026-11-30',
    };
    const full = computeSlots({ ...base, dateUpper: '2026-11-20' }).map((slot) => slot.date);
    const left = slotsInRange(base, '2026-11-02', '2026-11-10').map((slot) => slot.date);
    const right = slotsInRange(base, '2026-11-11', '2026-11-20').map((slot) => slot.date);
    expect([...left, ...right]).toEqual(full);
    expect(new Set(full).size).toBe(full.length);
  });

  it('同一窗口从不同起点查询时结果一致', () => {
    const base = {
      task: task(),
      versions: [version(1, '2026-11-02', daily)],
      exceptions: [],
      dateUpper: '2026-11-30',
    };
    const fromDay = slotsInRange(base, '2026-11-03', '2026-11-05').map((slot) => slot.date);
    const fromMonth = slotsInRange(base, '2026-11-01', '2026-11-05')
      .map((slot) => slot.date)
      .filter((date) => date >= '2026-11-03');
    expect(fromDay).toEqual(fromMonth);
  });
});

describe('例外与展示', () => {
  it('override 只改指定日期的字段', () => {
    const slots = computeSlots({
      task: task(),
      versions: [version(1, '2026-11-02', daily)],
      exceptions: [exception('2026-11-03', { mode: 'override', patch: { title: '改成评审会' } })],
      dateUpper: '2026-11-04',
    });
    const resolved = slots.map((slot) => resolveOccurrence(slot));
    expect(resolved[0]?.title).toBe('每日复盘');
    expect(resolved[1]?.title).toBe('改成评审会');
    expect(resolved[1]?.overridden).toBe(true);
    expect(resolved[2]?.title).toBe('每日复盘');
  });

  it('修订链取最大 revision 的 after', () => {
    const slots = computeSlots({
      task: task(),
      versions: [version(1, '2026-11-02', daily)],
      exceptions: [
        exception('2026-11-03', { mode: 'override', patch: { title: '第一次' } }, 1),
        exception('2026-11-03', { mode: 'override', patch: { title: '第二次' } }, 2),
      ],
      dateUpper: '2026-11-03',
    });
    expect(resolveOccurrence(slots[1]!)?.title).toBe('第二次');
  });

  it('未来 5 次跳过 skip 例外', () => {
    const slots = upcomingSlots(
      {
        task: task(),
        versions: [version(1, '2026-11-02', daily)],
        exceptions: [exception('2026-11-03', { mode: 'skip' })],
        dateUpper: '2026-11-30',
      },
      '2026-11-02',
      3,
    );
    expect(slots.map((slot) => slot.date)).toEqual(['2026-11-02', '2026-11-04', '2026-11-05']);
  });

  it('起始日晚于上界时没有任何安排', () => {
    expect(
      computeSlots({
        task: task({ startDate: '2026-12-01' }),
        versions: [version(1, '2026-12-01', daily)],
        exceptions: [],
        dateUpper: '2026-11-30',
      }),
    ).toEqual([]);
  });

  it('addDaysIso 跨月跨年正确', () => {
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysIso('2027-03-01', -1)).toBe('2027-02-28');
  });
});

describe('ended 边界（生效日 = 第一天不执行）', () => {
  it('ended 生效日当天起不再产生安排', () => {
    const slots = computeSlots({
      task: task({
        events: [event('created', '2026-11-02'), event('ended', '2026-11-10')],
      }),
      versions: [version(1, '2026-11-02', daily)],
      exceptions: [],
      dateUpper: '2026-11-20',
    });
    expect(slots.map((slot) => slot.date)).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
      '2026-11-09',
    ]);
  });

  it('ended 后未来五次为空', () => {
    const slots = upcomingSlots(
      {
        task: task({
          events: [event('created', '2026-11-02'), event('ended', '2026-11-10')],
        }),
        versions: [version(1, '2026-11-02', daily)],
        exceptions: [],
        dateUpper: '2026-11-30',
      },
      '2026-11-12',
      5,
    );
    expect(slots).toEqual([]);
  });

  it('ended 后 reopened：中间不执行，重新启用日恢复', () => {
    const slots = computeSlots({
      task: task({
        events: [
          event('created', '2026-11-02'),
          event('ended', '2026-11-10'),
          event('reopened', '2026-11-15'),
        ],
      }),
      versions: [version(1, '2026-11-02', daily), version(2, '2026-11-15', daily)],
      exceptions: [],
      dateUpper: '2026-11-18',
    });
    expect(slots.map((slot) => slot.date)).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
      '2026-11-09',
      '2026-11-15',
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
    ]);
  });
});

describe('count 非法值（引擎防御）', () => {
  it('count=0 返回空结果', () => {
    expect(
      computeSlots({
        task: task({ endCondition: { type: 'count', count: 0 } }),
        versions: [version(1, '2026-11-02', daily)],
        exceptions: [],
        dateUpper: '2026-11-20',
      }),
    ).toEqual([]);
  });

  it('count 为负数或小数时返回空结果', () => {
    for (const count of [-3, 2.5]) {
      expect(
        computeSlots({
          task: task({ endCondition: { type: 'count', count } }),
          versions: [version(1, '2026-11-02', daily)],
          exceptions: [],
          dateUpper: '2026-11-20',
        }),
      ).toEqual([]);
    }
  });
});

describe('单次截止日 dueDate', () => {
  it('默认 null，不复制系列 endDate', () => {
    const slots = computeSlots({
      task: task({ endDate: '2026-11-30' }),
      versions: [version(1, '2026-11-02', daily)],
      exceptions: [],
      dateUpper: '2026-11-03',
    });
    expect(slots.map((slot) => slot.base.dueDate)).toEqual([null, null]);
    expect(slots.map((slot) => resolveOccurrence(slot)?.dueDate)).toEqual([null, null]);
  });

  it('单次 override 可以单独设置 dueDate', () => {
    const slots = computeSlots({
      task: task({ endDate: '2026-11-30' }),
      versions: [version(1, '2026-11-02', daily)],
      exceptions: [exception('2026-11-03', { mode: 'override', patch: { dueDate: '2026-11-04' } })],
      dateUpper: '2026-11-03',
    });
    expect(resolveOccurrence(slots[1]!)?.dueDate).toBe('2026-11-04');
  });
});

describe('生效版本选择（activeVersionOf）', () => {
  const versions = [
    version(1, '2026-11-02', daily),
    version(2, '2026-11-09', { kind: 'weekly', weekdays: [1, 3] }),
  ];

  it('取 effectiveFrom <= date 的最大版本，与版本号无关', () => {
    expect(activeVersionOf(versions, '2026-11-02')?.id).toBe('v1');
    expect(activeVersionOf(versions, '2026-11-08')?.id).toBe('v1');
    expect(activeVersionOf(versions, '2026-11-09')?.id).toBe('v2');
    expect(activeVersionOf(versions, '2027-01-01')?.id).toBe('v2');
  });

  it('早于所有版本时返回 null', () => {
    expect(activeVersionOf(versions, '2026-11-01')).toBeNull();
    expect(activeVersionOf([], '2026-11-01')).toBeNull();
  });
});

describe('例外状态摊平', () => {
  it('同一天取 revision 最大的状态，其余日期不受影响', () => {
    const slots = computeSlots({
      task: task(),
      versions: [version(1, '2026-11-02', daily)],
      exceptions: [
        exception('2026-11-03', { mode: 'skip' }, 1),
        exception('2026-11-03', { mode: 'override', patch: { title: '改后' } }, 2),
        exception('2026-11-04', { mode: 'skip' }, 1),
      ],
      dateUpper: '2026-11-05',
    });
    expect(slots.map((slot) => slot.state.mode)).toEqual(['rule', 'override', 'skip', 'rule']);
    expect(resolveOccurrence(slots[1]!)?.title).toBe('改后');
    expect(resolveOccurrence(slots[2]!)).toBeNull();
  });
});

describe('展开性能', () => {
  it('5 年每日任务 + 300 条例外，展开第 5 年的一个月在 300ms 内', () => {
    const exceptions = Array.from({ length: 300 }, (_, index) =>
      exception(addDaysIso('2026-11-02', index * 6), { mode: 'skip' }, 1),
    );
    const startedAt = Date.now();
    const slots = slotsInRange(
      {
        task: task({ endDate: '2032-01-01' }),
        versions: [version(1, '2026-11-02', daily)],
        exceptions,
        dateUpper: '2031-10-31',
      },
      '2031-10-01',
      '2031-10-31',
    );
    const elapsed = Date.now() - startedAt;
    expect(slots.length).toBe(31);
    expect(elapsed).toBeLessThan(300);
  });
});
