import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { createLog } from '@/repositories/logs';
import { createProject } from '@/repositories/projects';
import { createTask, deleteTasks } from '@/repositories/tasks';
import { useLogQueryStore } from '@/features/logs/filters';
import { todayISO } from '@/lib/clock';
import { resetAppDatabase, renderWithProviders } from '@/test/app';

import { LogsPage } from './LogsPage';

async function seedLog(overrides: { title: string; date?: string; taskId?: string | null }) {
  return createLog({
    date: overrides.date ?? todayISO(),
    title: overrides.title,
    content: `${overrides.title} 的正文内容`,
    insight: '',
    problem: '',
    solution: '',
    projectId: null,
    taskId: overrides.taskId ?? null,
    tags: [],
  });
}

describe('LogsPage', () => {
  beforeEach(async () => {
    useLogQueryStore.getState().reset();
    await resetAppDatabase();
  });

  it('没有日志时展示引导性空态', async () => {
    renderWithProviders(<LogsPage />);
    expect(await screen.findByText('还没有工作日志')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /写第一条日志/ })).toBeInTheDocument();
  });

  it('按日期倒序展示已有日志', async () => {
    const today = todayISO();
    await seedLog({ title: '第一条日志', date: today });
    await seedLog({ title: '第二条日志', date: '2026-01-02' });

    renderWithProviders(<LogsPage />);

    expect(await screen.findByText('第一条日志')).toBeInTheDocument();
    expect(screen.getByText('第二条日志')).toBeInTheDocument();
    expect(screen.getByText('共 2 条日志')).toBeInTheDocument();

    // 标题顺序即列表顺序：今天的排在历史日志之前。
    const titles = screen.getAllByText(/第[一二]条日志/);
    expect(titles[0]).toHaveTextContent('第一条日志');
  });

  it('关键词搜索只保留命中的日志，并高亮片段', async () => {
    const user = userEvent.setup();
    await seedLog({ title: '推进登录模块' });
    await seedLog({ title: '整理周报素材' });

    renderWithProviders(<LogsPage />);
    expect(await screen.findByText('推进登录模块')).toBeInTheDocument();

    await user.type(screen.getByLabelText('搜索日志'), '登录');

    await waitFor(() => {
      expect(screen.queryByText('整理周报素材')).not.toBeInTheDocument();
    });
    // 关键词命中后标题会被拆成多段 <span>/<mark>，因此断言整体文本。
    expect(document.body.textContent).toContain('推进登录模块');
    expect(document.querySelector('mark.search-hit')).not.toBeNull();
  });

  it('新建日志后出现在列表中', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LogsPage />);
    await screen.findByText('还没有工作日志');

    await user.click(screen.getByRole('button', { name: /新建日志/ }));

    const dialog = await screen.findByRole('dialog');
    const titleInput = within(dialog).getByPlaceholderText('一句话概括这条日志');
    await user.type(titleInput, '接入了离线缓存');
    await user.type(
      within(dialog).getByPlaceholderText('今天做了什么、进展如何'),
      '写完了 SW 注册逻辑',
    );

    await user.click(within(dialog).getByRole('button', { name: /保\s*存/ }));

    expect(await screen.findByText('接入了离线缓存')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('还没有工作日志')).not.toBeInTheDocument();
    });
  });

  it('删除日志需要二次确认', async () => {
    const user = userEvent.setup();
    await seedLog({ title: '待删除日志' });

    renderWithProviders(<LogsPage />);
    expect(await screen.findByText('待删除日志')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /删\s*除/ }));
    const popconfirm = await screen.findByText('删除这条日志？');
    expect(popconfirm).toBeInTheDocument();

    const buttons = screen.getAllByRole('button', { name: /删\s*除/ });
    await user.click(buttons[buttons.length - 1] ?? buttons[0]!);

    expect(await screen.findByText('还没有工作日志')).toBeInTheDocument();
  });

  it('关联任务被删除后显示快照标题与提示', async () => {
    const project = await createProject({ name: '离线改造' });
    const task = await createTask({ title: '注册 Service Worker', projectId: project.id });
    await seedLog({ title: '今天注册了 SW', taskId: task.id });
    await deleteTasks([task.id]);

    renderWithProviders(<LogsPage />);

    expect(await screen.findByText(/注册 Service Worker（任务已删除）/)).toBeInTheDocument();
  });
});
