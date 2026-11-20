import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Task, WorkLog } from '@/domain/types';
import { createDatabase, type WorkbenchDatabase } from '@/db/db';
import { DEFAULT_TASK_SORT, queryTasks } from '@/repositories/tasks';
import { queryLogs } from '@/repositories/logs';
import { addDays, toISODate } from '@/lib/period';

/**
 * 性能冒烟测试：按「5 年 / 1 万任务 / 2 千日志」的规模灌入数据，
 * 断言常用查询仍在可接受范围内，防止后续改动引入明显的退化。
 *
 * 注意：fake-indexeddb 是内存实现，绝对耗时不代表真机；
 * 这里只作为回归护栏（阈值放宽到 1000ms），真实浏览器耗时见 README 的验收记录。
 */
const TASK_COUNT = 10_000;
const LOG_COUNT = 2_000;
const PROJECT_COUNT = 20;
const THRESHOLD_MS = 1_000;

const BASE_DATE = '2024-01-01';

function taskAt(index: number): Task {
  const planDate = toISODate(addDays(new Date(`${BASE_DATE}T00:00:00`), index % 1825));
  const projectId = index % 5 === 0 ? null : `proj-${index % PROJECT_COUNT}`;
  const isDone = index % 3 === 0;
  return {
    id: `task-${index}`,
    title: `任务 ${index} 需求联调`,
    description: index % 7 === 0 ? '涉及导出与离线缓存的说明' : '',
    projectId,
    status: isDone ? 'done' : index % 3 === 1 ? 'doing' : 'todo',
    priority:
      index % 4 === 0 ? 'urgent' : index % 4 === 1 ? 'high' : index % 4 === 2 ? 'medium' : 'low',
    planDate,
    dueDate: index % 2 === 0 ? toISODate(addDays(new Date(`${planDate}T00:00:00`), 3)) : null,
    completedAt: isDone ? `${planDate}T10:00:00.000Z` : null,
    parentId: null,
    tags: index % 6 === 0 ? ['tag-a'] : [],
    note: '',
    archivedAt: index % 11 === 0 ? `${planDate}T00:00:00.000Z` : null,
    deletedAt: null,
    createdAt: `${planDate}T01:00:00.000Z`,
    updatedAt: `${planDate}T02:00:00.000Z`,
  };
}

function logAt(index: number): WorkLog {
  const date = toISODate(addDays(new Date(`${BASE_DATE}T00:00:00`), index % 1825));
  return {
    id: `log-${index}`,
    date,
    title: `日志 ${index} 联调记录`,
    content: '今天处理了接口联调与离线缓存验证，记录了若干注意事项。',
    insight: index % 4 === 0 ? '提前拆小步更容易验证' : '',
    problem: index % 5 === 0 ? '偶现缓存未更新' : '',
    solution: index % 5 === 0 ? '先校验版本号再刷新' : '',
    projectId: index % 6 === 0 ? null : `proj-${index % PROJECT_COUNT}`,
    taskId: index % 9 === 0 ? null : `task-${index}`,
    tags: [],
    taskTitleSnapshot: index % 9 === 0 ? null : `任务 ${index} 需求联调`,
    projectNameSnapshot: index % 6 === 0 ? null : `项目 ${index % PROJECT_COUNT}`,
    searchText: `日志 ${index} 联调记录 ${index % 6 === 0 ? '' : `项目 ${index % PROJECT_COUNT}`}`,
    createdAt: `${date}T03:00:00.000Z`,
    updatedAt: `${date}T03:00:00.000Z`,
  };
}

function measure<T>(
  label: string,
  run: () => Promise<T>,
): Promise<{ label: string; ms: number; result: T }> {
  const started = performance.now();
  return run().then((result) => {
    const ms = Math.round(performance.now() - started);
    console.info(`[perf] ${label}: ${ms}ms`);
    return { label, ms, result };
  });
}

describe('性能冒烟：1 万任务 / 2 千日志', () => {
  let database: WorkbenchDatabase;

  beforeAll(async () => {
    database = createDatabase(`perf-${Date.now()}`);

    const tasks: Task[] = [];
    for (let index = 0; index < TASK_COUNT; index += 1) tasks.push(taskAt(index));
    const logs: WorkLog[] = [];
    for (let index = 0; index < LOG_COUNT; index += 1) logs.push(logAt(index));

    const started = performance.now();
    await database.transaction(
      'rw',
      [database.tasks, database.workLogs, database.projects],
      async () => {
        await database.projects.bulkAdd(
          Array.from({ length: PROJECT_COUNT }, (_, index) => ({
            id: `proj-${index}`,
            name: `项目 ${index}`,
            description: '',
            status: 'active' as const,
            startDate: BASE_DATE,
            endDate: null,
            tags: [],
            progressMode: 'auto' as const,
            manualProgress: null,
            milestones: [],
            risks: [],
            archivedAt: null,
            createdAt: `${BASE_DATE}T00:00:00.000Z`,
            updatedAt: `${BASE_DATE}T00:00:00.000Z`,
          })),
        );
        await database.tasks.bulkAdd(tasks);
        await database.workLogs.bulkAdd(logs);
      },
    );
    console.info(
      `[perf] 灌入 ${TASK_COUNT} 任务 / ${LOG_COUNT} 日志: ${Math.round(performance.now() - started)}ms`,
    );
  }, 180_000);

  afterAll(async () => {
    await database.delete();
  });

  it('数据规模符合设计预期', async () => {
    expect(await database.tasks.count()).toBe(TASK_COUNT);
    expect(await database.workLogs.count()).toBe(LOG_COUNT);
  });

  it('默认列表第一页（全表排序后分页）', async () => {
    const { ms, result } = await measure('任务首页（默认排序）', () =>
      queryTasks({ archived: 'active' }, DEFAULT_TASK_SORT, { page: 1, pageSize: 20 }, database),
    );
    expect(result.items).toHaveLength(20);
    expect(result.total).toBeGreaterThan(0);
    expect(ms).toBeLessThan(THRESHOLD_MS);
  });

  it('按项目 + 状态筛选', async () => {
    const { ms, result } = await measure('任务筛选（项目 + 状态）', () =>
      queryTasks(
        { projectId: 'proj-3', status: 'done' },
        DEFAULT_TASK_SORT,
        { pageSize: 20 },
        database,
      ),
    );
    expect(result.total).toBeGreaterThan(0);
    expect(ms).toBeLessThan(THRESHOLD_MS);
  });

  it('关键词搜索 + 高亮所需的关键词命中', async () => {
    const { ms, result } = await measure('任务搜索（关键词）', () =>
      queryTasks({ keyword: '需求联调' }, DEFAULT_TASK_SORT, { pageSize: 20 }, database),
    );
    expect(result.total).toBeGreaterThan(0);
    expect(ms).toBeLessThan(THRESHOLD_MS);
  });

  it('深翻页（第 100 页）', async () => {
    const { ms, result } = await measure('任务第 100 页', () =>
      queryTasks({}, DEFAULT_TASK_SORT, { page: 100, pageSize: 20 }, database),
    );
    expect(result.items).toHaveLength(20);
    expect(ms).toBeLessThan(THRESHOLD_MS);
  });

  it('日志搜索（2 千条）', async () => {
    const { ms, result } = await measure('日志搜索（关键词 + 日期区间）', () =>
      queryLogs(
        { keyword: '联调记录', dateFrom: '2024-01-01', dateTo: '2025-12-31' },
        { pageSize: 20 },
        database,
      ),
    );
    expect(result.total).toBeGreaterThan(0);
    expect(ms).toBeLessThan(THRESHOLD_MS);
  });
});
