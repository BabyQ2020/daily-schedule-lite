import { createDatabase, type WorkbenchDatabase } from '@/db/db';

let sequence = 0;

export function uniqueDatabaseName(prefix = 'test-db'): string {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}`;
}

/** 每个测试用独立库名，避免用例之间相互污染。 */
export function createTestDatabase(prefix?: string): WorkbenchDatabase {
  return createDatabase(uniqueDatabaseName(prefix));
}

export function destroyTestDatabase(database: WorkbenchDatabase): Promise<void> {
  return database.delete();
}
