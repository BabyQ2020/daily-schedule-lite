import type { WorkbenchDatabase } from '@/db/db';
import { db } from '@/db/db';
import type { Id, Tag, WorkLog } from '@/domain/types';
import type { ISODate } from '@/lib/period';
import { isISODateString } from '@/domain/guards';
import { nowISOString } from '@/lib/clock';
import { createId } from '@/lib/id';
import { toSearchText } from '@/lib/checksum';

import { NotFoundError, ValidationError } from './errors';
import { paginate, type PageRequest, type PagedResult } from './shared';

export interface LogFilter {
  keyword?: string;
  projectId?: Id | 'all' | 'none';
  taskId?: Id | 'all';
  tagId?: Id | 'all';
  dateFrom?: ISODate;
  dateTo?: ISODate;
}

export interface LogCreateInput {
  date: ISODate;
  title: string;
  content?: string;
  insight?: string;
  problem?: string;
  solution?: string;
  projectId?: Id | null;
  taskId?: Id | null;
  tags?: readonly Id[];
  now?: string;
}

export interface LogUpdateInput {
  date?: ISODate;
  title?: string;
  content?: string;
  insight?: string;
  problem?: string;
  solution?: string;
  projectId?: Id | null;
  taskId?: Id | null;
  tags?: readonly Id[];
  now?: string;
}

function requireDate(date: ISODate): ISODate {
  if (!isISODateString(date)) {
    throw new ValidationError(`日志日期格式不正确：${date}（应为 YYYY-MM-DD）。`);
  }
  return date;
}

function requireTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    throw new ValidationError('日志标题不能为空。');
  }
  return trimmed;
}

/** 解析关联对象的展示快照与检索文本；引用已失效时回退到已有快照。 */
async function buildIndexFields(
  log: Pick<
    WorkLog,
    | 'title'
    | 'content'
    | 'insight'
    | 'problem'
    | 'solution'
    | 'projectId'
    | 'taskId'
    | 'tags'
    | 'taskTitleSnapshot'
    | 'projectNameSnapshot'
  >,
  database: WorkbenchDatabase,
): Promise<Pick<WorkLog, 'searchText' | 'taskTitleSnapshot' | 'projectNameSnapshot'>> {
  const [task, project] = await Promise.all([
    log.taskId ? database.tasks.get(log.taskId) : Promise.resolve(undefined),
    log.projectId ? database.projects.get(log.projectId) : Promise.resolve(undefined),
  ]);

  const tagRecords: Array<Tag | undefined> =
    log.tags.length > 0 ? await database.tags.bulkGet([...log.tags]) : [];

  const taskTitleSnapshot = task ? task.title : (log.taskTitleSnapshot ?? null);
  const projectNameSnapshot = project ? project.name : (log.projectNameSnapshot ?? null);
  const tagNames = tagRecords.filter((tag): tag is Tag => tag !== undefined).map((tag) => tag.name);

  return {
    taskTitleSnapshot,
    projectNameSnapshot,
    searchText: toSearchText([
      log.title,
      log.content,
      log.insight,
      log.problem,
      log.solution,
      taskTitleSnapshot,
      projectNameSnapshot,
      tagNames.join(' '),
    ]),
  };
}

function matches(log: WorkLog, filter: LogFilter): boolean {
  if (filter.projectId && filter.projectId !== 'all') {
    if (filter.projectId === 'none') {
      if (log.projectId !== null) {
        return false;
      }
    } else if (log.projectId !== filter.projectId) {
      return false;
    }
  }
  if (filter.taskId && filter.taskId !== 'all' && log.taskId !== filter.taskId) {
    return false;
  }
  if (filter.tagId && filter.tagId !== 'all' && !log.tags.includes(filter.tagId)) {
    return false;
  }
  if (filter.dateFrom && log.date < filter.dateFrom) {
    return false;
  }
  if (filter.dateTo && log.date > filter.dateTo) {
    return false;
  }
  const keyword = filter.keyword?.trim().toLowerCase();
  if (keyword) {
    const haystack = log.searchText || toSearchText([log.title, log.content]);
    if (!haystack.includes(keyword)) {
      return false;
    }
  }
  return true;
}

export async function queryLogs(
  filter: LogFilter = {},
  page: PageRequest = {},
  database: WorkbenchDatabase = db,
): Promise<PagedResult<WorkLog>> {
  const candidates =
    filter.projectId && filter.projectId !== 'all' && filter.projectId !== 'none'
      ? await database.workLogs.where('projectId').equals(filter.projectId).toArray()
      : filter.dateFrom && filter.dateTo && !filter.keyword
        ? await database.workLogs
            .where('date')
            .between(filter.dateFrom, filter.dateTo, true, true)
            .toArray()
        : await database.workLogs.toArray();

  const filtered = candidates
    .filter((log) => matches(log, filter))
    .sort((left, right) => {
      if (left.date !== right.date) {
        return left.date < right.date ? 1 : -1;
      }
      if (left.createdAt !== right.createdAt) {
        return left.createdAt < right.createdAt ? 1 : -1;
      }
      return left.id < right.id ? 1 : -1;
    });
  return paginate(filtered, page);
}

export async function listLogs(
  filter: LogFilter = {},
  database: WorkbenchDatabase = db,
): Promise<WorkLog[]> {
  const result = await queryLogs(filter, { page: 1, pageSize: 200 }, database);
  return result.items;
}

export async function getLog(
  id: Id,
  database: WorkbenchDatabase = db,
): Promise<WorkLog | undefined> {
  return database.workLogs.get(id);
}

export async function createLog(
  input: LogCreateInput,
  database: WorkbenchDatabase = db,
): Promise<WorkLog> {
  const now = input.now ?? nowISOString();
  const draft: WorkLog = {
    id: createId('log'),
    date: requireDate(input.date),
    title: requireTitle(input.title),
    content: input.content ?? '',
    insight: input.insight ?? '',
    problem: input.problem ?? '',
    solution: input.solution ?? '',
    projectId: input.projectId ?? null,
    taskId: input.taskId ?? null,
    tags: [...(input.tags ?? [])],
    taskTitleSnapshot: null,
    projectNameSnapshot: null,
    searchText: '',
    createdAt: now,
    updatedAt: now,
  };
  const indexFields = await buildIndexFields(draft, database);
  const log: WorkLog = { ...draft, ...indexFields };
  await database.workLogs.add(log);
  return log;
}

export async function updateLog(
  id: Id,
  patch: LogUpdateInput,
  database: WorkbenchDatabase = db,
): Promise<WorkLog> {
  const existing = await database.workLogs.get(id);
  if (!existing) {
    throw new NotFoundError('日志');
  }
  const now = patch.now ?? nowISOString();
  const next: WorkLog = {
    ...existing,
    ...(patch.date !== undefined ? { date: requireDate(patch.date) } : {}),
    ...(patch.title !== undefined ? { title: requireTitle(patch.title) } : {}),
    ...(patch.content !== undefined ? { content: patch.content } : {}),
    ...(patch.insight !== undefined ? { insight: patch.insight } : {}),
    ...(patch.problem !== undefined ? { problem: patch.problem } : {}),
    ...(patch.solution !== undefined ? { solution: patch.solution } : {}),
    ...(patch.projectId !== undefined ? { projectId: patch.projectId } : {}),
    ...(patch.taskId !== undefined ? { taskId: patch.taskId } : {}),
    ...(patch.tags !== undefined ? { tags: [...patch.tags] } : {}),
    updatedAt: now,
  };
  const indexFields = await buildIndexFields(next, database);
  const persisted: WorkLog = { ...next, ...indexFields };
  await database.workLogs.put(persisted);
  return persisted;
}

export async function deleteLog(id: Id, database: WorkbenchDatabase = db): Promise<void> {
  await database.workLogs.delete(id);
}
