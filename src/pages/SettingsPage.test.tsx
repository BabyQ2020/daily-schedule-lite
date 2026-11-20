import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/db';
import { createTag, listTags } from '@/repositories/tags';
import { createTask } from '@/repositories/tasks';
import { loadSettings } from '@/services/settings';
import { resetAppDatabase, renderWithProviders } from '@/test/app';

import { SettingsPage } from './SettingsPage';

describe('SettingsPage', () => {
  beforeEach(async () => {
    await resetAppDatabase();
  });

  it('按分区展示备份、偏好、导出、标签、模板与存储', async () => {
    renderWithProviders(<SettingsPage />, { route: '/settings' });

    expect(await screen.findByText('完整备份与恢复')).toBeInTheDocument();
    expect(await screen.findByText('偏好设置')).toBeInTheDocument();
    expect(await screen.findByText('导出与迁移')).toBeInTheDocument();
    expect(await screen.findByText('标签管理')).toBeInTheDocument();
    expect(await screen.findByText('报告模板')).toBeInTheDocument();
    expect(await screen.findByText('长期任务一致性诊断')).toBeInTheDocument();
    expect(await screen.findByText('存储与数据')).toBeInTheDocument();
  });

  it('修改每周起始日后立即落库', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />, { route: '/settings' });

    const select = await screen.findByRole('combobox', { name: '每周起始日' });
    await user.click(select);
    await user.click(await screen.findByTitle('周日'));

    await waitFor(async () => {
      const settings = await loadSettings();
      expect(settings.weekStart).toBe(7);
    });
  });

  it('新建标签后出现在表格里', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />, { route: '/settings' });

    await user.click(await screen.findByRole('button', { name: /新建标签/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('名称'), '离线');
    await user.click(within(dialog).getByRole('button', { name: /^保\s*存$/ }));

    expect(await screen.findByText('离线')).toBeInTheDocument();
    const tags = await listTags('all');
    expect(tags.map((tag) => tag.name)).toContain('离线');
  });

  it('删除标签需要二次确认，并从记录中摘除', async () => {
    const user = userEvent.setup();
    const tag = await createTag({ name: '临时标签', kind: 'task' });
    const task = await createTask({ title: '带标签的任务', tags: [tag.id] });
    renderWithProviders(<SettingsPage />, { route: '/settings' });

    const row = (await screen.findByText('临时标签')).closest('tr');
    expect(row).not.toBeNull();
    await user.click(within(row as HTMLElement).getByRole('button', { name: /删\s*除/ }));
    expect(await screen.findByText('删除标签')).toBeInTheDocument();
    const popover = document.querySelector('.ant-popover');
    expect(popover).not.toBeNull();
    await user.click(within(popover as HTMLElement).getByRole('button', { name: /删\s*除/ }));

    await waitFor(async () => {
      expect(await db.tags.count()).toBe(0);
      const stored = await db.tasks.get(task.id);
      expect(stored?.tags).toEqual([]);
    });
  });

  it('保存报告模板后，之后生成的草稿才会使用新模板', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />, { route: '/settings' });

    const textarea = await screen.findByLabelText('报告模板');
    await user.clear(textarea);
    await user.type(textarea, '# 自定义周报{enter}{enter}{{summary}}');
    await user.click(screen.getByRole('button', { name: '保存模板' }));

    await waitFor(async () => {
      const settings = await loadSettings();
      expect(settings.reportTemplates.week).toContain('# 自定义周报');
    });
  });

  it('清空数据必须输入确认短语，且确认后数据库归零', async () => {
    const user = userEvent.setup();
    await createTask({ title: '将被清空的任务' });
    renderWithProviders(<SettingsPage />, { route: '/settings' });

    await user.click(await screen.findByRole('button', { name: '清空全部数据' }));
    const dialog = await screen.findByRole('dialog');
    const confirmButton = within(dialog).getByRole('button', { name: '确认清空' });
    expect(confirmButton).toBeDisabled();

    await user.type(within(dialog).getByLabelText('清空确认文本'), '清空全部数据');
    expect(confirmButton).toBeEnabled();
    await user.click(confirmButton);

    await waitFor(async () => {
      expect(await db.tasks.count()).toBe(0);
    });
  });

  it('导入非法备份时报错且不写入', async () => {
    const user = userEvent.setup();
    await createTag({ name: '保留的标签', kind: 'general' });
    const { container } = renderWithProviders(<SettingsPage />, { route: '/settings' });

    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    const file = new File(['{"hello":"world"}'], 'bad.json', { type: 'application/json' });
    await user.upload(input as HTMLInputElement, file);

    expect((await screen.findAllByText('备份文件无法导入')).length).toBeGreaterThan(0);
    // 校验失败时不应清空既有数据。
    expect(await listTags('all')).toHaveLength(1);
  });
});
