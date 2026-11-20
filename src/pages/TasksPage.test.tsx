import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { TasksPage } from '@/pages/TasksPage';
import { createTask } from '@/repositories/tasks';
import { useTaskQueryStore } from '@/features/tasks/filters';
import { renderWithProviders, resetAppDatabase } from '@/test/app';

beforeEach(async () => {
  await resetAppDatabase();
  useTaskQueryStore.getState().reset();
});

describe('全部任务页', () => {
  it('空态可直接新建任务，保存后出现在列表', async () => {
    renderWithProviders(<TasksPage />);

    expect(await screen.findByText('还没有任务')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: /新建任务/ })[0]!);
    fireEvent.change(await screen.findByLabelText('标题'), {
      target: { value: '整理周会纪要' },
    });
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));

    const row = (await screen.findByText('整理周会纪要')).closest('tr');
    expect(row).not.toBeNull();
    // 新建后空态消失，说明 liveQuery 已经刷新列表。
    expect(screen.queryByText('还没有任务')).not.toBeInTheDocument();
  });

  it('搜索关键词后只保留匹配任务', async () => {
    await createTask({ title: '撰写季度总结' });
    await createTask({ title: '报销差旅费' });

    renderWithProviders(<TasksPage />);
    expect(await screen.findByText('撰写季度总结')).toBeInTheDocument();
    expect(await screen.findByText('报销差旅费')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('搜索任务'), {
      target: { value: '报销' },
    });

    await waitFor(() => expect(screen.queryByText('撰写季度总结')).not.toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(screen.getByText('报销差旅费')).toBeInTheDocument();
  });

  it('勾选任务后可批量标记完成', async () => {
    await createTask({ title: '批量处理任务' });

    renderWithProviders(<TasksPage />);
    const row = (await screen.findByText('批量处理任务')).closest('tr');
    expect(row).not.toBeNull();

    fireEvent.click(within(row as HTMLElement).getByRole('checkbox'));

    const batchBar = await screen.findByRole('region', { name: '批量操作' });
    fireEvent.click(within(batchBar).getByRole('button', { name: /完\s*成/ }));

    await waitFor(() => {
      const updatedRow = screen.getByText('批量处理任务').closest('tr');
      expect(within(updatedRow as HTMLElement).getByText('已完成')).toBeInTheDocument();
    });
  });
});
