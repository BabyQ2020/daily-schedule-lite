import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/db';
import { LongTaskDiagnosticsCard } from '@/features/system/LongTaskDiagnosticsCard';
import { createLongTask } from '@/repositories/long-tasks';
import { renderWithProviders, resetAppDatabase } from '@/test/app';

describe('LongTaskDiagnosticsCard', () => {
  beforeEach(async () => {
    await resetAppDatabase();
  });

  it('健康数据扫描后显示没有一致性问题', async () => {
    const user = userEvent.setup();
    await createLongTask(
      { title: '晨间复盘', startDate: '2026-11-02', spec: { kind: 'daily' } },
      { now: '2026-11-02T00:00:00.000Z' },
    );
    renderWithProviders(<LongTaskDiagnosticsCard />);

    await user.click(screen.getByRole('button', { name: /开始扫描/ }));

    expect(await screen.findByText('没有发现一致性问题')).toBeInTheDocument();
    expect(await screen.findByText('健康数量')).toBeInTheDocument();
  });

  it('坏数据扫描后列出问题任务与错误码', async () => {
    const user = userEvent.setup();
    const { task } = await createLongTask(
      { title: '晚间总结', startDate: '2026-11-02', spec: { kind: 'daily' } },
      { now: '2026-11-02T00:00:00.000Z' },
    );
    await db.longTaskRuleVersions.add({
      id: 'ltv-broken-3',
      taskId: task.id,
      versionNo: 3,
      effectiveFrom: '2026-12-01',
      spec: { kind: 'daily' },
      changeNote: null,
      createdAt: '2026-11-02T00:00:00.000Z',
    });

    renderWithProviders(<LongTaskDiagnosticsCard />);
    await user.click(screen.getByRole('button', { name: /开始扫描/ }));

    expect(await screen.findByText('晚间总结')).toBeInTheDocument();
    expect(await screen.findByText(/A11/)).toBeInTheDocument();
  });
});
