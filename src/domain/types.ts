import type { ISODate, WeekStart } from '@/lib/period';

/* ------------------------------------------------------------------ *
 * 通用约束
 * ------------------------------------------------------------------ */

export type Id = string;

/** 任务状态：归档不是状态，而是独立字段 archivedAt。 */
export type TaskStatus = 'todo' | 'doing' | 'done' | 'cancelled';

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export type ProjectStatus = 'active' | 'paused' | 'completed' | 'archived';

/** 进度模式：P0 仅实现 auto，manual 为 P1 预留（只存值，不参与计算）。 */
export type ProgressMode = 'auto' | 'manual';

export type ReportKind = 'day' | 'week' | 'month';

export type TagKind = 'task' | 'project' | 'log' | 'general';

export type ThemePreference = 'light' | 'system';

export const TASK_STATUSES: readonly TaskStatus[] = ['todo', 'doing', 'done', 'cancelled'];

export const TASK_PRIORITIES: readonly TaskPriority[] = ['low', 'medium', 'high', 'urgent'];

export const PROJECT_STATUSES: readonly ProjectStatus[] = [
  'active',
  'paused',
  'completed',
  'archived',
];

export const REPORT_KINDS: readonly ReportKind[] = ['day', 'week', 'month'];

export const TAG_KINDS: readonly TagKind[] = ['task', 'project', 'log', 'general'];

/* ------------------------------------------------------------------ *
 * 实体
 * ------------------------------------------------------------------ */

export interface Task {
  readonly id: Id;
  title: string;
  description: string;
  projectId: Id | null;
  status: TaskStatus;
  priority: TaskPriority;
  /** 计划执行日（本地日历串），用于每日工作台与完成率口径。 */
  planDate: ISODate | null;
  /** 截止日（本地日历串），逾期判定唯一依据。 */
  dueDate: ISODate | null;
  /** 完成时间（ISO 字符串），与 status=done 同时成立才算完成。 */
  completedAt: string | null;
  /** 父任务：P0 仅落库，不提供 UI（P1 子任务）。 */
  parentId: Id | null;
  /** 标签 id 列表。 */
  tags: Id[];
  note: string;
  /** 归档时间；非空即已归档，归档不参与完成率分母。 */
  archivedAt: string | null;
  /**
   * 回收站时间（v2 新增）；非空即已软删除，`null` 表示未删除。
   *
   * P3.2-S2.0 起为必填：新建任务必须显式写入 `null`，仓储读取时会把历史异常记录
   * 的 `undefined` 归一化为 `null`，绝不把缺失字段解释为已删除。
   */
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Milestone {
  readonly id: Id;
  title: string;
  dueDate: ISODate | null;
  done: boolean;
  doneAt: string | null;
}

export type RiskLevel = 'low' | 'medium' | 'high';

export type RiskStatus = 'open' | 'resolved';

export const RISK_LEVELS: readonly RiskLevel[] = ['low', 'medium', 'high'];

export const RISK_STATUSES: readonly RiskStatus[] = ['open', 'resolved'];

export interface ProjectRisk {
  readonly id: Id;
  title: string;
  level: RiskLevel;
  status: RiskStatus;
  note: string;
  createdAt: string;
}

export interface Project {
  readonly id: Id;
  name: string;
  description: string;
  status: ProjectStatus;
  startDate: ISODate | null;
  endDate: ISODate | null;
  tags: Id[];
  progressMode: ProgressMode;
  /** P1 手动进度覆盖（0–100），P0 不参与计算。 */
  manualProgress: number | null;
  milestones: Milestone[];
  risks: ProjectRisk[];
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 每日计划：以日期为主键，一天一条。
 * 完成情况不落库，始终由任务状态派生，避免两处口径不一致。
 */
export interface DailyPlan {
  readonly date: ISODate;
  taskIds: Id[];
  /** 补充事项（纯文本行，不参与统计）。 */
  extras: string[];
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkLog {
  readonly id: Id;
  date: ISODate;
  title: string;
  content: string;
  /** 心得 */
  insight: string;
  /** 遇到的问题 */
  problem: string;
  /** 解决方案 */
  solution: string;
  projectId: Id | null;
  taskId: Id | null;
  tags: Id[];
  /** 关联对象被删除后用于展示的只读快照（D19）。 */
  taskTitleSnapshot: string | null;
  projectNameSnapshot: string | null;
  /** 小写拼接后的检索字段（标题+正文+心得+问题+方案+标签名）。 */
  searchText: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 报告统计指标。字段一旦写入快照即冻结，不随原始数据变化。
 * 具体字段在阶段 F 落定，这里先给通用容器，避免导入校验拒绝合法备份。
 */
export interface ReportMetrics {
  readonly [key: string]: unknown;
}

export interface Report {
  readonly id: Id;
  kind: ReportKind;
  periodStart: ISODate;
  periodEnd: ISODate;
  generatedAt: string;
  metrics: ReportMetrics;
  body: string;
  /** 是否被人工编辑过（决定重新生成策略 D14）。 */
  isEdited: boolean;
  /** 快照：true 后永不更新。 */
  isSnapshot: boolean;
  /** 同一 kind + periodStart 下递增。 */
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  readonly id: Id;
  name: string;
  color: string;
  kind: TagKind;
  createdAt: string;
}

/* ------------------------------------------------------------------ *
 * 设置与元信息
 * ------------------------------------------------------------------ */

export interface AppSettings {
  weekStart: WeekStart;
  theme: ThemePreference;
  /** 备份提醒间隔（天），默认 7。 */
  backupReminderDays: number;
  /** 报告模板（阶段 F 使用）。 */
  reportTemplates: Record<ReportKind, string>;
}

export interface SettingRecord {
  readonly key: string;
  value: unknown;
}

export interface MetaRecord {
  readonly key: string;
  value: unknown;
}

/** 备份文件内的数据块。 */
export interface BackupData {
  tasks: Task[];
  projects: Project[];
  dailyPlans: DailyPlan[];
  workLogs: WorkLog[];
  reports: Report[];
  tags: Tag[];
  settings: SettingRecord[];
  meta: MetaRecord[];
}

export type BackupTableName = keyof BackupData;
