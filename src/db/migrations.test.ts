import { describe, expect, it } from 'vitest';

import { SCHEMA_VERSION } from '@/db/db';
import {
  MissingMigrationError,
  UnsupportedSchemaVersionError,
  migrateData,
  needsMigration,
} from '@/db/migrations';
import type { BackupData } from '@/domain/types';

const emptyData: BackupData = {
  projects: [],
  tags: [],
  tasks: [],
  dailyPlans: [],
  workLogs: [],
  reports: [],
  settings: [],
  meta: [],
};

describe('数据结构迁移守卫', () => {
  it('当前版本无需迁移', () => {
    expect(needsMigration(SCHEMA_VERSION)).toBe(false);
    expect(migrateData(emptyData, SCHEMA_VERSION)).toBe(emptyData);
  });

  it('高于应用支持的版本直接拒绝', () => {
    expect(() => migrateData(emptyData, SCHEMA_VERSION + 1)).toThrow(UnsupportedSchemaVersionError);
  });

  it('缺少迁移步骤时明确报错，不静默放行', () => {
    expect(() => migrateData(emptyData, 1, 2)).toThrow(MissingMigrationError);
  });

  it('非法版本号被拒绝', () => {
    expect(() => migrateData(emptyData, 0)).toThrow('备份数据版本非法');
  });
});
