import Dexie, { type Table } from 'dexie';

import type { LongTask, LongTaskException, LongTaskRuleVersion } from '@/domain/long-task';
import type {
  BackupTableName,
  DailyPlan,
  MetaRecord,
  Project,
  Report,
  SettingRecord,
  Tag,
  Task,
  WorkLog,
} from '@/domain/types';

/** IndexedDB 数据库名（单库单用户）。新版独立库名，避免与旧版 8 表库混淆。 */
export const DB_NAME = 'daily-schedule-lite';

/** IndexedDB 结构版本：只有增删表/索引时才递增。v2 = P3.2-S1（11 表）。 */
export const DB_VERSION = 2;

/** 数据结构版本：进入备份文件，字段语义变化时递增。v2 = 新增 tasks.deletedAt 与长期任务三表。 */
export const SCHEMA_VERSION = 2;

/** 各表在备份中的固定顺序（导出与校验共用，保证幂等）。备份格式本轮不改，仍为 8 表。 */
export const BACKUP_TABLE_NAMES: readonly BackupTableName[] = [
  'projects',
  'tags',
  'tasks',
  'dailyPlans',
  'workLogs',
  'reports',
  'settings',
  'meta',
];

/**
 * v1 的 8 表定义，**原样保留**。
 *
 * Dexie 升级要求保留历史版本声明，否则老库（v1）无法被正确识别、
 * 也无法建立 v1 → v2 的增量升级路径（P3.2-S1 验收门槛 C2）。
 * 测试也用它构造真实的 v1 数据库来验证回填与回滚。
 */
export const V1_STORES: Record<string, string> = {
  tasks: [
    'id',
    'projectId',
    'status',
    'priority',
    'planDate',
    'dueDate',
    'completedAt',
    'createdAt',
    'updatedAt',
    'parentId',
    '*tags',
    '[status+dueDate]',
    '[status+planDate]',
    '[projectId+status]',
    '[projectId+completedAt]',
  ].join(', '),
  projects: ['id', 'status', 'startDate', 'endDate', 'updatedAt', '*tags'].join(', '),
  dailyPlans: 'date, updatedAt',
  workLogs: [
    'id',
    'date',
    'projectId',
    'taskId',
    'createdAt',
    'updatedAt',
    '*tags',
    '[projectId+date]',
  ].join(', '),
  reports: [
    'id',
    'kind',
    'periodStart',
    'periodEnd',
    'generatedAt',
    'isSnapshot',
    '[kind+periodStart]',
    '[kind+periodStart+version]',
  ].join(', '),
  tags: 'id, name, kind, [name+kind]',
  settings: 'key',
  meta: 'key',
};

/**
 * v2 的 11 表定义（与冻结设计 v1.3 §4/§5 逐字一致）。
 *
 * 注意：`version(2).stores()` 必须**全量列出 11 张表**，漏写等于删表。
 * - tasks：v1 的 14 个索引全部保留，末尾追加 `deletedAt`；
 * - longTasks：生命周期事件内嵌在聚合根，不拆表；
 * - longTaskRuleVersions：两个唯一索引（effectiveFrom / versionNo）同时生效；
 * - longTaskExceptions：修订号在 (taskId, occurrenceDate) 内唯一。
 */
export const V2_STORES: Record<string, string> = {
  ...V1_STORES,
  tasks: `${V1_STORES.tasks ?? ''}, deletedAt`,
  longTasks: 'id, startDate, updatedAt, priority, deletedAt, *tags',
  longTaskRuleVersions: 'id, taskId, effectiveFrom, &[taskId+effectiveFrom], &[taskId+versionNo]',
  longTaskExceptions:
    'id, taskId, occurrenceDate, [taskId+occurrenceDate], &[taskId+occurrenceDate+revision]',
};

export class WorkbenchDatabase extends Dexie {
  declare tasks: Table<Task, string>;
  declare projects: Table<Project, string>;
  declare dailyPlans: Table<DailyPlan, string>;
  declare workLogs: Table<WorkLog, string>;
  declare reports: Table<Report, string>;
  declare tags: Table<Tag, string>;
  declare settings: Table<SettingRecord, string>;
  declare meta: Table<MetaRecord, string>;
  declare longTasks: Table<LongTask, string>;
  declare longTaskRuleVersions: Table<LongTaskRuleVersion, string>;
  declare longTaskExceptions: Table<LongTaskException, string>;

  constructor(name: string = DB_NAME) {
    super(name);
    // 保留 v1 声明：老库能识别、升级路径可增量执行。
    this.version(1).stores(V1_STORES);
    // v2：11 表 + tasks.deletedAt 回填。
    this.version(2)
      .stores(V2_STORES)
      .upgrade(async (tx) => {
        // 升级事务内逐行回填；modify 对全表游标生效，不存在"只改第一批"的问题。
        // 已存在有效值的行保持原值（仅 undefined 才补 null）。
        await tx
          .table('tasks')
          .toCollection()
          .modify((task: { deletedAt?: string | null }) => {
            if (task.deletedAt === undefined) task.deletedAt = null;
          });
      });
  }
}

/** 应用内共享实例。测试用 createDatabase 建独立库，避免相互污染。 */
export const db = new WorkbenchDatabase();

export function createDatabase(name?: string): WorkbenchDatabase {
  return new WorkbenchDatabase(name);
}

/** 把 Dexie / IndexedDB 异常翻译成可读中文，界面直接展示。 */
export function describeDatabaseError(error: unknown): string {
  if (error instanceof Dexie.MissingAPIError) {
    return '当前浏览器不支持 IndexedDB，或处于隐私模式限制下，无法保存数据。';
  }
  if (error instanceof Dexie.VersionError) {
    return '数据库版本高于当前应用版本，请升级应用后再打开。';
  }
  if (error instanceof Dexie.QuotaExceededError) {
    return '浏览器存储空间不足，请先导出备份并清理磁盘空间。';
  }
  if (error instanceof Dexie.DatabaseClosedError) {
    return '数据库连接已关闭，请刷新页面重试。';
  }
  if (error instanceof Error) {
    return error.message;
  }
  return '未知的数据库错误。';
}
