import type { ISODate } from '@/lib/period';

import type { TaskPriority } from './types';

/** 长期任务生命周期状态（由 events 推导，不单独存字段）。 */
export type LongTaskState = 'active' | 'paused' | 'ended';

/** 重复类型：每天 / 每周多选星期 / 每月指定日期。 */
export type RecurrenceKind = 'daily' | 'weekly' | 'monthly';

/** 每天。 */
export interface DailyRecurrence {
  kind: 'daily';
}

/** 每周：weekdays 为 ISO 星期（周一 1 … 周日 7），至少一个。 */
export interface WeeklyRecurrence {
  kind: 'weekly';
  weekdays: number[];
}

/**
 * 每月：monthDays 取值 1–31 与 -1（每月最后一天）。
 * 写入时不改写规则，生成时按当月天数收敛（31→30/29/28，30→2 月月末）。
 */
export interface MonthlyRecurrence {
  kind: 'monthly';
  monthDays: number[];
}

export type RecurrenceSpec = DailyRecurrence | WeeklyRecurrence | MonthlyRecurrence;

/** 结束条件：永不 / 指定日期（含当日）/ 指定次数。 */
export type EndCondition =
  { type: 'never' } | { type: 'until'; until: ISODate } | { type: 'count'; count: number };

export type LifecycleEventType = 'created' | 'paused' | 'resumed' | 'ended' | 'reopened';

/**
 * 生命周期事件。events 是状态唯一事实源：
 * - created 只允许一条、date === startDate；
 * - paused/resumed 成对出现才是有效的暂停区间（半开区间 [pause, resume)）；
 * - ended 的 date 是「第一天不再执行」（与 endDate / until 的闭区间语义不同），
 *   之后必须追加新规则版本才能 reopened；
 * - reopened 使结束边界失效，重新生效日由新版本 effectiveFrom 决定。
 */
export interface LifecycleEvent {
  id: string;
  type: LifecycleEventType;
  date: ISODate;
  /** 选填备注，例如「出差」「项目复盘」。 */
  note: string | null;
  createdAt: string;
}

/** 规则版本快照（只追加、不可变）。 */
export interface LongTaskRuleVersion {
  id: string;
  taskId: string;
  /** 从 1 开始，只用于排序与展示。 */
  versionNo: number;
  /** 生效日（含当日），严格递增。 */
  effectiveFrom: ISODate;
  spec: RecurrenceSpec;
  changeNote: string | null;
  createdAt: string;
}

/** 单次例外要覆盖的字段（缺省表示沿用规则）。 */
export interface ExceptionOverride {
  title?: string;
  description?: string;
  note?: string;
  priority?: TaskPriority;
  dueDate?: ISODate | null;
  tags?: string[];
}

/** 单次例外的目标状态。 */
export type ExceptionState =
  { mode: 'rule' } | { mode: 'skip' } | { mode: 'override'; patch: ExceptionOverride };

/** 例外所替代的「原始规则安排」，供修订链追溯。 */
export interface BaseOccurrence {
  date: ISODate;
  slotIndex: number;
  versionId: string;
  title: string;
  description: string;
  note: string;
  priority: TaskPriority;
  /** 单次截止日：默认 null；系列 endDate 不会复制到这里。 */
  dueDate: ISODate | null;
  tags: string[];
}

export type ExceptionChangeKind = 'initial' | 'correction' | 'revocation';

/**
 * 单次例外（只追加）。
 * 有效状态 = 该 occurrenceDate 上 revision 最大的记录的 after；
 * 修订不会覆盖旧记录，before/after 与 reason 完整保留。
 */
export interface LongTaskException {
  id: string;
  taskId: string;
  occurrenceDate: ISODate;
  revision: number;
  previousRevisionId: string | null;
  changeKind: ExceptionChangeKind;
  baseOccurrence: BaseOccurrence;
  before: ExceptionState;
  after: ExceptionState;
  /** correction/revocation 必填。 */
  reason: string | null;
  createdAt: string;
}

/** 长期任务本体。状态由 events 推导，避免两处真相。 */
export interface LongTask {
  id: string;
  title: string;
  description: string;
  note: string;
  priority: TaskPriority;
  /** 首次计划日（系列起点）。 */
  startDate: ISODate;
  /** 截止日（与 until 互斥，均为可选的整体边界）。 */
  endDate: ISODate | null;
  endCondition: EndCondition;
  tags: string[];
  events: LifecycleEvent[];
  /** 回收站标记。 */
  deletedAt: string | null;
  /** 归档标记（与回收站语义隔离）。 */
  archivedAt: string | null;
  /** 手动排序序号（越小越靠上）；旧数据缺失时按 0 处理。 */
  sortOrder?: number;
  createdAt: string;
  updatedAt: string;
}
