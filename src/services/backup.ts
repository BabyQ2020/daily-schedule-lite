import { z } from 'zod';

import type { WorkbenchDatabase } from '@/db/db';
import { BACKUP_TABLE_NAMES, SCHEMA_VERSION, db } from '@/db/db';
import type { LongTask, LongTaskException, LongTaskRuleVersion } from '@/domain/long-task';
import type {
  DailyPlan,
  MetaRecord,
  Project,
  Report,
  SettingRecord,
  Tag,
  Task,
  WorkLog,
} from '@/domain/types';
import { isISODateString } from '@/domain/guards';
import { checksumOf } from '@/lib/checksum';
import { META_KEYS } from '@/services/settings';

export const BACKUP_FORMAT = 'daily-schedule-lite/backup';
export const BACKUP_FORMAT_VERSION = 1;
export const APP_VERSION = '1.0.0';

/**
 * 备份表顺序：原 8 表（与 `BACKUP_TABLE_NAMES` 一致）在前，v2 新增 3 表在后。
 * 信封里的 `counts` 与 `data` 都按这个顺序生成，便于人工比对。
 */
export const BACKUP_TABLE_NAMES_V2 = [
  ...BACKUP_TABLE_NAMES,
  'longTasks',
  'longTaskRuleVersions',
  'longTaskExceptions',
] as const;

export type BackupTableNameV2 = (typeof BACKUP_TABLE_NAMES_V2)[number];

/** v1 备份里的任务可能没有 `deletedAt`（S1 之前的数据）。 */
type TaskV1 = Omit<Task, 'deletedAt'> & { deletedAt?: string | null };

export interface BackupDataV1 {
  projects: Project[];
  tags: Tag[];
  tasks: TaskV1[];
  dailyPlans: DailyPlan[];
  workLogs: WorkLog[];
  reports: Report[];
  settings: SettingRecord[];
  meta: MetaRecord[];
}

export interface BackupDataV2 {
  projects: Project[];
  tags: Tag[];
  tasks: Task[];
  dailyPlans: DailyPlan[];
  workLogs: WorkLog[];
  reports: Report[];
  settings: SettingRecord[];
  meta: MetaRecord[];
  longTasks: LongTask[];
  longTaskRuleVersions: LongTaskRuleVersion[];
  longTaskExceptions: LongTaskException[];
}

/** 导入校验失败：message 直接面向用户。 */
export class BackupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupValidationError';
  }
}

export type BackupCounts = Record<BackupTableNameV2, number>;

export interface BackupEnvelope {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  /** v1 备份只声明 8 个键，因此允许缺省。 */
  counts: Partial<BackupCounts>;
  checksum: string;
  data: BackupDataV1 | BackupDataV2;
}

export interface BackupInspection {
  envelope: BackupEnvelope;
  /** 归一化到当前 schema 版本后的数据（导入时应写入这份）。 */
  data: BackupDataV2;
  counts: BackupCounts;
  totalRecords: number;
  migratedFrom: number | null;
  exportedAt: string;
}

export interface BackupImportResult {
  counts: BackupCounts;
  totalRecords: number;
  migratedFrom: number | null;
}

/* ------------------------------------------------------------------ *
 * zod 结构校验
 * ------------------------------------------------------------------ */

const isoDate = z
  .string()
  .refine((value) => isISODateString(value), '日期格式应为 YYYY-MM-DD 且必须是真实日期');

const timestamp = z.string().min(1);

const prioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);

const tagSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    color: z.string().min(1),
    kind: z.enum(['task', 'project', 'log', 'general']),
    createdAt: timestamp,
  })
  .passthrough();

const milestoneSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    dueDate: isoDate.nullable(),
    done: z.boolean(),
    doneAt: timestamp.nullable(),
  })
  .passthrough();

const riskSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    level: z.enum(['low', 'medium', 'high']),
    status: z.enum(['open', 'resolved']),
    note: z.string(),
    createdAt: timestamp,
  })
  .passthrough();

const projectSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
    status: z.enum(['active', 'paused', 'completed', 'archived']),
    startDate: isoDate.nullable(),
    endDate: isoDate.nullable(),
    tags: z.array(z.string()),
    progressMode: z.enum(['auto', 'manual']),
    manualProgress: z.number().nullable(),
    milestones: z.array(milestoneSchema),
    risks: z.array(riskSchema),
    archivedAt: timestamp.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .passthrough();

/** v1 任务：允许缺 `deletedAt`（导入后由归一化补齐）。 */
const taskSchemaV1 = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string(),
    projectId: z.string().nullable(),
    status: z.enum(['todo', 'doing', 'done', 'cancelled']),
    priority: prioritySchema,
    planDate: isoDate.nullable(),
    dueDate: isoDate.nullable(),
    completedAt: timestamp.nullable(),
    parentId: z.string().nullable(),
    tags: z.array(z.string()),
    note: z.string(),
    archivedAt: timestamp.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: timestamp.nullable().optional(),
  })
  .passthrough();

/** v2 任务：`deletedAt` 必须存在（可为 null）。 */
const taskSchemaV2 = taskSchemaV1.extend({ deletedAt: timestamp.nullable() });

const lifecycleEventSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(['created', 'paused', 'resumed', 'ended', 'reopened']),
    date: isoDate,
    note: z.string().nullable(),
    createdAt: timestamp,
  })
  .passthrough();

const recurrenceSpecSchema = z
  .object({ kind: z.enum(['daily', 'weekly', 'monthly']) })
  .passthrough();

const endConditionSchema = z
  .object({
    type: z.enum(['never', 'until', 'count']),
    until: isoDate.optional(),
    count: z.number().optional(),
  })
  .passthrough();

const longTaskSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string(),
    note: z.string(),
    priority: prioritySchema,
    startDate: isoDate,
    endDate: isoDate.nullable(),
    endCondition: endConditionSchema,
    tags: z.array(z.string()),
    events: z.array(lifecycleEventSchema),
    deletedAt: timestamp.nullable(),
    archivedAt: timestamp.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .passthrough();

const ruleVersionSchema = z
  .object({
    id: z.string().min(1),
    taskId: z.string().min(1),
    versionNo: z.number().int().positive(),
    effectiveFrom: isoDate,
    spec: recurrenceSpecSchema,
    changeNote: z.string(),
    createdAt: timestamp,
  })
  .passthrough();

const baseOccurrenceSchema = z
  .object({
    date: isoDate,
    slotIndex: z.number().int().positive(),
    versionId: z.string().min(1),
    title: z.string(),
    description: z.string(),
    note: z.string(),
    priority: prioritySchema,
    dueDate: isoDate.nullable(),
    tags: z.array(z.string()),
  })
  .passthrough();

const exceptionStateSchema = z.object({ mode: z.enum(['rule', 'skip', 'override']) }).passthrough();

const exceptionSchema = z
  .object({
    id: z.string().min(1),
    taskId: z.string().min(1),
    occurrenceDate: isoDate,
    revision: z.number().int().positive(),
    previousRevisionId: z.string().min(1).nullable(),
    changeKind: z.enum(['initial', 'correction', 'revocation']),
    baseOccurrence: baseOccurrenceSchema,
    before: exceptionStateSchema,
    after: exceptionStateSchema,
    reason: z.string().nullable(),
    createdAt: timestamp,
  })
  .passthrough();

const dailyPlanSchema = z
  .object({
    date: isoDate,
    taskIds: z.array(z.string()),
    extras: z.array(z.string()),
    note: z.string(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .passthrough();

const workLogSchema = z
  .object({
    id: z.string().min(1),
    date: isoDate,
    title: z.string().min(1),
    content: z.string(),
    insight: z.string(),
    problem: z.string(),
    solution: z.string(),
    projectId: z.string().nullable(),
    taskId: z.string().nullable(),
    tags: z.array(z.string()),
    taskTitleSnapshot: z.string().nullable(),
    projectNameSnapshot: z.string().nullable(),
    searchText: z.string(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .passthrough();

const reportSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(['day', 'week', 'month']),
    periodStart: isoDate,
    periodEnd: isoDate,
    generatedAt: timestamp,
    metrics: z.record(z.string(), z.unknown()),
    body: z.string(),
    isEdited: z.boolean(),
    isSnapshot: z.boolean(),
    version: z.number().int().positive(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .passthrough();

const settingRecordSchema = z.object({ key: z.string().min(1), value: z.unknown() }).passthrough();

const metaRecordSchema = z.object({ key: z.string().min(1), value: z.unknown() }).passthrough();

/** v1：8 个数组；`passthrough()` 保留未来字段，避免校验和因裁剪而漂移。 */
const dataSchemaV1 = z
  .object({
    tasks: z.array(taskSchemaV1),
    projects: z.array(projectSchema),
    dailyPlans: z.array(dailyPlanSchema),
    workLogs: z.array(workLogSchema),
    reports: z.array(reportSchema),
    tags: z.array(tagSchema),
    settings: z.array(settingRecordSchema),
    meta: z.array(metaRecordSchema),
  })
  .passthrough();

/** v2：11 个数组，缺任何一个都是结构错误（设计 §11.3 第 4 步）。 */
const dataSchemaV2 = z
  .object({
    tasks: z.array(taskSchemaV2),
    projects: z.array(projectSchema),
    dailyPlans: z.array(dailyPlanSchema),
    workLogs: z.array(workLogSchema),
    reports: z.array(reportSchema),
    tags: z.array(tagSchema),
    settings: z.array(settingRecordSchema),
    meta: z.array(metaRecordSchema),
    longTasks: z.array(longTaskSchema),
    longTaskRuleVersions: z.array(ruleVersionSchema),
    longTaskExceptions: z.array(exceptionSchema),
  })
  .passthrough();

const envelopeSchema = z
  .object({
    format: z.string(),
    formatVersion: z.number(),
    schemaVersion: z.number().int().positive(),
    appVersion: z.string(),
    exportedAt: z.string(),
    counts: z.record(z.string(), z.number()).optional(),
    checksum: z.string(),
    data: z.union([dataSchemaV1, dataSchemaV2]),
  })
  .passthrough();

/* ------------------------------------------------------------------ *
 * 导出
 * ------------------------------------------------------------------ */

function emptyCounts(): BackupCounts {
  return {
    projects: 0,
    tags: 0,
    tasks: 0,
    dailyPlans: 0,
    workLogs: 0,
    reports: 0,
    settings: 0,
    meta: 0,
    longTasks: 0,
    longTaskRuleVersions: 0,
    longTaskExceptions: 0,
  };
}

export function countsOf(data: BackupDataV2): BackupCounts {
  const counts = emptyCounts();
  for (const table of BACKUP_TABLE_NAMES_V2) {
    counts[table] = data[table].length;
  }
  return counts;
}

export async function collectBackupData(database: WorkbenchDatabase = db): Promise<BackupDataV2> {
  const [
    projects,
    tags,
    tasks,
    dailyPlans,
    workLogs,
    reports,
    settings,
    meta,
    longTasks,
    longTaskRuleVersions,
    longTaskExceptions,
  ] = await Promise.all([
    database.projects.toArray(),
    database.tags.toArray(),
    database.tasks.toArray(),
    database.dailyPlans.toArray(),
    database.workLogs.toArray(),
    database.reports.toArray(),
    database.settings.toArray(),
    database.meta.toArray(),
    database.longTasks.toArray(),
    database.longTaskRuleVersions.toArray(),
    database.longTaskExceptions.toArray(),
  ]);
  return {
    projects,
    tags,
    tasks,
    dailyPlans,
    workLogs,
    reports,
    settings,
    meta,
    longTasks,
    longTaskRuleVersions,
    longTaskExceptions,
  };
}

export interface ExportBackupOptions {
  now?: Date;
  appVersion?: string;
  database?: WorkbenchDatabase;
}

export async function exportBackup(
  options: ExportBackupOptions = {},
): Promise<{ envelope: BackupEnvelope; text: string; fileName: string }> {
  const database = options.database ?? db;
  const now = options.now ?? new Date();
  const exportedAt = now.toISOString();
  const data = await collectBackupData(database);
  // 备份里的 meta 需要反映本次导出动作，否则「最后备份时间」会滞后。
  const meta = upsertMeta(data.meta, META_KEYS.lastBackupAt, exportedAt);
  const payload: BackupDataV2 = { ...data, meta };
  const envelope: BackupEnvelope = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    appVersion: options.appVersion ?? APP_VERSION,
    exportedAt,
    counts: countsOf(payload),
    checksum: checksumOf(payload),
    data: payload,
  };
  return { envelope, text: serializeBackup(envelope), fileName: backupFileName(now) };
}

export function serializeBackup(envelope: BackupEnvelope): string {
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

function upsertMeta(meta: readonly MetaRecord[], key: string, value: unknown): MetaRecord[] {
  const exists = meta.some((record) => record.key === key);
  if (!exists) {
    return [...meta, { key, value }];
  }
  return meta.map((record) => (record.key === key ? { key, value } : record));
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

/** 备份文件名：daily-schedule-lite-backup-20261116-1930.json（本地时间，便于人工辨认）。 */
export function backupFileName(now: Date = new Date()): string {
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `daily-schedule-lite-backup-${stamp}.json`;
}

/* ------------------------------------------------------------------ *
 * 引用完整性校验
 * ------------------------------------------------------------------ */

function duplicateIds(items: readonly { id?: string }[], label: string): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const item of items) {
    const id = item.id ?? '';
    if (seen.has(id)) {
      duplicates.push(`${label}存在重复 id：${id}`);
    }
    seen.add(id);
  }
  return duplicates;
}

export function validateReferences(data: BackupDataV2): string[] {
  const errors: string[] = [];
  const projectIds = new Set(data.projects.map((project) => project.id));
  const taskIds = new Set(data.tasks.map((task) => task.id));
  const tagIds = new Set(data.tags.map((tag) => tag.id));
  const longTaskIds = new Set(data.longTasks.map((task) => task.id));

  errors.push(...duplicateIds(data.tasks, '任务'));
  errors.push(...duplicateIds(data.projects, '项目'));
  errors.push(...duplicateIds(data.tags, '标签'));
  errors.push(...duplicateIds(data.workLogs as { id?: string }[], '日志'));
  errors.push(...duplicateIds(data.reports, '报告'));
  errors.push(...duplicateIds(data.longTasks, '长期任务'));
  errors.push(...duplicateIds(data.longTaskRuleVersions, '规则版本'));
  errors.push(...duplicateIds(data.longTaskExceptions, '单次例外'));

  const planDates = new Set<string>();
  for (const plan of data.dailyPlans) {
    if (planDates.has(plan.date)) {
      errors.push(`每日计划存在重复日期：${plan.date}`);
    }
    planDates.add(plan.date);
  }

  for (const report of data.reports) {
    if (report.periodStart > report.periodEnd) {
      errors.push(`报告「${report.id}」的周期开始日期晚于结束日期`);
    }
  }

  for (const task of data.tasks) {
    if (task.projectId !== null && !projectIds.has(task.projectId)) {
      errors.push(`任务「${task.title}」引用了不存在的项目：${task.projectId}`);
    }
    if (task.parentId !== null && !taskIds.has(task.parentId)) {
      errors.push(`任务「${task.title}」引用了不存在的父任务：${task.parentId}`);
    }
    for (const tagId of task.tags) {
      if (!tagIds.has(tagId)) {
        errors.push(`任务「${task.title}」引用了不存在的标签：${tagId}`);
      }
    }
  }

  for (const project of data.projects) {
    for (const tagId of project.tags) {
      if (!tagIds.has(tagId)) {
        errors.push(`项目「${project.name}」引用了不存在的标签：${tagId}`);
      }
    }
  }

  for (const plan of data.dailyPlans) {
    for (const taskId of plan.taskIds) {
      if (!taskIds.has(taskId)) {
        errors.push(`每日计划 ${plan.date} 引用了不存在的任务：${taskId}`);
      }
    }
  }

  for (const log of data.workLogs) {
    if (log.projectId !== null && !projectIds.has(log.projectId)) {
      errors.push(`日志「${log.title}」引用了不存在的项目：${log.projectId}`);
    }
    if (log.taskId !== null && !taskIds.has(log.taskId)) {
      errors.push(`日志「${log.title}」引用了不存在的任务：${log.taskId}`);
    }
    for (const tagId of log.tags) {
      if (!tagIds.has(tagId)) {
        errors.push(`日志「${log.title}」引用了不存在的标签：${tagId}`);
      }
    }
  }

  // ---- 长期任务（v2）----
  for (const longTask of data.longTasks) {
    for (const tagId of longTask.tags) {
      if (!tagIds.has(tagId)) {
        errors.push(`长期任务「${longTask.title}」引用了不存在的标签：${tagId}`);
      }
    }
  }

  for (const version of data.longTaskRuleVersions) {
    if (!longTaskIds.has(version.taskId)) {
      errors.push(`规则版本「${version.id}」引用了不存在的长期任务：${version.taskId}`);
    }
  }

  // 每个 (taskId, occurrenceDate) 的 revision 必须从 1 起连续，且前序指向 revision-1。
  const revisionChains = new Map<string, Map<number, LongTaskException>>();
  for (const exception of data.longTaskExceptions) {
    if (!longTaskIds.has(exception.taskId)) {
      errors.push(`单次例外「${exception.id}」引用了不存在的长期任务：${exception.taskId}`);
      continue;
    }
    const key = `${exception.taskId}|${exception.occurrenceDate}`;
    const chain = revisionChains.get(key) ?? new Map<number, LongTaskException>();
    if (chain.has(exception.revision)) {
      errors.push(
        `长期任务「${exception.taskId}」在 ${exception.occurrenceDate} 存在重复的修订号：${exception.revision}`,
      );
    }
    chain.set(exception.revision, exception);
    revisionChains.set(key, chain);
  }

  for (const [key, chain] of revisionChains) {
    const revisions = [...chain.keys()].sort((left, right) => left - right);
    for (let index = 0; index < revisions.length; index += 1) {
      const expected = index + 1;
      const actual = revisions[index]!;
      if (actual !== expected) {
        errors.push(`长期任务修订链断裂（${key}）：期望修订号 ${expected}，实际为 ${actual}`);
        break;
      }
    }
    for (const [revision, exception] of chain) {
      const previousId = exception.previousRevisionId;
      if (revision === 1) {
        if (previousId !== null) {
          errors.push(`例外「${exception.id}」是首版修订，previousRevisionId 应为空`);
        }
        continue;
      }
      const previous = chain.get(revision - 1);
      if (!previous || previous.id !== previousId) {
        errors.push(
          `例外「${exception.id}」的 previousRevisionId 未指向同一日期的上一版修订（第 ${revision - 1} 版）`,
        );
      }
    }
  }

  return errors;
}

/* ------------------------------------------------------------------ *
 * 导入
 * ------------------------------------------------------------------ */

function formatIssues(error: z.ZodError): string {
  const messages = error.issues.slice(0, 3).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '根对象';
    return `${path}：${issue.message}`;
  });
  const suffix = error.issues.length > 3 ? `（共 ${error.issues.length} 处问题）` : '';
  return `备份文件字段校验失败 —— ${messages.join('；')}${suffix}`;
}

/** 只解析与校验，不写数据库；供导入前预览与错误提示使用。 */
export function inspectBackupText(text: string): BackupInspection {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new BackupValidationError('备份文件内容为空。');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    throw new BackupValidationError(
      '备份文件不是有效的 JSON，请确认选择的是本应用导出的 .json 文件。',
    );
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BackupValidationError('备份文件结构不正确：顶层应为 JSON 对象。');
  }

  const candidate = raw as Record<string, unknown>;
  if (candidate.format !== BACKUP_FORMAT) {
    throw new BackupValidationError('这不是日程轻量版的备份文件（format 标识不匹配）。');
  }
  if (candidate.formatVersion !== BACKUP_FORMAT_VERSION) {
    const version = String(candidate.formatVersion);
    throw new BackupValidationError(
      `备份文件格式版本 v${version} 不受支持，当前应用仅支持 v${BACKUP_FORMAT_VERSION}。`,
    );
  }

  // 第 4/5 步：先确定数据版本，再选择对应 schema；高于当前版本直接拒绝。
  const declaredSchema = candidate.schemaVersion;
  if (
    typeof declaredSchema !== 'number' ||
    !Number.isInteger(declaredSchema) ||
    declaredSchema < 1
  ) {
    throw new BackupValidationError('备份文件缺少有效的 schemaVersion。');
  }
  if (declaredSchema > SCHEMA_VERSION) {
    throw new BackupValidationError(
      `备份数据版本 v${declaredSchema} 高于当前应用支持的 v${SCHEMA_VERSION}，请先升级应用再导入。`,
    );
  }
  if (declaredSchema !== 1 && declaredSchema !== SCHEMA_VERSION) {
    throw new BackupValidationError(`不支持的备份数据版本：v${declaredSchema}。`);
  }

  const parsed = envelopeSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new BackupValidationError(formatIssues(parsed.error));
  }
  const envelope = parsed.data as unknown as BackupEnvelope;

  // v2 声明必须带全 11 个数组：zod 的 v2 schema 已强制，这里再给出可读提示。
  if (declaredSchema === SCHEMA_VERSION) {
    const missing = BACKUP_TABLE_NAMES_V2.filter(
      (table) => !Array.isArray((envelope.data as unknown as Record<string, unknown>)[table]),
    );
    if (missing.length > 0) {
      throw new BackupValidationError(
        `备份数据版本为 v2，但缺少数据表：${missing.join('、')}。文件可能不是完整备份。`,
      );
    }
  }

  // 第 6 步：checksum 必须对「原始 data」计算——补数组或补 deletedAt 之后再算必然不符。
  const recomputed = checksumOf(envelope.data);
  if (recomputed !== envelope.checksum) {
    throw new BackupValidationError(
      '备份文件校验和不匹配，文件可能已损坏或被修改，已停止导入（未写入任何数据）。',
    );
  }

  // 第 7 步：归一化到 v2（v1 备份补 3 个空数组 + tasks.deletedAt ??= null）。
  const normalized = normalizeBackupData(envelope.data);
  const actualCounts = countsOf(normalized);
  const actualTotal = BACKUP_TABLE_NAMES_V2.reduce((sum, table) => sum + actualCounts[table], 0);

  // 第 8 步：counts 与归一化后的数据比对；v1 只声明 8 键，缺的按 0 跳过。
  for (const table of BACKUP_TABLE_NAMES_V2) {
    const declared = envelope.counts?.[table];
    if (declared !== undefined && declared !== actualCounts[table]) {
      throw new BackupValidationError(
        `备份文件元信息与内容不一致：${table} 声明 ${declared} 条，实际 ${actualCounts[table]} 条。文件可能已损坏或被修改。`,
      );
    }
  }

  // 第 9 步：引用完整性。
  const referenceErrors = validateReferences(normalized);
  if (referenceErrors.length > 0) {
    const head = referenceErrors.slice(0, 3).join('；');
    const suffix = referenceErrors.length > 3 ? `（共 ${referenceErrors.length} 处问题）` : '';
    throw new BackupValidationError(`备份数据存在悬空引用 —— ${head}${suffix}`);
  }

  const migratedFrom = declaredSchema < SCHEMA_VERSION ? declaredSchema : null;

  return {
    envelope,
    data: normalized,
    counts: actualCounts,
    totalRecords: actualTotal,
    migratedFrom,
    exportedAt: envelope.exportedAt,
  };
}

/** 把 v1/v2 原始数据统一成 11 数组的 v2 结构；不修改传入对象。 */
function normalizeBackupData(data: BackupDataV1 | BackupDataV2): BackupDataV2 {
  const candidate = data as Partial<BackupDataV2> & BackupDataV1;
  const tasks = (candidate.tasks ?? []).map((task) => ({
    ...task,
    deletedAt: task.deletedAt ?? null,
  })) as Task[];
  return {
    projects: candidate.projects ?? [],
    tags: candidate.tags ?? [],
    tasks,
    dailyPlans: candidate.dailyPlans ?? [],
    workLogs: candidate.workLogs ?? [],
    reports: candidate.reports ?? [],
    settings: candidate.settings ?? [],
    meta: candidate.meta ?? [],
    longTasks: candidate.longTasks ?? [],
    longTaskRuleVersions: candidate.longTaskRuleVersions ?? [],
    longTaskExceptions: candidate.longTaskExceptions ?? [],
  };
}

/** 覆盖式导入：先清空再写入，整个过程在一个事务内，失败自动回滚。 */
export async function applyBackup(
  inspection: BackupInspection,
  database: WorkbenchDatabase = db,
): Promise<BackupImportResult> {
  const { data } = inspection;
  const meta = upsertMeta(data.meta, META_KEYS.lastImportedAt, new Date().toISOString());

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
      database.longTasks,
      database.longTaskRuleVersions,
      database.longTaskExceptions,
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
        database.longTasks.clear(),
        database.longTaskRuleVersions.clear(),
        database.longTaskExceptions.clear(),
      ]);

      if (data.projects.length > 0) {
        await database.projects.bulkAdd(data.projects as Project[]);
      }
      if (data.tags.length > 0) {
        await database.tags.bulkAdd(data.tags as Tag[]);
      }
      if (data.tasks.length > 0) {
        await database.tasks.bulkAdd(data.tasks as unknown as Task[]);
      }
      if (data.dailyPlans.length > 0) {
        await database.dailyPlans.bulkAdd(data.dailyPlans as unknown as DailyPlan[]);
      }
      if (data.workLogs.length > 0) {
        await database.workLogs.bulkAdd(data.workLogs as unknown as WorkLog[]);
      }
      if (data.reports.length > 0) {
        await database.reports.bulkAdd(data.reports as unknown as Report[]);
      }
      if (data.longTasks.length > 0) {
        await database.longTasks.bulkAdd(data.longTasks);
      }
      if (data.longTaskRuleVersions.length > 0) {
        await database.longTaskRuleVersions.bulkAdd(data.longTaskRuleVersions);
      }
      if (data.longTaskExceptions.length > 0) {
        await database.longTaskExceptions.bulkAdd(data.longTaskExceptions);
      }
      if (data.settings.length > 0) {
        await database.settings.bulkPut(data.settings as SettingRecord[]);
      }
      await database.meta.bulkPut(meta);
    },
  );

  return {
    counts: inspection.counts,
    totalRecords: inspection.totalRecords,
    migratedFrom: inspection.migratedFrom,
  };
}

export async function importBackupText(
  text: string,
  database: WorkbenchDatabase = db,
): Promise<BackupImportResult> {
  const inspection = inspectBackupText(text);
  return applyBackup(inspection, database);
}

/** 规范化提示文案：调用方可直接把异常 message 展示给用户。 */
export function describeImportError(error: unknown): string {
  if (error instanceof BackupValidationError) {
    return error.message;
  }
  if (error instanceof Error) {
    return `导入失败：${error.message}`;
  }
  return '导入失败：未知错误。';
}
