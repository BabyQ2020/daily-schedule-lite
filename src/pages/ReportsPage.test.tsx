import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/db';
import { todayISO } from '@/lib/clock';
import { periodFor } from '@/lib/period';
import { createTask, updateTask } from '@/repositories/tasks';
import { resetAppDatabase, renderWithProviders } from '@/test/app';

import { ReportsPage } from './ReportsPage';

const TODAY = todayISO();
const WEEK = periodFor('week', TODAY, 1);

async function seedDoneTask() {
  const task = await createTask({
    title: '完成离线缓存',
    planDate: WEEK.start,
    status: 'todo',
  });
  await updateTask(task.id, { status: 'done' });
  return task;
}

async function reports() {
  return db.reports.toArray();
}

describe('ReportsPage', () => {
  beforeEach(async () => {
    await resetAppDatabase();
  });

  it('没有报告时提示生成草稿', async () => {
    renderWithProviders(<ReportsPage />);

    expect(await screen.findByText('本期还没有报告')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /生成周报/ })).toBeInTheDocument();
  });

  it('生成草稿后展示统计指标与正文', async () => {
    const user = userEvent.setup();
    await seedDoneTask();

    renderWithProviders(<ReportsPage />);
    await user.click(await screen.findByRole('button', { name: /生成周报/ }));

    expect((await screen.findAllByText(/计划完成率/)).length).toBeGreaterThan(0);
    const body = (await screen.findByLabelText('报告正文')) as HTMLTextAreaElement;
    expect(body.value).toContain('完成离线缓存');
    const stored = await reports();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.version).toBe(1);
    expect(stored[0]?.isSnapshot).toBe(false);
  });

  it('编辑正文并保存后标记为已人工编辑', async () => {
    const user = userEvent.setup();
    await seedDoneTask();

    renderWithProviders(<ReportsPage />);
    await user.click(await screen.findByRole('button', { name: /生成周报/ }));

    const editor = await screen.findByLabelText('报告正文');
    await user.clear(editor);
    await user.type(editor, '这是我自己写的周报总结。');
    await user.click(screen.getByRole('button', { name: /保存修改/ }));

    expect(await screen.findByText('已人工编辑')).toBeInTheDocument();
    await waitFor(async () => {
      const stored = await reports();
      expect(stored[0]?.body).toBe('这是我自己写的周报总结。');
      expect(stored[0]?.isEdited).toBe(true);
    });
  });

  it('保存快照后正文变为只读', async () => {
    const user = userEvent.setup();
    await seedDoneTask();

    renderWithProviders(<ReportsPage />);
    await user.click(await screen.findByRole('button', { name: /生成周报/ }));
    await screen.findByLabelText('报告正文');

    await user.click(screen.getByRole('button', { name: /保存快照/ }));
    await user.click(await screen.findByRole('button', { name: '保存快照' }));

    expect((await screen.findAllByText('快照')).length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: '报告正文' })).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText('报告正文').tagName).toBe('PRE');
  });

  it('重新生成新版本并保留旧版本记录', async () => {
    const user = userEvent.setup();
    await seedDoneTask();

    renderWithProviders(<ReportsPage />);
    await user.click(await screen.findByRole('button', { name: /生成周报/ }));
    const editor = await screen.findByLabelText('报告正文');
    await user.clear(editor);
    await user.type(editor, '手工版本');
    await user.click(screen.getByRole('button', { name: /保存修改/ }));
    await screen.findByText('已人工编辑');

    await user.click(screen.getByRole('button', { name: /重新生成/ }));

    // 版本条目的可访问名以 "v2" 开头（"v2 2026-11-19 18:52"）；正文里也有 /v2/
    //（"草稿 v2"），纯文本正则会同时命中两处，因此改用角色 + 前缀匹配。
    // 版本列表由 liveQuery 异步刷新，jsdom + 并行负载下实测可迟到 5–8s，故放宽等待。
    expect(
      await screen.findByRole('button', { name: /^v2\b/ }, { timeout: 15000 }),
    ).toBeInTheDocument();
    // 并行跑测试时写入可能稍晚落库，用 waitFor 容忍这一点，避免偶发失败
    await waitFor(async () => {
      const stored = await reports();
      expect(stored.map((item) => item.version).sort()).toEqual([1, 2]);
    });
  });
});
