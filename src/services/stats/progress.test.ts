import { describe, expect, it } from 'vitest';

import type { Project, Task } from '@/domain/types';
import {
  computeProjectProgress,
  effectiveProjectPercent,
  isCountedTask,
  isOverdue,
} from '@/services/stats/progress';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task',
    title: '任务',
    description: '',
    projectId: null,
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
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project',
    name: '项目',
    description: '',
    status: 'active',
    startDate: null,
    endDate: null,
    tags: [],
    progressMode: 'auto',
    manualProgress: null,
    milestones: [],
    risks: [],
    archivedAt: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('项目进度统计口径', () => {
  it('按「已完成 ÷ 有效任务」计算并四舍五入到整数', () => {
    const progress = computeProjectProgress([
      makeTask({ id: 'a', status: 'done' }),
      makeTask({ id: 'b', status: 'doing' }),
      makeTask({ id: 'c', status: 'todo' }),
    ]);

    expect(progress.counted).toBe(3);
    expect(progress.done).toBe(1);
    expect(progress.percent).toBe(33);
  });

  it('归档与取消任务不计入分母', () => {
    const progress = computeProjectProgress([
      makeTask({ id: 'a', status: 'done' }),
      makeTask({ id: 'b', status: 'todo' }),
      makeTask({ id: 'c', status: 'todo', archivedAt: '2026-11-02T00:00:00.000Z' }),
      makeTask({ id: 'd', status: 'cancelled' }),
    ]);

    expect(progress.total).toBe(4);
    expect(progress.archived).toBe(1);
    expect(progress.cancelled).toBe(1);
    expect(progress.counted).toBe(2);
    expect(progress.percent).toBe(50);
  });

  it('分母为 0 时进度为 null，而不是 0 或 100', () => {
    const progress = computeProjectProgress([makeTask({ status: 'cancelled' })]);

    expect(progress.counted).toBe(0);
    expect(progress.percent).toBeNull();
  });

  it('空项目进度为 null', () => {
    expect(computeProjectProgress([]).percent).toBeNull();
  });

  it('已归档的完成任务不算完成数', () => {
    const task = makeTask({ status: 'done', archivedAt: '2026-11-03T00:00:00.000Z' });

    expect(isCountedTask(task)).toBe(false);
    expect(computeProjectProgress([task]).done).toBe(0);
  });
});

describe('手动进度覆盖（P1 扩展点）', () => {
  it('自动模式忽略 manualProgress', () => {
    const project = makeProject({ progressMode: 'auto', manualProgress: 90 });

    expect(effectiveProjectPercent(project, computeProjectProgress([]))).toBeNull();
  });

  it('手动模式使用覆盖值并钳制到 0–100', () => {
    const project = makeProject({ progressMode: 'manual', manualProgress: 150 });

    expect(effectiveProjectPercent(project, computeProjectProgress([]))).toBe(100);
  });
});

describe('逾期判定口径', () => {
  const today = '2026-11-16';

  it('截止日期早于今天且未完成才算逾期', () => {
    expect(isOverdue(makeTask({ dueDate: '2026-11-15' }), today)).toBe(true);
    expect(isOverdue(makeTask({ dueDate: today }), today)).toBe(false);
    expect(isOverdue(makeTask({ dueDate: '2026-11-17' }), today)).toBe(false);
  });

  it('已完成、已取消、已归档的任务不算逾期', () => {
    expect(isOverdue(makeTask({ dueDate: '2026-11-01', status: 'done' }), today)).toBe(false);
    expect(isOverdue(makeTask({ dueDate: '2026-11-01', status: 'cancelled' }), today)).toBe(false);
    expect(
      isOverdue(makeTask({ dueDate: '2026-11-01', archivedAt: '2026-11-02T00:00:00.000Z' }), today),
    ).toBe(false);
  });

  it('没有截止日期的任务永远不逾期', () => {
    expect(isOverdue(makeTask({ dueDate: null }), today)).toBe(false);
  });
});
