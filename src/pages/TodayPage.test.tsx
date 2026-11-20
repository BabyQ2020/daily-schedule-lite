import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/db';
import { todayISO } from '@/lib/clock';
import { addTaskToPlan } from '@/repositories/plans';
import { createTask } from '@/repositories/tasks';
import { renderWithProviders, resetAppDatabase } from '@/test/app';

import { TodayPage } from './TodayPage';

const TODAY = todayISO();

describe('TodayPage', () => {
  beforeEach(async () => {
    await resetAppDatabase();
  });

  it('展示今日计划，勾选后计入计划完成数并反映到日报草稿', async () => {
    const task = await createTask({ title: '写周报', planDate: TODAY }, db);
    await addTaskToPlan(TODAY, task.id, db);

    const user = userEvent.setup();
    renderWithProviders(<TodayPage />, { route: '/today' });

    expect(await screen.findByText('写周报')).toBeInTheDocument();
    expect(screen.getAllByText(/完成率 0%/).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('checkbox', { name: /写周报/ }));

    await waitFor(() => {
      expect(screen.getAllByText(/完成率 100%/).length).toBeGreaterThan(0);
    });

    const draft = screen.getByLabelText('日报草稿正文');
    await waitFor(() => {
      expect(draft.textContent).toContain('今日计划 1 项，已完成 1 项（计划完成率 100%）');
    });
  });

  it('保存快速日志后出现在今日日志列表', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TodayPage />, { route: '/today' });

    const input = await screen.findByLabelText('快速日志内容');
    await user.type(input, '今天写了工作台');
    await user.click(screen.getByRole('button', { name: '保存日志' }));

    expect((await screen.findAllByText(/今天写了工作台/)).length).toBeGreaterThan(0);

    await waitFor(async () => {
      const logs = await db.workLogs.toArray();
      expect(logs).toHaveLength(1);
      expect(logs[0]?.title).toBe(`${TODAY} 随手记`);
      expect(logs[0]?.content).toBe('今天写了工作台');
    });
  });

  it('逾期与待结转任务分别展示，空列表给出说明', async () => {
    await createTask({ title: '逾期事项', dueDate: '2020-01-01' }, db);
    await createTask({ title: '结转事项', planDate: '2020-01-01' }, db);

    renderWithProviders(<TodayPage />, { route: '/today' });

    expect(await screen.findByText('逾期事项')).toBeInTheDocument();
    expect(screen.getByText('结转事项')).toBeInTheDocument();
    expect(screen.getAllByText('逾期 1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('待结转 1').length).toBeGreaterThan(0);
  });

  it('没有数据时给出空态与指标为零', async () => {
    renderWithProviders(<TodayPage />, { route: '/today' });

    expect(await screen.findByText('今天还没有安排任务')).toBeInTheDocument();
    expect(screen.getByText('没有逾期或待结转任务')).toBeInTheDocument();
    expect(screen.getByText('没有今天到期但未安排的任务。')).toBeInTheDocument();
  });
});
