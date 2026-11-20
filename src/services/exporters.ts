import type { WorkbenchDatabase } from '@/db/db';
import { db } from '@/db/db';
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from '@/domain/labels';
import type { Task, WorkLog } from '@/domain/types';
import { toISODate } from '@/lib/period';

/** Excel 需要 BOM 才能按 UTF-8 打开中文 CSV，否则会显示乱码。 */
const CSV_BOM = '\uFEFF';
/** CRLF 是 Excel 的默认行尾，Windows 下兼容性最好。 */
const CSV_EOL = '\r\n';

export const TASK_CSV_HEADERS = [
  '标题',
  '项目',
  '状态',
  '优先级',
  '计划日期',
  '截止日期',
  '完成时间',
  '标签',
  '描述',
  '备注',
] as const;

export const LOG_CSV_HEADERS = [
  '日期',
  '标题',
  '项目',
  '任务快照',
  '标签',
  '正文',
  '心得',
  '问题',
  '解决方案',
] as const;

/**
 * 单元格转义：
 * - 含逗号、引号、换行时用双引号包裹，内部引号翻倍；
 * - 以 = + - @ 制表符或回车开头的文本会被 Excel 当作公式，前置单引号消除风险。
 */
export function escapeCsvCell(value: string): string {
  const hasFormulaPrefix = /^[=+\-@\t\r]/.test(value);
  const guarded = hasFormulaPrefix ? `'${value}` : value;
  if (/[",\r\n]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

export function toCsv(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((row) => row.map(escapeCsvCell).join(',')),
  ];
  return `${CSV_BOM}${lines.join(CSV_EOL)}${CSV_EOL}`;
}

export interface CsvExport {
  text: string;
  fileName: string;
  rowCount: number;
}

function dateStamp(now: Date): string {
  const iso = toISODate(now);
  return iso.replaceAll('-', '');
}

export function taskCsvFileName(now: Date = new Date()): string {
  return `daily-schedule-lite-任务-${dateStamp(now)}.csv`;
}

export function logCsvFileName(now: Date = new Date()): string {
  return `daily-schedule-lite-日志-${dateStamp(now)}.csv`;
}

function tagNamesOf(tagIds: readonly string[], tagNames: Map<string, string>): string {
  return tagIds
    .map((id) => tagNames.get(id))
    .filter((name): name is string => Boolean(name))
    .join('、');
}

/** 导出全部任务（含归档），按创建时间升序，保证每次导出顺序稳定。 */
export async function exportTasksCsv(
  database: WorkbenchDatabase = db,
  now: Date = new Date(),
): Promise<CsvExport> {
  const [tasks, projects, tags] = await Promise.all([
    database.tasks.toArray(),
    database.projects.toArray(),
    database.tags.toArray(),
  ]);
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const tagNames = new Map(tags.map((tag) => [tag.id, tag.name]));

  const sorted = [...tasks].sort((left, right) => {
    const byCreated = left.createdAt.localeCompare(right.createdAt);
    return byCreated !== 0 ? byCreated : left.title.localeCompare(right.title, 'zh-CN');
  });

  const rows = sorted.map((task: Task) => [
    task.title,
    task.projectId === null ? '' : (projectNames.get(task.projectId) ?? ''),
    TASK_STATUS_LABELS[task.status].label,
    TASK_PRIORITY_LABELS[task.priority].label,
    task.planDate ?? '',
    task.dueDate ?? '',
    task.completedAt ?? '',
    tagNamesOf(task.tags, tagNames),
    task.description,
    task.note,
  ]);

  return {
    text: toCsv(TASK_CSV_HEADERS, rows),
    fileName: taskCsvFileName(now),
    rowCount: rows.length,
  };
}

/** 导出全部工作日志，按日期倒序（与日志页一致）。 */
export async function exportLogsCsv(
  database: WorkbenchDatabase = db,
  now: Date = new Date(),
): Promise<CsvExport> {
  const [logs, projects, tags] = await Promise.all([
    database.workLogs.toArray(),
    database.projects.toArray(),
    database.tags.toArray(),
  ]);
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const tagNames = new Map(tags.map((tag) => [tag.id, tag.name]));

  const sorted = [...logs].sort((left, right) => {
    const byDate = right.date.localeCompare(left.date);
    return byDate !== 0 ? byDate : right.createdAt.localeCompare(left.createdAt);
  });

  const rows = sorted.map((log: WorkLog) => [
    log.date,
    log.title,
    log.projectId === null
      ? ''
      : (projectNames.get(log.projectId) ?? log.projectNameSnapshot ?? ''),
    log.taskTitleSnapshot ?? '',
    tagNamesOf(log.tags, tagNames),
    log.content,
    log.insight,
    log.problem,
    log.solution,
  ]);

  return {
    text: toCsv(LOG_CSV_HEADERS, rows),
    fileName: logCsvFileName(now),
    rowCount: rows.length,
  };
}
