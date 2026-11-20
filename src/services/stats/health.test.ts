import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { WorkbenchDatabase } from '@/db/db';
import type { Project, Task } from '@/domain/types';
import { addDays, parseISODate, toISODate } from '@/lib/period';
import { archiveProject, createProject } from '@/repositories/projects';
import { createTask } from '@/repositories/tasks';
import { createTestDatabase, destroyTestDatabase } from '@/test/db';

import { assessProjectHealth, HEALTH_THRESHOLDS, loadProjectHealth } from './health';

const TODAY = '2026-11-16';

function makeProject(overrides: Partial<Project> = {}): Project {
  const now = '2026-11-01T00:00:00.000Z';
  return {
    id: 'p1',
    name: '离线改造',
    description: '',
    status: 'active',
    startDate: '2026-10-01',
    endDate: '2026-12-31',
    tags: [],
    progressMode: 'auto',
    manualProgress: null,
    milestones: [],
    risks: [],
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  const now = '2026-11-01T00:00:00.000Z';
  return {
    id: 't1',
    title: '写缓存',
    description: '',
    projectId: 'p1',
    status: 'todo',
    priority: 'medium',
    planDate: null,
    dueDate: null,
    completedAt: null,
    parentId: null,
    tags: [],
    note: '',
    archivedAt: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('assessProjectHealth', () => {
  it('没有逾期与风险时判定为健康并可解释', () => {
    const health = assessProjectHealth(makeProject(), [makeTask()], TODAY);

    expect(health.level).toBe('healthy');
    expect(health.reasons[0]).toContain('没有逾期');
  });

  it('存在逾期任务即为红色，并说明数量', () => {
    const health = assessProjectHealth(
      makeProject(),
      [makeTask({ dueDate: '2026-11-10' }), makeTask({ id: 't2', dueDate: '2026-11-12' })],
      TODAY,
    );

    expect(health.level).toBe('critical');
    expect(health.overdue).toBe(2);
    expect(health.reasons).toContain('2 个任务已逾期');
  });

  it('未解决的高风险为红色，已解决的不算', () => {
    const risk = {
      id: 'r1',
      title: '依赖第三方接口',
      level: 'high' as const,
      status: 'open' as const,
      note: '',
      createdAt: '2026-11-01T00:00:00.000Z',
    };
    const open = assessProjectHealth(makeProject({ risks: [risk] }), [], TODAY);
    expect(open.level).toBe('critical');
    expect(open.reasons).toContain('1 个高风险未解决');

    const resolved = assessProjectHealth(
      makeProject({ risks: [{ ...risk, status: 'resolved' }] }),
      [],
      TODAY,
    );
    expect(resolved.level).toBe('healthy');
  });

  it('低进度且临近到期为黄色', () => {
    const project = makeProject({ endDate: toISODate(addDays(parseISODate(TODAY), 7)) });
    const tasks = [
      makeTask({ status: 'done' }),
      makeTask({ id: 't2' }),
      makeTask({ id: 't3' }),
      makeTask({ id: 't4' }),
    ];

    const health = assessProjectHealth(project, tasks, TODAY);

    expect(health.progress.percent).toBe(25);
    expect(health.level).toBe('warning');
    expect(health.reasons.join('；')).toContain('天内到期');
  });

  it('进度低但离到期还远时保持绿色', () => {
    const project = makeProject({ endDate: toISODate(addDays(parseISODate(TODAY), 60)) });
    const health = assessProjectHealth(project, [makeTask()], TODAY);
    expect(health.level).toBe('healthy');
  });

  it('未解决的中风险为黄色', () => {
    const health = assessProjectHealth(
      makeProject({
        risks: [
          {
            id: 'r1',
            title: '测试覆盖不足',
            level: 'medium',
            status: 'open',
            note: '',
            createdAt: '2026-11-01T00:00:00.000Z',
          },
        ],
      }),
      [],
      TODAY,
    );

    expect(health.level).toBe('warning');
    expect(health.reasons).toContain('1 个中风险未解决');
  });

  it('阈值常量可被设置页以后复用', () => {
    expect(HEALTH_THRESHOLDS.lowProgressPercent).toBe(30);
    expect(HEALTH_THRESHOLDS.endingWithinDays).toBe(14);
  });
});

describe('loadProjectHealth', () => {
  let database: WorkbenchDatabase;

  beforeEach(() => {
    database = createTestDatabase('health');
  });

  afterEach(async () => {
    await destroyTestDatabase(database);
  });

  it('只统计进行中与暂停的项目，风险项目排在最前', async () => {
    const active = await createProject({ name: '进行中项目' }, database);
    await createTask({ title: '逾期任务', projectId: active.id, dueDate: '2026-11-01' }, database);
    await createProject({ name: '已完成项目', status: 'completed' }, database);
    const paused = await createProject({ name: '暂停项目', status: 'paused' }, database);
    const archived = await createProject({ name: '归档项目' }, database);
    await archiveProject(archived.id, database);

    const health = await loadProjectHealth(TODAY, database);

    expect(health.map((item) => item.projectId).sort()).toEqual([active.id, paused.id].sort());
    expect(health[0]?.level).toBe('critical');
  });
});
