import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkbenchDatabase } from '@/db/db';
import type {
  BaseOccurrence,
  ExceptionChangeKind,
  LongTask,
  LongTaskException,
  LongTaskRuleVersion,
} from '@/domain/long-task';
import type { ISODate } from '@/lib/period';
import {
  DEFAULT_LONG_TASK_SORT,
  getLongTaskAggregate,
  getLongTaskAggregates,
  queryLongTaskAggregates,
} from '@/repositories/long-tasks';
import { createTestDatabase, destroyTestDatabase } from '@/test/db';

const NOW = '2026-11-19T10:00:00.000Z';
const START: ISODate = '2026-11-02';

let database: WorkbenchDatabase;

beforeEach(() => {
  database = createTestDatabase('long-tasks-repo');
});

afterEach(async () => {
  vi.restoreAllMocks();
  await destroyTestDatabase(database);
});

function makeLongTask(overrides: Partial<LongTask> = {}): LongTask {
  return {
    id: 'lt-1',
    title: '每日复盘',
    description: '每天写三行',
    note: '',
    priority: 'medium',
    startDate: START,
    endDate: null,
    endCondition: { type: 'never' },
    tags: [],
    events: [{ id: 'ev-created', type: 'created', date: START, note: null, createdAt: NOW }],
    deletedAt: null,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeVersion(
  taskId: string,
  versionNo: number,
  effectiveFrom: ISODate,
  id = `${taskId}-v${versionNo}`,
): LongTaskRuleVersion {
  return {
    id,
    taskId,
    versionNo,
    effectiveFrom,
    spec: { kind: 'daily' },
    changeNote: null,
    createdAt: NOW,
  };
}

function makeBaseOccurrence(date: ISODate): BaseOccurrence {
  return {
    date,
    slotIndex: 1,
    versionId: 'v1',
    title: '每日复盘',
    description: '',
    note: '',
    priority: 'medium',
    dueDate: null,
    tags: [],
  };
}

function makeException(
  taskId: string,
  occurrenceDate: ISODate,
  revision: number,
  options: {
    previousRevisionId?: string | null;
    changeKind?: ExceptionChangeKind;
    id?: string;
  } = {},
): LongTaskException {
  const changeKind = options.changeKind ?? 'initial';
  return {
    id: options.id ?? `${taskId}-x-${occurrenceDate}-${revision}`,
    taskId,
    occurrenceDate,
    revision,
    previousRevisionId: options.previousRevisionId ?? null,
    changeKind,
    baseOccurrence: makeBaseOccurrence(occurrenceDate),
    before: revision === 1 ? { mode: 'rule' } : { mode: 'skip' },
    after: changeKind === 'revocation' ? { mode: 'rule' } : { mode: 'skip' },
    reason: changeKind === 'initial' ? null : '调整安排',
    createdAt: NOW,
  };
}

async function seed(
  task: LongTask,
  versions: LongTaskRuleVersion[] = [],
  exceptions: LongTaskException[] = [],
): Promise<void> {
  await database.longTasks.put(task);
  if (versions.length > 0) {
    await database.longTaskRuleVersions.bulkPut(versions);
  }
  if (exceptions.length > 0) {
    await database.longTaskExceptions.bulkPut(exceptions);
  }
}

describe('A. 基本查询', () => {
  it('单个聚合包含主记录、全部版本与全部例外', async () => {
    await seed(
      makeLongTask(),
      [makeVersion('lt-1', 1, START), makeVersion('lt-1', 2, '2026-12-01')],
      [makeException('lt-1', '2026-11-03', 1)],
    );

    const aggregate = await getLongTaskAggregate('lt-1', database);

    expect(aggregate?.task.id).toBe('lt-1');
    expect(aggregate?.versions).toHaveLength(2);
    expect(aggregate?.exceptions).toHaveLength(1);
    expect(aggregate?.issues).toEqual([]);
  });

  it('不存在的 id 返回 undefined', async () => {
    await expect(getLongTaskAggregate('missing', database)).resolves.toBeUndefined();
  });

  it('批量读取多个聚合', async () => {
    await seed(makeLongTask({ id: 'lt-a' }), [makeVersion('lt-a', 1, START)]);
    await seed(makeLongTask({ id: 'lt-b' }), [makeVersion('lt-b', 1, START)]);

    const aggregates = await getLongTaskAggregates(['lt-a', 'lt-b'], database);

    expect(aggregates.map((item) => item.task.id)).toEqual(['lt-a', 'lt-b']);
    expect(aggregates.every((item) => item.versions.length === 1)).toBe(true);
  });

  it('批量读取遵循输入顺序（与库内顺序无关）', async () => {
    await seed(makeLongTask({ id: 'lt-a', updatedAt: '2026-11-19T09:00:00.000Z' }));
    await seed(makeLongTask({ id: 'lt-b', updatedAt: '2026-11-19T11:00:00.000Z' }));

    const aggregates = await getLongTaskAggregates(['lt-b', 'lt-a'], database);

    expect(aggregates.map((item) => item.task.id)).toEqual(['lt-b', 'lt-a']);
  });

  it('重复 id 只返回一次', async () => {
    await seed(makeLongTask({ id: 'lt-a' }));

    const aggregates = await getLongTaskAggregates(['lt-a', 'lt-a', 'lt-a'], database);

    expect(aggregates).toHaveLength(1);
    expect(aggregates[0]?.task.id).toBe('lt-a');
  });

  it('不存在的 id 自动跳过，其余结果保持顺序', async () => {
    await seed(makeLongTask({ id: 'lt-a' }));
    await seed(makeLongTask({ id: 'lt-c' }));

    const aggregates = await getLongTaskAggregates(['lt-a', 'missing', 'lt-c'], database);

    expect(aggregates.map((item) => item.task.id)).toEqual(['lt-a', 'lt-c']);
  });

  it('空 id 列表直接返回空数组且不发起查询', async () => {
    const transactionSpy = vi.spyOn(database, 'transaction');
    const whereSpy = vi.spyOn(database.longTaskRuleVersions, 'where');

    const aggregates = await getLongTaskAggregates([], database);

    expect(aggregates).toEqual([]);
    expect(transactionSpy).not.toHaveBeenCalled();
    expect(whereSpy).not.toHaveBeenCalled();
  });

  it('空数据库分页查询返回空页', async () => {
    const result = await queryLongTaskAggregates({}, DEFAULT_LONG_TASK_SORT, {}, database);

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(1);
  });
});

describe('B. 规则版本', () => {
  it('多个版本按 effectiveFrom 升序排列（与写入顺序无关）', async () => {
    // 故意按乱序写入：v2 生效更晚，v1 生效更早。
    await seed(makeLongTask({ id: 'lt-a' }), [
      makeVersion('lt-a', 2, '2026-12-01'),
      makeVersion('lt-a', 1, START),
      makeVersion('lt-a', 3, '2027-01-15'),
    ]);

    const aggregate = await getLongTaskAggregate('lt-a', database);

    expect(aggregate?.versions.map((item) => item.effectiveFrom)).toEqual([
      START,
      '2026-12-01',
      '2027-01-15',
    ]);
  });

  it('保留全部规则版本，不只返回最新一条', async () => {
    await seed(makeLongTask({ id: 'lt-a' }), [
      makeVersion('lt-a', 1, START),
      makeVersion('lt-a', 2, '2026-12-01'),
      makeVersion('lt-a', 3, '2027-01-15'),
      makeVersion('lt-a', 4, '2027-02-01'),
    ]);

    const aggregate = await getLongTaskAggregate('lt-a', database);

    expect(aggregate?.versions.map((item) => item.versionNo)).toEqual([1, 2, 3, 4]);
    expect(aggregate?.issues).toEqual([]);
  });

  it('versionNo 与 effectiveFrom 顺序一致时不报 VERSION_ORDER', async () => {
    await seed(makeLongTask({ id: 'lt-a' }), [
      makeVersion('lt-a', 1, START),
      makeVersion('lt-a', 2, '2026-12-01'),
    ]);

    const aggregate = await getLongTaskAggregate('lt-a', database);

    expect(aggregate?.issues.some((issue) => issue.code === 'VERSION_ORDER')).toBe(false);
  });

  it('没有规则版本时返回 NO_VERSIONS 而不是静默通过', async () => {
    await seed(makeLongTask({ id: 'lt-a' }));

    const aggregate = await getLongTaskAggregate('lt-a', database);

    expect(aggregate?.versions).toEqual([]);
    expect(aggregate?.issues.map((issue) => issue.code)).toContain('NO_VERSIONS');
  });

  it('版本号与生效日顺序矛盾时标记 VERSION_ORDER', async () => {
    // 唯一索引只保证 (taskId+versionNo)/(taskId+effectiveFrom) 不重复，不保证顺序。
    await seed(makeLongTask({ id: 'lt-a' }), [
      makeVersion('lt-a', 2, '2026-11-02'),
      makeVersion('lt-a', 1, '2026-12-01'),
    ]);

    const aggregate = await getLongTaskAggregate('lt-a', database);

    expect(aggregate?.versions.map((item) => item.versionNo)).toEqual([2, 1]);
    expect(aggregate?.issues.map((issue) => issue.code)).toContain('VERSION_ORDER');
  });
});

describe('C. 单次例外', () => {
  it('多个日期按 occurrenceDate 升序排列', async () => {
    await seed(
      makeLongTask({ id: 'lt-a' }),
      [makeVersion('lt-a', 1, START)],
      [
        makeException('lt-a', '2026-11-05', 1),
        makeException('lt-a', '2026-11-03', 1),
        makeException('lt-a', '2026-11-04', 1),
      ],
    );

    const aggregate = await getLongTaskAggregate('lt-a', database);

    expect(aggregate?.exceptions.map((item) => item.occurrenceDate)).toEqual([
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
    ]);
  });

  it('同一天的多个 revision 完整保留并升序排列', async () => {
    const date = '2026-11-05';
    const first = makeException('lt-a', date, 1);
    const second = makeException('lt-a', date, 2, { previousRevisionId: first.id });
    const third = makeException('lt-a', date, 3, { previousRevisionId: second.id });
    await seed(
      makeLongTask({ id: 'lt-a' }),
      [makeVersion('lt-a', 1, START)],
      [third, first, second],
    );

    const aggregate = await getLongTaskAggregate('lt-a', database);

    expect(aggregate?.exceptions.map((item) => item.revision)).toEqual([1, 2, 3]);
    expect(aggregate?.issues).toEqual([]);
  });

  it('保留 revocation 记录（不因已撤销而丢弃）', async () => {
    const date = '2026-11-06';
    const first = makeException('lt-a', date, 1);
    const revoked = makeException('lt-a', date, 2, {
      previousRevisionId: first.id,
      changeKind: 'revocation',
    });
    await seed(makeLongTask({ id: 'lt-a' }), [makeVersion('lt-a', 1, START)], [first, revoked]);

    const aggregate = await getLongTaskAggregate('lt-a', database);

    expect(aggregate?.exceptions.map((item) => item.changeKind)).toEqual(['initial', 'revocation']);
    expect(aggregate?.exceptions[1]?.after).toEqual({ mode: 'rule' });
  });

  it('override 与 skip 各自保留，不在读取阶段合并', async () => {
    const override = makeException('lt-a', '2026-11-07', 1);
    override.after = { mode: 'override', patch: { title: '改成周报' } };
    const skip = makeException('lt-a', '2026-11-08', 1);
    skip.after = { mode: 'skip' };
    await seed(makeLongTask({ id: 'lt-a' }), [makeVersion('lt-a', 1, START)], [override, skip]);

    const aggregate = await getLongTaskAggregate('lt-a', database);

    expect(aggregate?.exceptions[0]?.after).toEqual({
      mode: 'override',
      patch: { title: '改成周报' },
    });
    expect(aggregate?.exceptions[1]?.after).toEqual({ mode: 'skip' });
  });

  it('不折叠修订链（3 条记录全部返回，不合并为最终状态）', async () => {
    const date = '2026-11-09';
    const first = makeException('lt-a', date, 1);
    const second = makeException('lt-a', date, 2, { previousRevisionId: first.id });
    const third = makeException('lt-a', date, 3, { previousRevisionId: second.id });
    await seed(
      makeLongTask({ id: 'lt-a' }),
      [makeVersion('lt-a', 1, START)],
      [first, second, third],
    );

    const aggregate = await getLongTaskAggregate('lt-a', database);

    expect(aggregate?.exceptions).toHaveLength(3);
    expect(aggregate?.exceptions.map((item) => item.revision)).toEqual([1, 2, 3]);
  });

  it('revision 断档时标记 EXCEPTION_REVISION_GAP', async () => {
    const date = '2026-11-10';
    const first = makeException('lt-a', date, 1);
    const third = makeException('lt-a', date, 3, { previousRevisionId: first.id });
    await seed(makeLongTask({ id: 'lt-a' }), [makeVersion('lt-a', 1, START)], [first, third]);

    const aggregate = await getLongTaskAggregate('lt-a', database);

    expect(aggregate?.issues.map((issue) => issue.code)).toContain('EXCEPTION_REVISION_GAP');
  });

  it('previousRevisionId 指向错误时标记 EXCEPTION_PREVIOUS_MISMATCH', async () => {
    const date = '2026-11-11';
    const first = makeException('lt-a', date, 1);
    const second = makeException('lt-a', date, 2, { previousRevisionId: 'wrong-id' });
    await seed(makeLongTask({ id: 'lt-a' }), [makeVersion('lt-a', 1, START)], [first, second]);

    const aggregate = await getLongTaskAggregate('lt-a', database);

    expect(aggregate?.issues.map((issue) => issue.code)).toContain('EXCEPTION_PREVIOUS_MISMATCH');
  });

  it('缺少基础记录时标记 EXCEPTION_ORPHAN_BASE', async () => {
    const date = '2026-11-12';
    const second = makeException('lt-a', date, 2);
    const third = makeException('lt-a', date, 3, { previousRevisionId: second.id });
    await seed(makeLongTask({ id: 'lt-a' }), [makeVersion('lt-a', 1, START)], [second, third]);

    const aggregate = await getLongTaskAggregate('lt-a', database);

    expect(aggregate?.issues.map((issue) => issue.code)).toContain('EXCEPTION_ORPHAN_BASE');
  });
});

describe('D. 软删除与归档', () => {
  async function seedFour(): Promise<void> {
    await seed(makeLongTask({ id: 'lt-normal', updatedAt: '2026-11-19T10:00:00.000Z' }));
    await seed(
      makeLongTask({
        id: 'lt-deleted',
        deletedAt: '2026-11-18T10:00:00.000Z',
        updatedAt: '2026-11-19T10:01:00.000Z',
      }),
      [makeVersion('lt-deleted', 1, START)],
      [makeException('lt-deleted', '2026-11-03', 1)],
    );
    await seed(
      makeLongTask({
        id: 'lt-archived',
        archivedAt: '2026-11-18T11:00:00.000Z',
        updatedAt: '2026-11-19T10:02:00.000Z',
      }),
    );
    await seed(
      makeLongTask({
        id: 'lt-both',
        deletedAt: '2026-11-18T12:00:00.000Z',
        archivedAt: '2026-11-18T12:30:00.000Z',
        updatedAt: '2026-11-19T10:03:00.000Z',
      }),
    );
  }

  it('默认查询排除软删除任务', async () => {
    await seedFour();

    const result = await queryLongTaskAggregates(
      {},
      DEFAULT_LONG_TASK_SORT,
      { pageSize: 50 },
      database,
    );

    expect(result.items.map((item) => item.task.id)).toEqual(['lt-normal']);
  });

  it('deleted=deleted 返回回收站任务（含已归档的）', async () => {
    await seedFour();

    const result = await queryLongTaskAggregates(
      { deleted: 'deleted', archived: 'all' },
      DEFAULT_LONG_TASK_SORT,
      { pageSize: 50 },
      database,
    );

    expect(result.items.map((item) => item.task.id).sort()).toEqual(['lt-both', 'lt-deleted']);
  });

  it('deleted=all 返回全部任务', async () => {
    await seedFour();

    const result = await queryLongTaskAggregates(
      { deleted: 'all', archived: 'all' },
      DEFAULT_LONG_TASK_SORT,
      { pageSize: 50 },
      database,
    );

    expect(result.total).toBe(4);
  });

  it('默认查询排除已归档任务', async () => {
    await seedFour();

    const result = await queryLongTaskAggregates(
      {},
      DEFAULT_LONG_TASK_SORT,
      { pageSize: 50 },
      database,
    );

    expect(result.items.some((item) => item.task.archivedAt !== null)).toBe(false);
  });

  it('archived=archived 返回已归档任务', async () => {
    await seedFour();

    const result = await queryLongTaskAggregates(
      { archived: 'archived', deleted: 'all' },
      DEFAULT_LONG_TASK_SORT,
      { pageSize: 50 },
      database,
    );

    expect(result.items.map((item) => item.task.id).sort()).toEqual(['lt-archived', 'lt-both']);
  });

  it('archived=all 返回全部归档状态', async () => {
    await seedFour();

    const result = await queryLongTaskAggregates(
      { archived: 'all' },
      DEFAULT_LONG_TASK_SORT,
      { pageSize: 50 },
      database,
    );

    expect(result.items.map((item) => item.task.id).sort()).toEqual(['lt-archived', 'lt-normal']);
  });

  it('按 id 可以读取软删除任务', async () => {
    await seedFour();

    const aggregate = await getLongTaskAggregate('lt-deleted', database);

    expect(aggregate?.task.deletedAt).toBe('2026-11-18T10:00:00.000Z');
  });

  it('软删除任务仍然带有完整规则版本与例外', async () => {
    await seedFour();

    const aggregate = await getLongTaskAggregate('lt-deleted', database);

    expect(aggregate?.versions).toHaveLength(1);
    expect(aggregate?.exceptions).toHaveLength(1);
  });

  it('归档与软删除组合过滤互不覆盖', async () => {
    await seedFour();

    const deletedOnly = await queryLongTaskAggregates(
      { deleted: 'deleted', archived: 'active' },
      DEFAULT_LONG_TASK_SORT,
      { pageSize: 50 },
      database,
    );
    const archivedOnly = await queryLongTaskAggregates(
      { deleted: 'active', archived: 'archived' },
      DEFAULT_LONG_TASK_SORT,
      { pageSize: 50 },
      database,
    );

    expect(deletedOnly.items.map((item) => item.task.id)).toEqual(['lt-deleted']);
    expect(archivedOnly.items.map((item) => item.task.id)).toEqual(['lt-archived']);
  });
});

describe('E. 分页与排序', () => {
  it('默认按 updatedAt 倒序', async () => {
    await seed(makeLongTask({ id: 'lt-old', updatedAt: '2026-11-19T08:00:00.000Z' }));
    await seed(makeLongTask({ id: 'lt-new', updatedAt: '2026-11-19T12:00:00.000Z' }));

    const result = await queryLongTaskAggregates({}, DEFAULT_LONG_TASK_SORT, {}, database);

    expect(result.items.map((item) => item.task.id)).toEqual(['lt-new', 'lt-old']);
  });

  it('updatedAt 相同时按 id 升序稳定排序', async () => {
    await seed(makeLongTask({ id: 'lt-b', updatedAt: NOW }));
    await seed(makeLongTask({ id: 'lt-a', updatedAt: NOW }));

    const result = await queryLongTaskAggregates({}, DEFAULT_LONG_TASK_SORT, {}, database);

    expect(result.items.map((item) => item.task.id)).toEqual(['lt-a', 'lt-b']);
  });

  it('支持按优先级排序（desc 时紧急在前）', async () => {
    await seed(makeLongTask({ id: 'lt-low', priority: 'low' }));
    await seed(makeLongTask({ id: 'lt-urgent', priority: 'urgent' }));
    await seed(makeLongTask({ id: 'lt-medium', priority: 'medium' }));

    const result = await queryLongTaskAggregates(
      {},
      { key: 'priority', direction: 'desc' },
      {},
      database,
    );

    expect(result.items.map((item) => item.task.id)).toEqual(['lt-urgent', 'lt-medium', 'lt-low']);
  });

  it('分页的 total / totalPages 正确', async () => {
    for (const id of ['lt-1', 'lt-2', 'lt-3']) {
      await seed(makeLongTask({ id }));
    }

    const result = await queryLongTaskAggregates(
      {},
      DEFAULT_LONG_TASK_SORT,
      { page: 2, pageSize: 2 },
      database,
    );

    expect(result.total).toBe(3);
    expect(result.totalPages).toBe(2);
    expect(result.page).toBe(2);
    expect(result.items).toHaveLength(1);
  });

  it('每页只查询本页主记录的关联数据（批量一次，不随任务数增加）', async () => {
    for (const id of ['lt-1', 'lt-2', 'lt-3']) {
      await seed(makeLongTask({ id }), [makeVersion(id, 1, START)]);
    }
    const whereSpy = vi.spyOn(database.longTaskRuleVersions, 'where');

    const result = await queryLongTaskAggregates(
      {},
      DEFAULT_LONG_TASK_SORT,
      { page: 1, pageSize: 2 },
      database,
    );

    expect(result.items).toHaveLength(2);
    expect(whereSpy).toHaveBeenCalledTimes(1);
    expect(whereSpy.mock.calls[0]?.[0]).toBe('taskId');
  });

  it('单个聚合的 versions / exceptions 不被分页截断', async () => {
    const versions = Array.from({ length: 25 }, (_, index) =>
      makeVersion(
        'lt-heavy',
        index + 1,
        `2026-11-${String(index + 1).padStart(2, '0')}` as ISODate,
      ),
    );
    await seed(makeLongTask({ id: 'lt-heavy' }), versions);

    const result = await queryLongTaskAggregates(
      {},
      DEFAULT_LONG_TASK_SORT,
      { page: 1, pageSize: 1 },
      database,
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.versions).toHaveLength(25);
  });

  it('相邻两页没有重复也没有遗漏', async () => {
    for (let index = 1; index <= 4; index += 1) {
      await seed(
        makeLongTask({
          id: `lt-${index}`,
          updatedAt: `2026-11-19T0${index}:00:00.000Z`,
        }),
      );
    }

    const first = await queryLongTaskAggregates(
      {},
      DEFAULT_LONG_TASK_SORT,
      { page: 1, pageSize: 2 },
      database,
    );
    const second = await queryLongTaskAggregates(
      {},
      DEFAULT_LONG_TASK_SORT,
      { page: 2, pageSize: 2 },
      database,
    );
    const ids = [...first.items, ...second.items].map((item) => item.task.id);

    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });
});

describe('F. 事务与一致性', () => {
  it('三张表在同一个只读事务内读取', async () => {
    await seed(makeLongTask({ id: 'lt-a' }), [makeVersion('lt-a', 1, START)]);
    const transactionSpy = vi.spyOn(database, 'transaction');

    await getLongTaskAggregate('lt-a', database);

    expect(transactionSpy).toHaveBeenCalledTimes(1);
    const call = transactionSpy.mock.calls[0] as unknown as [string, unknown[]];
    expect(call[0]).toBe('r');
    expect(call[1]).toHaveLength(3);
  });

  it('批量查询同样是单事务 + 两次批量读', async () => {
    await seed(makeLongTask({ id: 'lt-a' }), [makeVersion('lt-a', 1, START)]);
    await seed(makeLongTask({ id: 'lt-b' }), [makeVersion('lt-b', 1, START)]);
    const transactionSpy = vi.spyOn(database, 'transaction');
    const versionWhereSpy = vi.spyOn(database.longTaskRuleVersions, 'where');
    const exceptionWhereSpy = vi.spyOn(database.longTaskExceptions, 'where');

    await getLongTaskAggregates(['lt-a', 'lt-b'], database);

    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect(versionWhereSpy).toHaveBeenCalledTimes(1);
    expect(exceptionWhereSpy).toHaveBeenCalledTimes(1);
  });

  it('单个查询与批量查询返回相同的聚合内容', async () => {
    await seed(
      makeLongTask({ id: 'lt-a' }),
      [makeVersion('lt-a', 1, START), makeVersion('lt-a', 2, '2026-12-01')],
      [makeException('lt-a', '2026-11-03', 1)],
    );

    const single = await getLongTaskAggregate('lt-a', database);
    const [batched] = await getLongTaskAggregates(['lt-a'], database);

    expect(batched).toEqual(single);
  });

  it('Dexie 批量 anyOf 能正确按 taskId 分桶（不串数据）', async () => {
    await seed(
      makeLongTask({ id: 'lt-a' }),
      [makeVersion('lt-a', 1, START), makeVersion('lt-a', 2, '2026-12-01')],
      [makeException('lt-a', '2026-11-03', 1)],
    );
    await seed(makeLongTask({ id: 'lt-b' }), [makeVersion('lt-b', 1, START)], []);

    const aggregates = await getLongTaskAggregates(['lt-a', 'lt-b'], database);
    const byId = new Map(aggregates.map((item) => [item.task.id, item]));

    expect(byId.get('lt-a')?.versions).toHaveLength(2);
    expect(byId.get('lt-a')?.exceptions).toHaveLength(1);
    expect(byId.get('lt-b')?.versions).toHaveLength(1);
    expect(byId.get('lt-b')?.exceptions).toHaveLength(0);
  });

  it('空 id 列表短路，不进入事务', async () => {
    const transactionSpy = vi.spyOn(database, 'transaction');

    await getLongTaskAggregates([], database);

    expect(transactionSpy).not.toHaveBeenCalled();
  });
});

describe('G. 数据库隔离', () => {
  it('每个用例使用独立数据库', () => {
    expect(database.name).toContain('long-tasks-repo');
  });

  it('两个数据库之间数据不会相互可见', async () => {
    const other = createTestDatabase('long-tasks-repo-other');
    try {
      await seed(makeLongTask({ id: 'lt-only-here' }));
      await expect(getLongTaskAggregate('lt-only-here', other)).resolves.toBeUndefined();
    } finally {
      await destroyTestDatabase(other);
    }
  });
});
