import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { WorkbenchDatabase } from '@/db/db';
import { createLog, deleteLog, getLog, queryLogs, updateLog } from '@/repositories/logs';
import { createProject } from '@/repositories/projects';
import { createTag } from '@/repositories/tags';
import { createTask } from '@/repositories/tasks';
import { createTestDatabase, destroyTestDatabase } from '@/test/db';

let database: WorkbenchDatabase;

beforeEach(() => {
  database = createTestDatabase('logs');
});

afterEach(async () => {
  await destroyTestDatabase(database);
});

describe('工作日志仓储', () => {
  it('创建日志时生成检索文本并记录快照', async () => {
    const project = await createProject({ name: '项目甲' }, database);
    const task = await createTask({ title: '修复登录问题', projectId: project.id }, database);
    const tag = await createTag({ name: '复盘', kind: 'log' }, database);

    const log = await createLog(
      {
        date: '2026-11-16',
        title: '排查登录失败',
        content: '定位到 token 过期未刷新。',
        insight: '先看日志再改代码。',
        problem: '登录后立刻退出',
        solution: '刷新 token 并补充单测',
        projectId: project.id,
        taskId: task.id,
        tags: [tag.id],
      },
      database,
    );

    expect(log.projectNameSnapshot).toBe('项目甲');
    expect(log.taskTitleSnapshot).toBe('修复登录问题');
    expect(log.searchText).toContain('token');
    expect(log.searchText).toContain('复盘');

    const byKeyword = await queryLogs({ keyword: 'token' }, {}, database);
    expect(byKeyword.total).toBe(1);

    const byTagName = await queryLogs({ keyword: '复盘' }, {}, database);
    expect(byTagName.total).toBe(1);
  });

  it('按项目、日期区间与标签筛选', async () => {
    const project = await createProject({ name: '项目乙' }, database);
    const tag = await createTag({ name: '重要', kind: 'log' }, database);
    await createLog({ date: '2026-11-10', title: '旧日志', projectId: project.id }, database);
    await createLog(
      { date: '2026-11-16', title: '新日志', projectId: project.id, tags: [tag.id] },
      database,
    );
    await createLog({ date: '2026-11-16', title: '其他日志' }, database);

    const byProject = await queryLogs({ projectId: project.id }, {}, database);
    expect(byProject.total).toBe(2);

    const byRange = await queryLogs({ dateFrom: '2026-11-15', dateTo: '2026-11-30' }, {}, database);
    expect(byRange.total).toBe(2);

    const byTag = await queryLogs({ tagId: tag.id }, {}, database);
    expect(byTag.items.map((log) => log.title)).toEqual(['新日志']);
  });

  it('日志列表按日期倒序', async () => {
    await createLog({ date: '2026-11-10', title: '早' }, database);
    await createLog({ date: '2026-11-16', title: '晚' }, database);
    const result = await queryLogs({}, {}, database);
    expect(result.items.map((log) => log.title)).toEqual(['晚', '早']);
  });

  it('更新日志会重算检索文本', async () => {
    const log = await createLog({ date: '2026-11-16', title: '原题', content: '旧内容' }, database);
    const updated = await updateLog(log.id, { content: '新内容关于缓存' }, database);
    expect(updated.title).toBe('原题');
    expect(updated.searchText).toContain('缓存');

    const found = await queryLogs({ keyword: '缓存' }, {}, database);
    expect(found.total).toBe(1);
  });

  it('删除日志后不可再读取', async () => {
    const log = await createLog({ date: '2026-11-16', title: '临时' }, database);
    await deleteLog(log.id, database);
    expect(await getLog(log.id, database)).toBeUndefined();
  });
});
