import { db, type WorkbenchDatabase } from '@/db/db';
import {
  createLog as createLogRecord,
  deleteLog as deleteLogRecord,
  getLog as getLogRecord,
  queryLogs as queryLogsRecord,
  updateLog as updateLogRecord,
  type LogCreateInput,
  type LogFilter,
  type LogUpdateInput,
} from '@/repositories/logs';
import type { WorkLog } from '@/domain/types';
import type { PageRequest, PagedResult } from '@/repositories/shared';

/**
 * 工作日志应用服务：页面与抽屉只依赖本模块。
 * 快照字段（taskTitleSnapshot / projectNameSnapshot）与 searchText 重建在 Repository。
 */

export type { LogCreateInput, LogFilter, LogUpdateInput };

export function queryLogs(
  filter: LogFilter,
  page: PageRequest = {},
  database: WorkbenchDatabase = db,
): Promise<PagedResult<WorkLog>> {
  return queryLogsRecord(filter, page, database);
}

export function getLog(id: string, database: WorkbenchDatabase = db): Promise<WorkLog | undefined> {
  return getLogRecord(id, database);
}

export function createLog(
  input: LogCreateInput,
  database: WorkbenchDatabase = db,
): Promise<WorkLog> {
  return createLogRecord(input, database);
}

export function updateLog(
  id: string,
  patch: LogUpdateInput,
  database: WorkbenchDatabase = db,
): Promise<WorkLog> {
  return updateLogRecord(id, patch, database);
}

export function deleteLog(id: string, database: WorkbenchDatabase = db): Promise<void> {
  return deleteLogRecord(id, database);
}
