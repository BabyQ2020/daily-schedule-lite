import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';

import { V1_STORES } from '@/db/db';

/**
 * S8.1：只读救援导出页的行为测试。
 *
 * 测试直接读取 `public/tools/rescue-export.html` 里的内联脚本并执行，
 * 而不是另写一份等价逻辑——否则「测试通过、页面另写一份」毫无意义。
 */

interface Snapshot {
  counts: Record<string, number>;
  data: Record<string, unknown[]>;
}

interface RescueCore {
  readonly DB_NAME: string;
  readonly TABLES: readonly string[];
  detect(name: string): Promise<{ exists: boolean; version: number | null }>;
  openExistingReadonly(name: string, version: number, timeoutMs?: number): Promise<IDBDatabase>;
  readSnapshot(db: IDBDatabase, tables: string[], timeoutMs?: number): Promise<Snapshot>;
  buildEnvelope(name: string, version: number, snapshot: Snapshot): Record<string, unknown>;
}

const HTML_PATH = join(process.cwd(), 'public', 'tools', 'rescue-export.html');

function loadCore(): { core: RescueCore; source: string } {
  const html = readFileSync(HTML_PATH, 'utf8');
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match || !match[1]) {
    throw new Error('救援页里没有找到内联脚本。');
  }
  const source = match[1];
  const factory = new Function(
    'indexedDB',
    'window',
    'document',
    'URL',
    'Blob',
    'setTimeout',
    'clearTimeout',
    `${source}\nreturn window.__RESCUE_CORE__;`,
  );
  const core = factory(
    indexedDB,
    {},
    undefined,
    URL,
    Blob,
    setTimeout,
    clearTimeout,
  ) as unknown as RescueCore;
  return { core, source };
}

const created: string[] = [];

function nextName(): string {
  const name = `test-rescue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  created.push(name);
  return name;
}

async function seedV1(name: string): Promise<void> {
  const database = new Dexie(name);
  database.version(1).stores(V1_STORES);
  await database.open();
  await database.table('tasks').bulkPut([
    { id: 'task-1', title: '任务一' },
    { id: 'task-2', title: '任务二' },
  ]);
  await database.table('meta').put({ key: 'lastOpenedAt', value: '2026-11-19T00:00:00.000Z' });
  database.close();
}

afterEach(async () => {
  for (const name of created.splice(0)) {
    await Dexie.delete(name);
  }
});

describe('救援页：检测', () => {
  it('库不存在时返回 exists=false，且不会顺手创建空库', async () => {
    const { core } = loadCore();
    const name = nextName();

    const result = await core.detect(name);
    expect(result).toEqual({ exists: false, version: null });

    const list = await indexedDB.databases();
    expect(list.some((item) => item.name === name)).toBe(false);
  });

  it('库存在时返回真实版本号', async () => {
    const { core } = loadCore();
    const name = nextName();
    await seedV1(name);

    const result = await core.detect(name);
    expect(result.exists).toBe(true);
    // 注意：这是 IndexedDB 的原始版本号，不是 Dexie 的逻辑版本号
    // （Dexie 内部会把 version(1) 映射成 IDB version 10），救援页必须按原始版本打开。
    const raw = (await indexedDB.databases()).find((item) => item.name === name);
    expect(result.version).toBe(raw?.version);
    expect(result.version).toBeGreaterThan(0);
  });
});

describe('救援页：只读导出', () => {
  it('按当前版本打开并读回全部行数', async () => {
    const { core } = loadCore();
    const name = nextName();
    await seedV1(name);

    const detected = await core.detect(name);
    // 原始 IDB 版本（Dexie 的 version(1) → IDB 10），救援页按原值打开。
    expect(detected.version).toBeGreaterThan(0);

    const database = await core.openExistingReadonly(name, detected.version ?? 1, 3000);
    expect(database.version).toBe(detected.version);
    const snapshot = await core.readSnapshot(database, ['tasks', 'meta'], 3000);
    database.close();

    expect(snapshot.counts.tasks).toBe(2);
    expect(snapshot.counts.meta).toBe(1);
    expect(snapshot.data.tasks).toHaveLength(2);
    expect(snapshot.data.meta).toHaveLength(1);
  });

  it('读取不会修改数据', async () => {
    const { core } = loadCore();
    const name = nextName();
    await seedV1(name);
    const detected = await core.detect(name);

    const database = await core.openExistingReadonly(name, detected.version ?? 1, 3000);
    await core.readSnapshot(database, ['tasks'], 3000);
    database.close();

    const check = new Dexie(name);
    check.version(1).stores(V1_STORES);
    await check.open();
    expect(await check.table('tasks').count()).toBe(2);
    const first = await check.table('tasks').get('task-1');
    expect(first).toMatchObject({ title: '任务一' });
    check.close();
  });

  it('版本高于库时触发 upgradeneeded，必须中止且不建库', async () => {
    const { core } = loadCore();
    const name = nextName();
    await seedV1(name);
    const detected = await core.detect(name);
    const before = detected.version ?? 1;

    await expect(core.openExistingReadonly(name, before + 1, 3000)).rejects.toThrow(
      /数据库在检测后消失|打开数据库失败/,
    );

    const list = await indexedDB.databases();
    expect(list.find((item) => item.name === name)?.version).toBe(before);
  });

  it('检测后库被删除时不会创建空库', async () => {
    const { core } = loadCore();
    const name = nextName();
    await seedV1(name);
    const detected = await core.detect(name);
    await Dexie.delete(name);

    await expect(core.openExistingReadonly(name, detected.version ?? 1, 3000)).rejects.toThrow(
      /数据库在检测后消失|打开数据库失败/,
    );
    const list = await indexedDB.databases();
    expect(list.some((item) => item.name === name)).toBe(false);
  });
});

describe('救援页：导出内容与安全约束', () => {
  it('信封不是可导入备份格式，且带表计数', async () => {
    const { core } = loadCore();
    const name = nextName();
    await seedV1(name);
    const detected = await core.detect(name);
    const database = await core.openExistingReadonly(name, detected.version ?? 1, 3000);
    const snapshot = await core.readSnapshot(database, ['tasks'], 3000);
    database.close();

    const envelope = core.buildEnvelope(name, detected.version ?? 1, snapshot);
    expect(envelope.format).toBe('daily-schedule-lite/rescue-snapshot');
    expect(envelope.format).not.toBe('daily-schedule-lite/backup');
    expect(envelope.dbVersion).toBe(detected.version);
    expect(envelope.counts).toMatchObject({ tasks: 2 });
    expect(envelope.data).toBeTypeOf('object');
  });

  it('脚本里只出现 readonly 事务，没有任何写操作调用', () => {
    const { core, source } = loadCore();
    expect(core.TABLES).toHaveLength(11);
    expect(core.DB_NAME).toBe('daily-schedule-lite');
    expect(source).toContain("'readonly'");
    expect(source).toContain('onupgradeneeded');
    expect(source).toContain('transaction.abort()');
    // 写 API 一个都不能出现（含注释里的示例）。
    expect(source).not.toMatch(/\.(add|put|delete|clear)\s*\(/);
    expect(source).not.toMatch(/readwrite/);
  });
});
