import type {
  ProgressMode,
  ProjectStatus,
  ReportKind,
  RiskLevel,
  RiskStatus,
  TagKind,
  TaskPriority,
  TaskStatus,
  ThemePreference,
} from './types';

interface Badge {
  readonly label: string;
  /** Ant Design Tag 的颜色关键字（或十六进制）。 */
  readonly color: string;
}

export const TASK_STATUS_LABELS: Record<TaskStatus, Badge> = {
  todo: { label: '待办', color: 'default' },
  doing: { label: '进行中', color: 'processing' },
  done: { label: '已完成', color: 'success' },
  cancelled: { label: '已取消', color: 'default' },
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, Badge> = {
  low: { label: '低', color: 'default' },
  medium: { label: '中', color: 'blue' },
  high: { label: '高', color: 'orange' },
  urgent: { label: '紧急', color: 'red' },
};

/** 优先级排序权重（数值越大越靠前）。 */
export const TASK_PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, Badge> = {
  active: { label: '进行中', color: 'processing' },
  paused: { label: '已暂停', color: 'warning' },
  completed: { label: '已完成', color: 'success' },
  archived: { label: '已归档', color: 'default' },
};

export const PROGRESS_MODE_LABELS: Record<ProgressMode, Badge> = {
  auto: { label: '自动计算', color: 'blue' },
  manual: { label: '手动设定（P1）', color: 'default' },
};

export const REPORT_KIND_LABELS: Record<ReportKind, { label: string; short: string }> = {
  day: { label: '日报', short: '日' },
  week: { label: '周报', short: '周' },
  month: { label: '月报', short: '月' },
};

export const TAG_KIND_LABELS: Record<TagKind, string> = {
  task: '任务标签',
  project: '项目标签',
  log: '日志标签',
  general: '通用标签',
};

export const RISK_LEVEL_LABELS: Record<RiskLevel, Badge> = {
  low: { label: '低', color: 'default' },
  medium: { label: '中', color: 'orange' },
  high: { label: '高', color: 'red' },
};

export const RISK_STATUS_LABELS: Record<RiskStatus, Badge> = {
  open: { label: '未解决', color: 'red' },
  resolved: { label: '已解决', color: 'green' },
};

export const THEME_LABELS: Record<ThemePreference, string> = {
  light: '浅色',
  system: '跟随系统',
};
