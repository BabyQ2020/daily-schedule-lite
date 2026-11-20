import type { WorkbenchDatabase } from '@/db/db';
import { db } from '@/db/db';
import type { AppSettings, MetaRecord, ReportKind, SettingRecord } from '@/domain/types';
import { isWeekStart } from '@/domain/guards';
import type { WeekStart } from '@/lib/period';
import { DEFAULT_WEEK_START } from '@/lib/period';

export const SETTINGS_KEY = 'app-settings';

/** meta 表固定键，避免字符串散落在各处。 */
export const META_KEYS = {
  lastBackupAt: 'lastBackupAt',
  lastImportedAt: 'lastImportedAt',
  lastOpenedAt: 'lastOpenedAt',
  installedAt: 'installedAt',
} as const;

export const DEFAULT_REPORT_TEMPLATES: Record<ReportKind, string> = {
  day: [
    '# {{period}} 日报',
    '',
    '## 概览',
    '{{summary}}',
    '',
    '## 任务',
    '{{tasks}}',
    '',
    '## 工作日志',
    '{{logs}}',
  ].join('\n'),
  week: [
    '# {{period}} 周报',
    '',
    '## 本周概览',
    '{{summary}}',
    '',
    '## 完成任务',
    '{{tasks}}',
    '',
    '## 工作日志',
    '{{logs}}',
    '',
    '## 下周计划',
    '{{next}}',
  ].join('\n'),
  month: [
    '# {{period}} 月报',
    '',
    '## 月度概览',
    '{{summary}}',
    '',
    '## 项目进展',
    '{{projects}}',
    '',
    '## 完成任务',
    '{{tasks}}',
    '',
    '## 工作日志',
    '{{logs}}',
    '',
    '## 下月计划',
    '{{next}}',
  ].join('\n'),
};

export const DEFAULT_SETTINGS: AppSettings = {
  weekStart: DEFAULT_WEEK_START,
  theme: 'system',
  backupReminderDays: 7,
  reportTemplates: DEFAULT_REPORT_TEMPLATES,
};

function normalizeSettings(value: unknown): AppSettings {
  const source = (value ?? {}) as Partial<AppSettings>;
  const templateKeys: ReportKind[] = ['day', 'week', 'month'];
  const templates = { ...DEFAULT_REPORT_TEMPLATES };
  for (const kind of templateKeys) {
    const candidate = source.reportTemplates?.[kind];
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      templates[kind] = candidate;
    }
  }
  const backupReminderDays =
    typeof source.backupReminderDays === 'number' && Number.isFinite(source.backupReminderDays)
      ? Math.min(365, Math.max(0, Math.floor(source.backupReminderDays)))
      : DEFAULT_SETTINGS.backupReminderDays;

  return {
    weekStart:
      typeof source.weekStart === 'number' && isWeekStart(source.weekStart)
        ? source.weekStart
        : DEFAULT_SETTINGS.weekStart,
    theme: source.theme === 'light' ? 'light' : 'system',
    backupReminderDays,
    reportTemplates: templates,
  };
}

export async function loadSettings(database: WorkbenchDatabase = db): Promise<AppSettings> {
  const record = await database.settings.get(SETTINGS_KEY);
  return normalizeSettings(record?.value);
}

export async function saveSettings(
  patch: Partial<AppSettings>,
  database: WorkbenchDatabase = db,
): Promise<AppSettings> {
  const current = await loadSettings(database);
  const next = normalizeSettings({ ...current, ...patch });
  const record: SettingRecord = { key: SETTINGS_KEY, value: next };
  await database.settings.put(record);
  return next;
}

export async function getMeta<T>(
  key: string,
  fallback: T,
  database: WorkbenchDatabase = db,
): Promise<T> {
  const record = await database.meta.get(key);
  return record === undefined ? fallback : (record.value as T);
}

export async function setMeta(
  key: string,
  value: unknown,
  database: WorkbenchDatabase = db,
): Promise<void> {
  const record: MetaRecord = { key, value };
  await database.meta.put(record);
}

export async function getLastBackupAt(database: WorkbenchDatabase = db): Promise<string | null> {
  const value = await getMeta<string | null>(META_KEYS.lastBackupAt, null, database);
  return typeof value === 'string' ? value : null;
}

export async function markBackupCompleted(
  at: string = new Date().toISOString(),
  database: WorkbenchDatabase = db,
): Promise<void> {
  await setMeta(META_KEYS.lastBackupAt, at, database);
}

/** 周起始日变更需要通知全局日期上下文（阶段 D 起接入 store）。 */
export type WeekStartSetter = (weekStart: WeekStart) => void;
