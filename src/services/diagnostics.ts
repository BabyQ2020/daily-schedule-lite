import type { WorkbenchDatabase } from '@/db/db';
import { DB_VERSION, SCHEMA_VERSION, db, describeDatabaseError } from '@/db/db';
import { getLastBackupAt } from '@/services/settings';
import { BACKUP_TABLE_NAMES_V2, countsOf, type BackupCounts } from '@/services/backup';

export interface StorageEstimate {
  usage: number | null;
  quota: number | null;
}

export interface DataDiagnostics {
  counts: BackupCounts;
  totalRecords: number;
  dbVersion: number;
  schemaVersion: number;
  storage: StorageEstimate;
  lastBackupAt: string | null;
  supported: boolean;
  error: string | null;
}

async function readStorageEstimate(): Promise<StorageEstimate> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return { usage: null, quota: null };
  }
  try {
    const estimate = await navigator.storage.estimate();
    return {
      usage: typeof estimate.usage === 'number' ? estimate.usage : null,
      quota: typeof estimate.quota === 'number' ? estimate.quota : null,
    };
  } catch {
    return { usage: null, quota: null };
  }
}

export async function collectDiagnostics(
  database: WorkbenchDatabase = db,
): Promise<DataDiagnostics> {
  const emptyCounts = Object.fromEntries(
    BACKUP_TABLE_NAMES_V2.map((table) => [table, 0]),
  ) as BackupCounts;
  try {
    const data = {
      projects: await database.projects.toArray(),
      tags: await database.tags.toArray(),
      tasks: await database.tasks.toArray(),
      dailyPlans: await database.dailyPlans.toArray(),
      workLogs: await database.workLogs.toArray(),
      reports: await database.reports.toArray(),
      settings: await database.settings.toArray(),
      meta: await database.meta.toArray(),
      longTasks: await database.longTasks.toArray(),
      longTaskRuleVersions: await database.longTaskRuleVersions.toArray(),
      longTaskExceptions: await database.longTaskExceptions.toArray(),
    };
    const counts = countsOf(data);
    const totalRecords = BACKUP_TABLE_NAMES_V2.reduce((sum, table) => sum + counts[table], 0);
    return {
      counts,
      totalRecords,
      dbVersion: database.verno,
      schemaVersion: SCHEMA_VERSION,
      storage: await readStorageEstimate(),
      lastBackupAt: await getLastBackupAt(database),
      supported: true,
      error: null,
    };
  } catch (error) {
    return {
      counts: emptyCounts,
      totalRecords: 0,
      dbVersion: DB_VERSION,
      schemaVersion: SCHEMA_VERSION,
      storage: await readStorageEstimate(),
      lastBackupAt: null,
      supported: false,
      error: describeDatabaseError(error),
    };
  }
}

export interface CoreRecordCounts {
  tasks: number;
  logs: number;
}

/** 只读计数：给「备份提醒」这类界面用，避免页面直连数据库表。 */
export async function countCoreRecords(
  database: WorkbenchDatabase = db,
): Promise<CoreRecordCounts> {
  const [tasks, logs] = await Promise.all([database.tasks.count(), database.workLogs.count()]);
  return { tasks, logs };
}

export interface WriteProbeResult {
  ok: boolean;
  message: string;
}

/**
 * 写入回读自检：建一条临时任务 → 读回 → 删除，确认 IndexedDB 真的可写。
 * 用于设置页「数据层自检」，不产生残留数据。
 */
export async function runWriteProbe(database: WorkbenchDatabase = db): Promise<WriteProbeResult> {
  const marker = `自检_${Date.now()}`;
  try {
    const before = await database.tasks.count();
    const id = `probe_${Date.now().toString(36)}`;
    await database.tasks.add({
      id,
      title: marker,
      description: '',
      projectId: null,
      status: 'todo',
      priority: 'low',
      planDate: null,
      dueDate: null,
      completedAt: null,
      parentId: null,
      tags: [],
      note: '',
      archivedAt: null,
      deletedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const readBack = await database.tasks.get(id);
    await database.tasks.delete(id);
    const after = await database.tasks.count();
    if (!readBack || readBack.title !== marker) {
      return { ok: false, message: '写入成功但读回内容不一致。' };
    }
    if (before !== after) {
      return { ok: false, message: `自检后任务数量异常：写入前 ${before}，清理后 ${after}。` };
    }
    return { ok: true, message: '写入、读回、删除均正常。' };
  } catch (error) {
    return { ok: false, message: describeDatabaseError(error) };
  }
}

/** 清空全部数据（设置页需二次确认后调用）。 */
export async function clearAllData(database: WorkbenchDatabase = db): Promise<void> {
  await database.transaction(
    'rw',
    [
      database.projects,
      database.tags,
      database.tasks,
      database.dailyPlans,
      database.workLogs,
      database.reports,
      database.settings,
      database.meta,
    ],
    async () => {
      await Promise.all([
        database.projects.clear(),
        database.tags.clear(),
        database.tasks.clear(),
        database.dailyPlans.clear(),
        database.workLogs.clear(),
        database.reports.clear(),
        database.settings.clear(),
        database.meta.clear(),
      ]);
    },
  );
}
