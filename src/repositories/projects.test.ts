import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { WorkbenchDatabase } from '@/db/db';
import {
  addMilestone,
  addRisk,
  countProjectTasks,
  createProject,
  deleteProject,
  getProject,
  queryProjects,
  removeMilestone,
  updateMilestone,
  updateProject,
  updateRisk,
} from '@/repositories/projects';
import { createTask, deleteTasks } from '@/repositories/tasks';
import { createTestDatabase, destroyTestDatabase } from '@/test/db';

let database: WorkbenchDatabase;

beforeEach(() => {
  database = createTestDatabase('projects');
});

afterEach(async () => {
  await destroyTestDatabase(database);
});

describe('项目仓储', () => {
  it('创建项目并校验名称', async () => {
    const project = await createProject({ name: '  项目一  ' }, database);
    expect(project.name).toBe('项目一');
    expect(project.status).toBe('active');
    expect(project.progressMode).toBe('auto');
    expect(project.manualProgress).toBeNull();

    await expect(createProject({ name: ' ' }, database)).rejects.toThrow('项目名称不能为空');
  });

  it('按状态筛选项目', async () => {
    await createProject({ name: '进行中' }, database);
    await createProject({ name: '已完成', status: 'completed' }, database);

    const active = await queryProjects({ status: 'active' }, database);
    expect(active.map((project) => project.name)).toEqual(['进行中']);

    const all = await queryProjects({}, database);
    expect(all).toHaveLength(2);
  });

  it('有关联任务时禁止删除项目', async () => {
    const project = await createProject({ name: '有任务的项目' }, database);
    const task = await createTask({ title: '任务', projectId: project.id }, database);
    expect(await countProjectTasks(project.id, database)).toBe(1);

    await expect(deleteProject(project.id, database)).rejects.toThrow('无法直接删除');

    await deleteTasks([task.id], database);
    await deleteProject(project.id, database);
    expect(await getProject(project.id, database)).toBeUndefined();
  });

  it('里程碑可新增、勾选完成与删除', async () => {
    const project = await createProject({ name: '里程碑项目' }, database);
    const withMilestone = await addMilestone(
      project.id,
      { title: '一期上线', dueDate: '2026-12-01' },
      database,
    );
    expect(withMilestone.milestones).toHaveLength(1);
    const milestone = withMilestone.milestones[0]!;
    expect(milestone.done).toBe(false);

    const done = await updateMilestone(project.id, milestone.id, { done: true }, database);
    expect(done.milestones[0]?.done).toBe(true);
    expect(done.milestones[0]?.doneAt).not.toBeNull();

    const cleared = await updateMilestone(project.id, milestone.id, { done: false }, database);
    expect(cleared.milestones[0]?.doneAt).toBeNull();

    const removed = await removeMilestone(project.id, milestone.id, database);
    expect(removed.milestones).toHaveLength(0);
  });

  it('风险记录可新增、改状态与删除', async () => {
    const project = await createProject({ name: '风险项目' }, database);
    const withRisk = await addRisk(project.id, { title: '依赖未就绪', level: 'high' }, database);
    const risk = withRisk.risks[0]!;
    expect(risk.status).toBe('open');

    const resolved = await updateRisk(
      project.id,
      risk.id,
      { status: 'resolved', note: '已协调' },
      database,
    );
    expect(resolved.risks[0]?.status).toBe('resolved');
    expect(resolved.risks[0]?.note).toBe('已协调');
  });

  it('更新项目时校验存在性', async () => {
    await expect(updateProject('missing', { name: 'x' }, database)).rejects.toThrow('不存在');
  });
});
