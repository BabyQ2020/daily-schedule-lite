import { describe, expect, it } from 'vitest';

import type { Project, Task, WorkLog } from '@/domain/types';
import { DEFAULT_SETTINGS } from '@/services/settings';
import type { TodayBoard } from '@/services/stats/today';

import {
  buildDailyDraft,
  computeCompletionRate,
  renderDailyDraftWithTemplate,
  renderTemplate,
} from './daily-draft';

const TODAY = '2026-11-15';
const NOW = '2026-11-15T01:00:00.000Z';

function makeTask(overrides: Partial<Task> & { title: string }): Task {
  const { title, ...rest } = overrides;
  return {
    id: `task-${title}`,
    title,
    description: '',
    projectId: null,
    status: 'todo',
    priority: 'medium',
    planDate: TODAY,
    dueDate: null,
    completedAt: null,
    parentId: null,
    tags: [],
    note: '',
    archivedAt: null,
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...rest,
  };
}

function makeLog(title: string, content: string): WorkLog {
  return {
    id: `log-${title}`,
    date: TODAY,
    title,
    content,
    insight: '',
    problem: '',
    solution: '',
    projectId: null,
    taskId: null,
    tags: [],
    taskTitleSnapshot: null,
    projectNameSnapshot: null,
    searchText: `${title} ${content}`,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeBoard(overrides: Partial<TodayBoard> = {}): TodayBoard {
  const planned = overrides.planned ?? [];
  const counts = {
    planned: planned.length,
    plannedDone: planned.filter((task) => task.status === 'done').length,
    dueToday: overrides.dueToday?.length ?? 0,
    overdue: overrides.overdue?.length ?? 0,
    carryOver: overrides.carryOver?.length ?? 0,
    doneByCompletion: overrides.doneToday?.length ?? 0,
  };
  return {
    date: TODAY,
    plan: undefined,
    planned,
    plannedOpen: planned.filter((task) => task.status !== 'done'),
    plannedDone: planned.filter((task) => task.status === 'done'),
    dueToday: [],
    overdue: [],
    carryOver: [],
    doneToday: [],
    logs: [],
    counts,
    ...overrides,
  };
}

const PROJECTS: Project[] = [
  {
    id: 'project-1',
    name: '工作台改版',
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
    createdAt: NOW,
    updatedAt: NOW,
  },
];

describe('computeCompletionRate', () => {
  it('按计划完成数计算百分比并向下取整', () => {
    expect(computeCompletionRate(3, 1)).toBe(33);
    expect(computeCompletionRate(4, 4)).toBe(100);
  });

  it('没有计划任务时返回 null 而不是 0', () => {
    expect(computeCompletionRate(0, 0)).toBeNull();
  });
});

describe('renderTemplate', () => {
  it('只替换已知占位符，未知占位符输出空字符串', () => {
    const result = renderTemplate('# {{title}} / {{unknown}}', { title: '日报' });
    expect(result).toBe('# 日报 / ');
  });
});

describe('buildDailyDraft', () => {
  it('生成包含日期标题与统计概览的草稿', () => {
    const board = makeBoard({
      planned: [
        makeTask({ title: '写周报', projectId: 'project-1', status: 'done' }),
        makeTask({ title: '整理需求', projectId: 'project-1' }),
      ],
      logs: [makeLog('随手记', '上午写周报\n下午整理需求')],
    });

    const draft = buildDailyDraft(board, DEFAULT_SETTINGS, PROJECTS);

    expect(draft.title).toBe('2026-11-15（周日） 日报草稿');
    expect(draft.body).toContain('# 2026-11-15（周日） 日报');
    expect(draft.body).toContain('今日计划 2 项，已完成 1 项（计划完成率 50%）');
    expect(draft.body).toContain('按完成时间统计：今日完成 0 项');
    expect(draft.body).toContain('- [x] 写周报（工作台改版）');
    expect(draft.body).toContain('- [ ] 整理需求（工作台改版）');
    expect(draft.body).toContain('- 随手记：上午写周报');
    expect(draft.metrics).toMatchObject({
      planned: 2,
      plannedDone: 1,
      completionRate: 50,
      logs: 1,
    });
  });

  it('没有计划、日志、项目时给出明确占位文案', () => {
    const draft = buildDailyDraft(makeBoard(), DEFAULT_SETTINGS, []);

    expect(draft.body).toContain('今日计划 0 项，已完成 0 项（计划完成率 —）');
    expect(draft.body).toContain('- 今日还没有安排任务');
    expect(draft.body).toContain('- 今日还没有记录工作日志');
    expect(draft.metrics.completionRate).toBeNull();
  });

  it('周报模板中的 projects 与 next 占位符按项目与逾期结转分组', () => {
    const board = makeBoard({
      planned: [makeTask({ title: '写周报', projectId: 'project-1', status: 'done' })],
      overdue: [makeTask({ title: '逾期任务', dueDate: '2026-11-10' })],
      carryOver: [makeTask({ title: '待结转任务', planDate: '2026-11-12' })],
    });

    const template = ['# {{period}}', '{{projects}}', '{{next}}'].join('\n');

    const body = renderDailyDraftWithTemplate(board, template, 1, PROJECTS);

    expect(body).toContain('2026-11-15（周日）');
    expect(body).toContain('- 工作台改版：计划 1 项，完成 1 项');
    expect(body).toContain('- [ ] 逾期任务（逾期，截止 2026-11-10）');
    expect(body).toContain('- [ ] 待结转任务（待结转）');
  });

  it('周起始日配置影响周期标签', () => {
    const board = makeBoard();
    const sunday = buildDailyDraft(board, { ...DEFAULT_SETTINGS, weekStart: 7 }, []);
    expect(sunday.title).toBe('2026-11-15（周日） 日报草稿');
  });
});
