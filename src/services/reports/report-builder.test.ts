import { describe, expect, it } from 'vitest';

import type { Project, Task, WorkLog } from '@/domain/types';
import { periodFor } from '@/lib/period';
import { DEFAULT_REPORT_TEMPLATES, DEFAULT_SETTINGS } from '@/services/settings';
import type { PeriodStats } from '@/services/stats/period-stats';

import { buildReportDraft } from './report-builder';

const PERIOD = periodFor('week', '2026-11-11', 1);

function makeTask(overrides: Partial<Task> & { id: string; title: string }): Task {
  return {
    description: '',
    projectId: null,
    status: 'done',
    priority: 'medium',
    planDate: null,
    dueDate: null,
    completedAt: '2026-11-10T02:00:00.000Z',
    parentId: null,
    tags: [],
    note: '',
    archivedAt: null,
    deletedAt: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-10T02:00:00.000Z',
    ...overrides,
  };
}

function makeLog(id: string, date: string, title: string): WorkLog {
  return {
    id,
    date,
    title,
    content: '',
    insight: '',
    problem: '',
    solution: '',
    projectId: null,
    taskId: null,
    tags: [],
    taskTitleSnapshot: null,
    projectNameSnapshot: null,
    searchText: title,
    createdAt: `${date}T00:00:00.000Z`,
    updatedAt: `${date}T00:00:00.000Z`,
  };
}

const PROJECT: Project = {
  id: 'project-1',
  name: '离线改造',
  description: '',
  status: 'active',
  startDate: null,
  endDate: null,
  tags: [],
  progressMode: 'auto',
  manualProgress: null,
  milestones: [],
  risks: [],
  archivedAt: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

function makeStats(overrides: Partial<PeriodStats> = {}): PeriodStats {
  return {
    kind: 'week',
    period: PERIOD,
    tasks: {
      plannedTotal: 5,
      plannedDone: 3,
      completionRate: 60,
      completedByCompletion: 4,
      overdueAtEnd: 1,
      carryOverAtEnd: 2,
      created: 3,
    },
    logs: { total: 2, daysWithLogs: 2 },
    projects: {
      touched: [
        {
          id: PROJECT.id,
          name: PROJECT.name,
          progress: { total: 2, counted: 2, done: 1, percent: 50, archived: 0, cancelled: 0 },
        },
      ],
      active: 4,
    },
    completedTasks: [
      makeTask({ id: 'task-1', title: '注册 Service Worker', projectId: PROJECT.id }),
      makeTask({ id: 'task-2', title: '写缓存策略' }),
    ],
    carriedTasks: [
      makeTask({ id: 'task-3', title: '补离线测试', status: 'todo', planDate: '2026-11-13' }),
    ],
    logEntries: [
      makeLog('log-1', '2026-11-11', '今天注册了 SW'),
      makeLog('log-2', '2026-11-12', '梳理缓存'),
    ],
    ...overrides,
  };
}

describe('buildReportDraft', () => {
  const base = {
    stats: makeStats(),
    projects: [PROJECT],
    settings: DEFAULT_SETTINGS,
    now: '2026-11-16T00:00:00.000Z',
  };

  it('替换全部占位符并写入统计数字', () => {
    const draft = buildReportDraft('week', PERIOD, base);

    expect(draft.body).not.toContain('{{');
    expect(draft.body).toContain('# 2026-11-09 ~ 2026-11-15 周报');
    expect(draft.body).toContain('计划任务：5 项，已完成 3 项，完成率 60%');
    expect(draft.body).toContain('按完成时间统计：完成 4 项');
    expect(draft.body).toContain('逾期 1 项，待结转 2 项');
    expect(draft.body).toContain('工作日志：2 条，覆盖 2 天');
  });

  it('完成任务带项目名与完成日期，待结转进入下期计划', () => {
    const draft = buildReportDraft('week', PERIOD, base);

    expect(draft.body).toContain('- [x] 注册 Service Worker（离线改造）（2026-11-10）');
    expect(draft.body).toContain('- [x] 写缓存策略（2026-11-10）');
    expect(draft.body).toContain('- [ ] 补离线测试（计划 2026-11-13）');
    expect(draft.body).toContain('## 工作日志');
    expect(draft.body).toContain('- 11-11 今天注册了 SW');
  });

  it('项目进展段列出百分比与完成数', () => {
    const draft = buildReportDraft('month', PERIOD, base);
    expect(draft.body).toContain('- 离线改造：50%（已完成 1 / 2）');
  });

  it('空数据时给出可读提示而不是空段', () => {
    const draft = buildReportDraft('month', periodFor('month', '2026-11-11', 1), {
      ...base,
      stats: makeStats({
        tasks: {
          plannedTotal: 0,
          plannedDone: 0,
          completionRate: null,
          completedByCompletion: 0,
          overdueAtEnd: 0,
          carryOverAtEnd: 0,
          created: 0,
        },
        logs: { total: 0, daysWithLogs: 0 },
        projects: { touched: [], active: 0 },
        completedTasks: [],
        carriedTasks: [],
        logEntries: [],
      }),
    });

    expect(draft.body).toContain('（本期没有完成的任务）');
    expect(draft.body).toContain('（本期没有工作日志）');
    expect(draft.body).toContain('（本期没有关联项目）');
    expect(draft.body).toContain('完成率 —');
  });

  it('metrics 保存可核对的原始计数', () => {
    const draft = buildReportDraft('week', PERIOD, base);
    expect(draft.metrics).toMatchObject({
      kind: 'week',
      periodStart: '2026-11-09',
      periodEnd: '2026-11-15',
      generatedAt: '2026-11-16T00:00:00.000Z',
      tasks: { plannedTotal: 5, plannedDone: 3, completionRate: 60, completedByCompletion: 4 },
      logs: { total: 2, daysWithLogs: 2 },
    });
  });

  it('使用设置里的模板，自定义段落也会被替换', () => {
    const draft = buildReportDraft('week', PERIOD, {
      ...base,
      settings: {
        ...DEFAULT_SETTINGS,
        reportTemplates: {
          ...DEFAULT_REPORT_TEMPLATES,
          week: '自定义：{{period}}\n\n{{summary}}\n\n待办：\n{{next}}',
        },
      },
    });

    expect(draft.body.startsWith('自定义：2026-11-09 ~ 2026-11-15')).toBe(true);
    expect(draft.body).toContain('待办：');
    expect(draft.body).not.toContain('{{summary}}');
  });
});
