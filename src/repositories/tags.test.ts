import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { WorkbenchDatabase } from '@/db/db';
import { createLog } from '@/repositories/logs';
import { createProject } from '@/repositories/projects';
import { countTagUsage, createTag, deleteTag, listTags, updateTag } from '@/repositories/tags';
import { createTask } from '@/repositories/tasks';
import { createTestDatabase, destroyTestDatabase } from '@/test/db';

let database: WorkbenchDatabase;

beforeEach(() => {
  database = createTestDatabase('tags');
});

afterEach(async () => {
  await destroyTestDatabase(database);
});

describe('标签仓储', () => {
  it('同名同类型标签不允许重复', async () => {
    await createTag({ name: '紧急', kind: 'task' }, database);
    await expect(createTag({ name: '紧急', kind: 'task' }, database)).rejects.toThrow('已存在');
    // 不同类型允许同名
    const logTag = await createTag({ name: '紧急', kind: 'log' }, database);
    expect(logTag.kind).toBe('log');
  });

  it('改名时同样校验唯一性', async () => {
    await createTag({ name: '甲', kind: 'task' }, database);
    const second = await createTag({ name: '乙', kind: 'task' }, database);
    await expect(updateTag(second.id, { name: '甲' }, database)).rejects.toThrow('已存在');
  });

  it('按类型筛选标签并按名称排序', async () => {
    await createTag({ name: 'B', kind: 'task' }, database);
    await createTag({ name: 'A', kind: 'task' }, database);
    await createTag({ name: 'C', kind: 'log' }, database);

    const taskTags = await listTags('task', database);
    expect(taskTags.map((tag) => tag.name)).toEqual(['A', 'B']);
  });

  it('删除标签会从任务、项目、日志中摘除并重算检索文本', async () => {
    const tag = await createTag({ name: '待清理', kind: 'general' }, database);
    const project = await createProject({ name: '项目', tags: [tag.id] }, database);
    const task = await createTask(
      { title: '任务', projectId: project.id, tags: [tag.id] },
      database,
    );
    const log = await createLog({ date: '2026-11-16', title: '日志', tags: [tag.id] }, database);
    expect(await countTagUsage(tag.id, database)).toEqual({ tasks: 1, projects: 1, logs: 1 });

    await deleteTag(tag.id, database);

    expect((await database.tasks.get(task.id))?.tags).toEqual([]);
    expect((await database.projects.get(project.id))?.tags).toEqual([]);
    const updatedLog = await database.workLogs.get(log.id);
    expect(updatedLog?.tags).toEqual([]);
    expect(updatedLog?.searchText).not.toContain('待清理');
    expect(await database.tags.count()).toBe(0);
  });
});
