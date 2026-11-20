import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { addDays, parseISODate, toISODate } from '@/lib/period';
import { SchedulePage } from '@/pages/SchedulePage';
import { createTask, queryTasks } from '@/services/tasks/service';
import { renderWithProviders, resetAppDatabase } from '@/test/app';

const TODAY = toISODate(new Date());

function shift(date: string, days: number): string {
  return toISODate(addDays(parseISODate(date), days));
}

const NEXT_WEEK_SAME_DAY = shift(TODAY, 7);

beforeEach(async () => {
  await resetAppDatabase();
});

async function renderSchedule() {
  const result = renderWithProviders(<SchedulePage />, { route: '/' });
  // 周条先出现，按天分组要等 IndexedDB 查询返回后才渲染；列表连续铺开，不止 7 天。
  await screen.findByRole('navigation', { name: '选择日期' });
  await waitFor(() => {
    expect(document.querySelectorAll('.day-group').length).toBeGreaterThan(30);
  });
  return result;
}

function todaysGroup(): HTMLElement {
  const group = document.querySelector<HTMLElement>(`[data-date="${TODAY}"]`);
  if (!group) throw new Error(`没有找到 ${TODAY} 的日程分组`);
  return group;
}

describe('日程页', () => {
  it('周条显示 7 天并标出今天', async () => {
    await renderSchedule();
    const strip = screen.getByRole('navigation', { name: '选择日期' });
    const days = within(strip).getAllByRole('button');
    expect(days).toHaveLength(7);
    expect(within(strip).getByRole('button', { name: /（今天）/ })).toBeInTheDocument();
  });

  it('任务按表格列展示标题、详情、优先级、状态、截止时间与备注', async () => {
    await createTask({
      title: 'EA电路设计',
      description: '结构分析，表达式计算',
      note: '较为复杂',
      priority: 'medium',
      dueDate: TODAY,
      planDate: TODAY,
    });
    await renderSchedule();

    for (const label of ['标题', '详情', '优先级', '状态', '截止时间', '备注']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.queryByText('标签')).not.toBeInTheDocument();

    const row = await within(todaysGroup()).findByLabelText('任务 EA电路设计');
    expect(within(row).getByText('L2')).toBeInTheDocument();
    expect(within(row).getByText('待办')).toBeInTheDocument();
    expect(within(row).getByDisplayValue('结构分析，表达式计算')).toBeInTheDocument();
    expect(within(row).getByDisplayValue('较为复杂')).toBeInTheDocument();
    expect(within(row).getByDisplayValue(TODAY)).toBeInTheDocument();
  });

  it('日程列表连续铺开，不止一周', async () => {
    await renderSchedule();
    expect(document.querySelectorAll('.day-group').length).toBeGreaterThan(30);
  });

  it('逾期任务把当天日期与任务行标成红色', async () => {
    await createTask({ title: '逾期的事', planDate: TODAY, dueDate: shift(TODAY, -2) });
    await renderSchedule();

    const row = await within(todaysGroup()).findByLabelText('任务 逾期的事');
    expect(row.className).toContain('is-overdue');

    const strip = screen.getByRole('navigation', { name: '选择日期' });
    const chip = within(strip).getByRole('button', { name: new RegExp(`^${TODAY}`) });
    expect(chip.className).toContain('is-overdue');
    expect(chip.className).toContain('is-selected');
    expect(todaysGroup().querySelector('.day-group__head')?.className).toContain('is-overdue');
  });

  it('今天到期且未完成的任务标成黄色', async () => {
    await createTask({ title: '今天到期的事', planDate: TODAY, dueDate: TODAY });
    await renderSchedule();

    const row = await within(todaysGroup()).findByLabelText('任务 今天到期的事');
    expect(row.className).toContain('is-due-today');
    expect(row.className).not.toContain('is-overdue');
  });

  it('已完成的任务即使今天到期也不高亮', async () => {
    await createTask({
      title: '已经做完的事',
      planDate: TODAY,
      dueDate: TODAY,
      status: 'done',
    });
    await renderSchedule();

    const row = await within(todaysGroup()).findByLabelText('任务 已经做完的事');
    expect(row.className).not.toContain('is-due-today');
    expect(row.className).not.toContain('is-overdue');
  });

  it('新任务落在当天日程的最下方', async () => {
    await createTask({ title: '先建的任务', planDate: TODAY });
    // 真实使用中两次新建至少间隔一帧；同毫秒创建只能靠 id 兜底，没有先后语义。
    await new Promise((resolve) => setTimeout(resolve, 10));
    await createTask({ title: '后建的任务', planDate: TODAY });
    await renderSchedule();

    const rows = [...todaysGroup().querySelectorAll('.task-row')];
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
      '任务 先建的任务',
      '任务 后建的任务',
    ]);
  });

  it('在当天的分组里回车即可新增一件事', async () => {
    const user = userEvent.setup();
    await renderSchedule();

    const group = todaysGroup();
    const input = within(group).getByPlaceholderText('+ 添加一件事，回车保存');
    await user.type(input, '写晨间计划{Enter}');

    expect(await within(todaysGroup()).findByLabelText('任务 写晨间计划')).toBeInTheDocument();
    const stored = await queryTasks(
      {},
      { key: 'createdAt', direction: 'desc' },
      { page: 1, pageSize: 50 },
    );
    expect(
      stored.items.some((task) => task.title === '写晨间计划' && task.planDate === TODAY),
    ).toBe(true);
  });

  it('原位改标题后失焦即保存', async () => {
    const user = userEvent.setup();
    await renderSchedule();
    const group = todaysGroup();
    await user.type(
      within(group).getByPlaceholderText('+ 添加一件事，回车保存'),
      '原来的标题{Enter}',
    );

    const card = await within(todaysGroup()).findByLabelText('任务 原来的标题');
    const titleInput = within(card).getByLabelText('任务标题');
    await user.clear(titleInput);
    await user.type(titleInput, '改过的标题');
    fireEvent.blur(titleInput);

    // 保存是异步的：卡片标题来自数据库刷新后的结果，等它变过来再查库。
    expect(await screen.findByLabelText('任务 改过的标题')).toBeInTheDocument();
    const stored = await queryTasks(
      {},
      { key: 'createdAt', direction: 'desc' },
      { page: 1, pageSize: 50 },
    );
    expect(stored.items.some((task) => task.title === '改过的标题')).toBe(true);
  });

  it('可以新建一条长期任务并显示规则文案', async () => {
    const user = userEvent.setup();
    await renderSchedule();

    await user.click(screen.getByRole('button', { name: '新建长期任务' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('长期任务标题'), '每周整理纪要');
    await user.click(within(dialog).getByRole('button', { name: /保\s*存/ }));

    expect(await screen.findByLabelText('长期任务 每周整理纪要')).toBeInTheDocument();
    expect(screen.getAllByText(/每天/).length).toBeGreaterThan(0);
  });

  it('点击未来日期可以只改这一次', async () => {
    const user = userEvent.setup();
    await renderSchedule();

    await user.click(screen.getByRole('button', { name: '新建长期任务' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('长期任务标题'), '每日站会');
    await user.click(within(dialog).getByRole('button', { name: /保\s*存/ }));

    const card = await screen.findByLabelText('长期任务 每日站会');
    const chips = await within(card).findAllByRole('button', { name: /^\d{2}-\d{2}$/ });
    expect(chips.length).toBeGreaterThan(0);
    await user.click(chips[0] as HTMLElement);

    expect(await screen.findByLabelText('这一次的标题')).toBeInTheDocument();
  });

  it('长期任务可以二次编辑标题', async () => {
    const user = userEvent.setup();
    await renderSchedule();

    await user.click(screen.getByRole('button', { name: '新建长期任务' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('长期任务标题'), '每日站会');
    await user.click(within(dialog).getByRole('button', { name: /^保\s*存$/ }));

    const card = await screen.findByLabelText('长期任务 每日站会');
    await user.click(within(card).getByRole('button', { name: '更多操作' }));
    await user.click(await screen.findByText('编辑信息'));

    const editDialog = await screen.findByRole('dialog');
    const titleInput = within(editDialog).getByLabelText('长期任务标题');
    await user.clear(titleInput);
    await user.type(titleInput, '每日站会（改）');
    await user.click(within(editDialog).getByRole('button', { name: /^保\s*存$/ }));

    expect(await screen.findByLabelText('长期任务 每日站会（改）')).toBeInTheDocument();
  });

  it('连续滚动即可看到下周任务，翻周后日历定位到下一周', async () => {
    const user = userEvent.setup();
    await createTask({ title: '下周的评审', planDate: NEXT_WEEK_SAME_DAY });
    await renderSchedule();

    // 列表连续铺开，未来的任务无需切周就已经在 DOM 里。
    expect(await screen.findByLabelText('任务 下周的评审')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '下一周' }));

    const strip = screen.getByRole('navigation', { name: '选择日期' });
    expect(
      within(strip).getByRole('button', { name: new RegExp(`^${NEXT_WEEK_SAME_DAY}`) }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('跳转到日期')).toHaveValue(NEXT_WEEK_SAME_DAY);
  });

  it('可以逐周前后翻，并用回到本周回到今天所在周', async () => {
    const user = userEvent.setup();
    await renderSchedule();

    await user.click(screen.getByRole('button', { name: '下一周' }));
    await user.click(screen.getByRole('button', { name: '下一周' }));
    expect(screen.getByRole('button', { name: '回到本周' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: '上一周' }));
    await user.click(screen.getByRole('button', { name: '上一周' }));

    expect(screen.getByRole('button', { name: '回到本周' })).toBeDisabled();
    const strip = screen.getByRole('navigation', { name: '选择日期' });
    expect(within(strip).getByRole('button', { name: /（今天）/ })).toBeInTheDocument();
  });

  it('可以按日期直接跳到下个月', async () => {
    const user = userEvent.setup();
    const nextMonth = shift(TODAY, 40);
    await renderSchedule();

    const picker = screen.getByLabelText('跳转到日期');
    await user.click(picker);
    await user.clear(picker);
    await user.type(picker, nextMonth);
    await user.keyboard('{Enter}');

    await waitFor(() => {
      const strip = screen.getByRole('navigation', { name: '选择日期' });
      expect(
        within(strip).getByRole('button', { name: new RegExp(`^${nextMonth}`) }),
      ).toBeInTheDocument();
    });
  });

  it('展开月历后显示当月全部日期，点击可定位到该日', async () => {
    const user = userEvent.setup();
    await renderSchedule();

    await user.click(screen.getByRole('button', { name: '展开月历' }));
    const grid = await screen.findByRole('group', { name: '月历' });
    const cells = within(grid).getAllByRole('button', { name: /^选择 \d{4}-\d{2}-\d{2}$/ });
    expect(cells).toHaveLength(42);

    const target = shift(TODAY, 10);
    await user.click(within(grid).getByRole('button', { name: `选择 ${target}` }));

    await waitFor(() => {
      expect(screen.getByLabelText('跳转到日期')).toHaveValue(target);
    });
    await user.click(screen.getByRole('button', { name: '收起月历' }));
    expect(screen.queryByRole('group', { name: '月历' })).not.toBeInTheDocument();
  });

  it('展开月历后，逾期与今日到期的日期同样高亮', async () => {
    const user = userEvent.setup();
    await createTask({ title: '逾期的日子', planDate: TODAY, dueDate: shift(TODAY, -2) });
    await createTask({ title: '今天到期的日子', planDate: TODAY, dueDate: TODAY });
    await renderSchedule();

    await user.click(screen.getByRole('button', { name: '展开月历' }));
    const grid = await screen.findByRole('group', { name: '月历' });
    const cell = within(grid).getByRole('button', { name: new RegExp(`^选择 ${TODAY}`) });

    expect(cell.className).toContain('is-overdue');
    expect(cell.className).toContain('is-due-today');
  });

  it('长期任务详情是多行输入框，能同时看到多行', async () => {
    const user = userEvent.setup();
    await renderSchedule();

    await user.click(screen.getByRole('button', { name: '新建长期任务' }));
    const dialog = await screen.findByRole('dialog');
    const field = within(dialog).getByLabelText('长期任务详情');

    expect(field.tagName).toBe('TEXTAREA');
    expect((field as HTMLTextAreaElement).rows).toBe(4);
  });

  it('长期任务卡片显示任务详情与备注', async () => {
    const user = userEvent.setup();
    await renderSchedule();

    await user.click(screen.getByRole('button', { name: '新建长期任务' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('长期任务标题'), '周会准备');
    await user.type(within(dialog).getByLabelText('长期任务详情'), '整理本周进度与风险');
    await user.type(within(dialog).getByLabelText('长期任务备注'), '提前一天收集材料');
    await user.click(within(dialog).getByRole('button', { name: /^保\s*存$/ }));

    const card = await screen.findByLabelText('长期任务 周会准备');
    expect(within(card).getByText('整理本周进度与风险')).toBeInTheDocument();
    expect(within(card).getByText('备注：提前一天收集材料')).toBeInTheDocument();
  });

  it('长期任务可以上移下移调整顺序', async () => {
    const user = userEvent.setup();
    await renderSchedule();

    const create = async (title: string) => {
      await user.click(screen.getByRole('button', { name: '新建长期任务' }));
      const dialog = await screen.findByRole('dialog');
      await user.type(within(dialog).getByLabelText('长期任务标题'), title);
      await user.click(within(dialog).getByRole('button', { name: /^保\s*存$/ }));
      await screen.findByLabelText(`长期任务 ${title}`);
    };
    await create('第一条长期任务');
    await create('第二条长期任务');

    const cardOrder = () =>
      [...document.querySelectorAll('.long-card')].map((node) => node.getAttribute('aria-label'));
    expect(cardOrder()).toEqual(['长期任务 第一条长期任务', '长期任务 第二条长期任务']);

    const secondCard = screen.getByLabelText('长期任务 第二条长期任务');
    await user.click(within(secondCard).getByRole('button', { name: '上移' }));

    await waitFor(() => {
      expect(cardOrder()).toEqual(['长期任务 第二条长期任务', '长期任务 第一条长期任务']);
    });
  });
});
