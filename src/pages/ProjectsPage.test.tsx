import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { ProjectsPage } from '@/pages/ProjectsPage';
import { archiveProject, createProject } from '@/repositories/projects';
import { createTask, updateTask } from '@/repositories/tasks';
import { renderWithProviders, resetAppDatabase } from '@/test/app';

beforeEach(async () => {
  await resetAppDatabase();
});

describe('项目管理页', () => {
  it('空态可新建项目，保存后出现在列表', async () => {
    renderWithProviders(<ProjectsPage />);

    expect(await screen.findByText('还没有项目')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: /新建项目/ })[0]!);
    fireEvent.change(await screen.findByLabelText('项目名称'), {
      target: { value: '年度预算体系重构' },
    });
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));

    expect(await screen.findByText('年度预算体系重构')).toBeInTheDocument();
    expect(await screen.findByText('共 1 个项目')).toBeInTheDocument();
  });

  it('进度列按关联任务自动计算', async () => {
    const project = await createProject({ name: '预算重构' });
    await createTask({ title: '梳理现状', projectId: project.id });
    const done = await createTask({ title: '制定新口径', projectId: project.id });
    await updateTask(done.id, { status: 'done' });

    renderWithProviders(<ProjectsPage />);

    expect(await screen.findByText('预算重构')).toBeInTheDocument();
    expect(await screen.findByText('50%')).toBeInTheDocument();
    expect(await screen.findByText(/已完成\s*1\s*\/\s*2/)).toBeInTheDocument();
  });

  it('关键词筛选项目', async () => {
    await createProject({ name: '客户回访' });
    await createProject({ name: '预算重构' });

    renderWithProviders(<ProjectsPage />);
    expect(await screen.findByText('客户回访')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('搜索项目'), {
      target: { value: '客户' },
    });

    await waitFor(() => expect(screen.queryByText('预算重构')).not.toBeInTheDocument());
    expect(screen.getByText('客户回访')).toBeInTheDocument();
  });

  it('归档项目默认隐藏，切到「已归档」可见', async () => {
    await createProject({ name: '客户回访' });
    const archived = await createProject({ name: '旧版官网改版' });
    await archiveProject(archived.id);

    renderWithProviders(<ProjectsPage />);

    expect(await screen.findByText('客户回访')).toBeInTheDocument();
    expect(screen.queryByText('旧版官网改版')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: '已归档' }));

    expect(await screen.findByText('旧版官网改版')).toBeInTheDocument();
    expect(screen.queryByText('客户回访')).not.toBeInTheDocument();
  });
});
