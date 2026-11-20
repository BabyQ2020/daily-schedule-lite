import { SCHEMA_VERSION } from '@/db/db';
import type { BackupData } from '@/domain/types';

/**
 * 数据结构迁移。
 *
 * 约定：MIGRATIONS[n] 负责把 vn 的数据升到 v(n+1)，只做字段级搬运，
 * 不做跨表推导（跨表语义变化应改由应用层重算，避免迁移不可重放）。
 * 首个版本 v1 为基线，暂无迁移步骤。
 */
export type MigrationStep = (data: BackupData) => BackupData;

export const MIGRATIONS: Readonly<Record<number, MigrationStep>> = {};

export class UnsupportedSchemaVersionError extends Error {
  constructor(
    readonly fromVersion: number,
    readonly toVersion: number,
  ) {
    super(`备份数据版本 v${fromVersion} 高于当前应用支持的 v${toVersion}，请升级应用后再导入。`);
    this.name = 'UnsupportedSchemaVersionError';
  }
}

export class MissingMigrationError extends Error {
  constructor(readonly fromVersion: number) {
    super(`缺少 v${fromVersion} → v${fromVersion + 1} 的数据迁移步骤，无法导入该备份。`);
    this.name = 'MissingMigrationError';
  }
}

/** 把备份数据从 fromVersion 逐级迁移到当前版本。 */
export function migrateData(
  data: BackupData,
  fromVersion: number,
  toVersion: number = SCHEMA_VERSION,
): BackupData {
  if (!Number.isInteger(fromVersion) || fromVersion < 1) {
    throw new Error(`备份数据版本非法：${String(fromVersion)}`);
  }
  if (fromVersion > toVersion) {
    throw new UnsupportedSchemaVersionError(fromVersion, toVersion);
  }

  let current = data;
  for (let version = fromVersion; version < toVersion; version += 1) {
    const step = MIGRATIONS[version];
    if (!step) {
      throw new MissingMigrationError(version);
    }
    current = step(current);
  }
  return current;
}

/** 当前是否需要迁移（用于导入前的快速判断与提示文案）。 */
export function needsMigration(fromVersion: number): boolean {
  return fromVersion < SCHEMA_VERSION;
}
