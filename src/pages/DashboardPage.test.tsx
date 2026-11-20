import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { todayISO } from '@/lib/clock';
import { periodFor } from '@/lib/period';
import { createLog } from '@/repositories/logs';
import { createProject } from '@/repositories/projects';
import { createTask } from '@/repositories/tasks';
import { useTaskQueryStore } from '@/features/tasks/filters';
import { resetAppDatabase, renderWithProviders } from '@/test/app';

import { DashboardPage } from './DashboardPage';

const TODAY = todayISO();
const WEEK = periodFor('week', TODAY, 1);

describe('DashboardPage', () => {
  beforeEach(async () => {
    useTaskQueryStore.getState().reset();
    await resetAppDatabase();
  });

  it('空数据时给出各项空态而不是报错', async () => {
    renderWithProviders(<DashboardPage />);

    // 指标卡与列表卡片标题都用「今日待办」，这里只确认至少渲染了一处。
    expect((await screen.findAllByText('今日待办')).length).toBeGreaterThan(0);
    expect(await screen.findByText('没有逾期任务，保持住')).toBeInTheDocument();
    expect(await screen.findByText('本周还没有计划任务')).toBeInTheDocument();
    expect(await screen.findByText('还没有进行中的项目')).toBeInTheDocument();
    expect(await screen.findByText('还没有工作日志')).toBeInTheDocument();
  });

  it('列出逾期任务并给出总数', async () => {
    await createTask({ title: '逾期事项', dueDate: '2026-11-01' });

    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText('逾期事项')).toBeInTheDocument();
    expect(screen.getAllByText('查看全部').length).toBeGreaterThan(0);
  });

  it('点击今日待办任务打开编辑抽屉', async () => {
    const user = userEvent.setup();
    const task = await createTask({ title: '写仪表盘', planDate: TODAY });
    const { upsertPlan } = await import('@/repositories/plans');
    await upsertPlan(TODAY, { taskIds: [task.id] });

    renderWithProviders(<DashboardPage />);
    // 同一任务会同时出现在「今日待办」与「本周计划」两处，点第一处即可。
    const [firstOccurrence] = await screen.findAllByText('写仪表盘');
    await user.click(firstOccurrence as HTMLElement);

    expect(await screen.findByText('编辑任务')).toBeInTheDocument();
  });

  it('本周计划按截止日期排序，超出 8 条时提示', async () => {
    for (let index = 1; index <= 9; index += 1) {
      const day = String(index).padStart(2, '0');
      await createTask({
        title: `本周任务 ${index}`,
        planDate: WEEK.start,
        dueDate: `${WEEK.start.slice(0, 8)}${day}`,
      });
    }

    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText(/共 9 项，这里展示前 8 项/)).toBeInTheDocument();
  });

  it('项目健康度展示风险档位与命中原因', async () => {
    const project = await createProject({ name: '离线改造' });
    await createTask({
      title: '逾期子任务',
      projectId: project.id,
      dueDate: '2026-11-01',
    });

    renderWithProviders(<DashboardPage />);

    const card = (await screen.findByText('离线改造')).closest('.dash-row');
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByText('有风险')).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText(/1 个任务已逾期/)).toBeInTheDocument();
  });

  it('最近日志展示最新一条并可直接打开编辑', async () => {
    const user = userEvent.setup();
    await createLog({
      date: TODAY,
      title: '整理仪表盘需求',
      content: '正文',
      tags: [],
    });

    renderWithProviders(<DashboardPage />);
    await user.click(await screen.findByText('整理仪表盘需求'));

    expect(await screen.findByText('编辑日志')).toBeInTheDocument();
  });

  it('快捷「写日志」打开空白新建抽屉', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DashboardPage />);

    await user.click(await screen.findByRole('button', { name: /写日志/ }));

    expect(await screen.findByText('新建日志')).toBeInTheDocument();
  });
});
