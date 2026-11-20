import type { WorkbenchDatabase } from '@/db/db';
import { db } from '@/db/db';
import type { AppSettings, Project, Task } from '@/domain/types';
import type { ISODate, WeekStart } from '@/lib/period';
import { formatPeriodLabel, periodFor } from '@/lib/period';
import { listProjects } from '@/repositories/projects';
import { DEFAULT_SETTINGS, loadSettings } from '@/services/settings';
import type { TodayBoard } from '@/services/stats/today';
import { loadTodayBoard } from '@/services/stats/today';

/** 日报草稿的统计数字：全部来自 TodayBoard，页面不重复计算。 */
export interface DailyDraftMetrics {
  planned: number;
  plannedDone: number;
  /** 计划完成率（百分数，向下取整）；没有计划任务时为 null。 */
  completionRate: number | null;
  dueToday: number;
  overdue: number;
  carryOver: number;
  doneByCompletion: number;
  logs: number;
}

export interface DailyDraft {
  date: ISODate;
  title: string;
  body: string;
  metrics: DailyDraftMetrics;
}

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(PLACEHOLDER, (_, key: string) => values[key] ?? '');
}

export function computeCompletionRate(planned: number, plannedDone: number): number | null {
  if (planned <= 0) {
    return null;
  }
  return Math.floor((plannedDone / planned) * 100);
}

function taskLine(task: Task, projectName: string | undefined): string {
  const checkbox = task.status === 'done' ? '[x]' : '[ ]';
  const project = projectName ? `（${projectName}）` : '';
  return `- ${checkbox} ${task.title}${project}`;
}

function buildSummary(metrics: DailyDraftMetrics): string {
  const rate = metrics.completionRate === null ? '—' : `${metrics.completionRate}%`;
  return [
    `- 今日计划 ${metrics.planned} 项，已完成 ${metrics.plannedDone} 项（计划完成率 ${rate}）`,
    `- 按完成时间统计：今日完成 ${metrics.doneByCompletion} 项`,
    `- 今日到期待办 ${metrics.dueToday} 项，逾期 ${metrics.overdue} 项，待结转 ${metrics.carryOver} 项`,
    `- 今日工作日志 ${metrics.logs} 条`,
  ].join('\n');
}

function buildNextBlock(board: TodayBoard): string {
  const lines = [
    ...board.overdue.map((task) => {
      const due = task.dueDate ? `，截止 ${task.dueDate}` : '';
      return `- [ ] ${task.title}（逾期${due}）`;
    }),
    ...board.carryOver.map((task) => `- [ ] ${task.title}（待结转）`),
  ];
  if (lines.length === 0) {
    return '- 暂无逾期或待结转事项';
  }
  return lines.join('\n');
}

function buildProjectsBlock(
  board: TodayBoard,
  projectNameOf: (projectId: string | null) => string | undefined,
): string {
  const buckets = new Map<string, { planned: number; done: number }>();
  for (const task of board.planned) {
    const name = projectNameOf(task.projectId) ?? '未归属项目';
    const bucket = buckets.get(name) ?? { planned: 0, done: 0 };
    bucket.planned += 1;
    if (task.status === 'done') {
      bucket.done += 1;
    }
    buckets.set(name, bucket);
  }
  if (buckets.size === 0) {
    return '- 今日计划未关联项目';
  }
  return [...buckets.entries()]
    .map(([name, bucket]) => `- ${name}：计划 ${bucket.planned} 项，完成 ${bucket.done} 项`)
    .join('\n');
}

export function buildDailyDraft(
  board: TodayBoard,
  settings: AppSettings,
  projects: readonly Project[],
): DailyDraft {
  const metrics: DailyDraftMetrics = {
    planned: board.counts.planned,
    plannedDone: board.counts.plannedDone,
    completionRate: computeCompletionRate(board.counts.planned, board.counts.plannedDone),
    dueToday: board.counts.dueToday,
    overdue: board.counts.overdue,
    carryOver: board.counts.carryOver,
    doneByCompletion: board.counts.doneByCompletion,
    logs: board.logs.length,
  };

  const projectById = new Map(projects.map((project) => [project.id, project.name]));
  const projectNameOf = (projectId: string | null): string | undefined =>
    projectId === null ? undefined : projectById.get(projectId);

  const period = periodFor('day', board.date, settings.weekStart);
  const periodLabel = formatPeriodLabel(period);

  const tasksBlock =
    board.planned.length === 0
      ? '- 今日还没有安排任务'
      : board.planned.map((task) => taskLine(task, projectNameOf(task.projectId))).join('\n');

  const logsBlock =
    board.logs.length === 0
      ? '- 今日还没有记录工作日志'
      : board.logs
          .map((log) => {
            const firstLine = log.content.split('\n').find((line) => line.trim().length > 0);
            return firstLine ? `- ${log.title}：${firstLine.trim()}` : `- ${log.title}`;
          })
          .join('\n');

  const body = renderTemplate(settings.reportTemplates.day, {
    period: periodLabel,
    summary: buildSummary(metrics),
    tasks: tasksBlock,
    logs: logsBlock,
    projects: buildProjectsBlock(board, projectNameOf),
    next: buildNextBlock(board),
  });

  return {
    date: board.date,
    title: `${periodLabel} 日报草稿`,
    body,
    metrics,
  };
}

export async function loadDailyDraft(
  today: ISODate,
  database: WorkbenchDatabase = db,
): Promise<{ draft: DailyDraft; board: TodayBoard }> {
  const [board, settings, projects] = await Promise.all([
    loadTodayBoard(today, database),
    loadSettings(database),
    listProjects({ archived: 'all' }, database),
  ]);
  return { draft: buildDailyDraft(board, settings, projects), board };
}

/** 便于测试与后续阶段复用：仅按模板渲染，不读库。 */
export function renderDailyDraftWithTemplate(
  board: TodayBoard,
  template: string,
  weekStart: WeekStart,
  projects: readonly Project[] = [],
): string {
  const settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    weekStart,
    reportTemplates: { ...DEFAULT_SETTINGS.reportTemplates, day: template },
  };
  return buildDailyDraft(board, settings, projects).body;
}
