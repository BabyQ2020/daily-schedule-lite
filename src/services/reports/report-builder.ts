import type { WorkbenchDatabase } from '@/db/db';
import { db } from '@/db/db';
import type { AppSettings, Project, ReportKind, ReportMetrics } from '@/domain/types';
import type { ISODate, Period, WeekStart } from '@/lib/period';
import { formatPeriodLabel, periodFor } from '@/lib/period';
import { nowISOString } from '@/lib/clock';
import { loadSettings } from '@/services/settings';
import type { PeriodStats } from '@/services/stats/period-stats';
import { loadPeriodStats } from '@/services/stats/period-stats';

import { renderTemplate } from './daily-draft';

/** 模板里可用的占位符，与 DEFAULT_REPORT_TEMPLATES 保持一致。 */
const MAX_TASK_LINES = 20;
const MAX_LOG_LINES = 15;
const MAX_PROJECT_LINES = 10;

export interface ReportDraft {
  kind: ReportKind;
  period: Period;
  metrics: ReportMetrics;
  body: string;
}

export interface BuildReportDraftInput {
  stats: PeriodStats;
  projects: readonly Project[];
  settings: AppSettings;
  now?: string;
}

function projectNameOf(projects: readonly Project[], projectId: string | null): string | null {
  if (!projectId) {
    return null;
  }
  return projects.find((project) => project.id === projectId)?.name ?? null;
}

function taskLine(title: string, projectName: string | null, done: boolean, suffix = ''): string {
  const name = projectName ? `（${projectName}）` : '';
  return `- ${done ? '[x]' : '[ ]'} ${title}${name}${suffix}`;
}

function joinLines(lines: readonly string[], empty: string): string {
  return lines.length === 0 ? empty : lines.join('\n');
}

function summarySection(stats: PeriodStats): string {
  const { tasks, logs, projects } = stats;
  const rate = tasks.completionRate === null ? '—' : `${String(tasks.completionRate)}%`;
  const lines = [
    `- 计划任务：${String(tasks.plannedTotal)} 项，已完成 ${String(tasks.plannedDone)} 项，完成率 ${rate}`,
    `- 按完成时间统计：完成 ${String(tasks.completedByCompletion)} 项（与上面的计划完成率不是同一口径）`,
    `- 期末未完成：逾期 ${String(tasks.overdueAtEnd)} 项，待结转 ${String(tasks.carryOverAtEnd)} 项`,
    `- 工作日志：${String(logs.total)} 条，覆盖 ${String(logs.daysWithLogs)} 天`,
    `- 参与项目：${String(projects.touched.length)} 个（全部进行中项目 ${String(projects.active)} 个）`,
  ];
  if (tasks.created > 0) {
    lines.push(`- 本期新建任务：${String(tasks.created)} 项`);
  }
  return lines.join('\n');
}

/** 由统计结果 + 项目列表 + 模板拼接出报告正文；不做 IO，便于单测。 */
export function buildReportDraft(
  kind: ReportKind,
  period: Period,
  { stats, projects, settings, now }: BuildReportDraftInput,
): ReportDraft {
  const projectLines = stats.projects.touched.slice(0, MAX_PROJECT_LINES).map((item) => {
    const percent = item.progress.percent === null ? '—' : `${String(item.progress.percent)}%`;
    return `- ${item.name}：${percent}（已完成 ${String(item.progress.done)} / ${String(item.progress.counted)}）`;
  });

  const taskLines = stats.completedTasks
    .slice(0, MAX_TASK_LINES)
    .map((task) =>
      taskLine(
        task.title,
        projectNameOf(projects, task.projectId),
        true,
        `（${task.completedAt?.slice(0, 10) ?? ''}）`,
      ),
    );
  if (stats.completedTasks.length > MAX_TASK_LINES) {
    taskLines.push(
      `- …… 另有 ${String(stats.completedTasks.length - MAX_TASK_LINES)} 项已完成任务`,
    );
  }

  const logLines = stats.logEntries
    .slice(0, MAX_LOG_LINES)
    .map((log) => `- ${log.date.slice(5)} ${log.title}`);
  if (stats.logEntries.length > MAX_LOG_LINES) {
    logLines.push(`- …… 另有 ${String(stats.logEntries.length - MAX_LOG_LINES)} 条日志`);
  }

  const nextLines = stats.carriedTasks
    .slice(0, MAX_TASK_LINES)
    .map((task) =>
      taskLine(
        task.title,
        projectNameOf(projects, task.projectId),
        false,
        task.planDate ? `（计划 ${task.planDate}）` : '',
      ),
    );

  const body = renderTemplate(settings.reportTemplates[kind], {
    period: formatPeriodLabel(period),
    summary: summarySection(stats),
    tasks: joinLines(taskLines, '（本期没有完成的任务）'),
    logs: joinLines(logLines, '（本期没有工作日志）'),
    projects: joinLines(projectLines, '（本期没有关联项目）'),
    next: joinLines(nextLines, '（没有待结转任务）'),
  });

  const metrics: ReportMetrics = {
    kind,
    periodStart: period.start,
    periodEnd: period.end,
    generatedAt: now ?? nowISOString(),
    weekStart: settings.weekStart,
    tasks: { ...stats.tasks },
    logs: { ...stats.logs },
    projects: {
      active: stats.projects.active,
      touched: stats.projects.touched.map((item) => ({
        id: item.id,
        name: item.name,
        percent: item.progress.percent,
        done: item.progress.done,
        counted: item.progress.counted,
      })),
    },
  };

  return { kind, period, metrics, body };
}

export interface LoadReportDraftOptions {
  weekStart?: WeekStart;
  now?: string;
}

/** 读取当期数据并生成一份「当前时点」的报告草稿（不落库）。 */
export async function loadReportDraft(
  kind: ReportKind,
  anchor: ISODate,
  database: WorkbenchDatabase = db,
  options: LoadReportDraftOptions = {},
): Promise<ReportDraft> {
  const settings = await loadSettings(database);
  const weekStart = options.weekStart ?? settings.weekStart;
  const period = periodFor(kind, anchor, weekStart);
  const [stats, projects] = await Promise.all([
    loadPeriodStats(kind, period, database),
    database.projects.toArray(),
  ]);
  return buildReportDraft(kind, period, {
    stats,
    projects,
    settings: { ...settings, weekStart },
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}
