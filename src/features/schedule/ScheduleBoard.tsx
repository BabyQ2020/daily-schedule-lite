import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { useLiveQuery } from 'dexie-react-hooks';
import { App, Button, DatePicker, Dropdown, Input, Modal, Tag } from 'antd';
import dayjs from 'dayjs';

import { LoadingState } from '@/components/states/LoadingState';
import type { Task, TaskPriority, TaskStatus } from '@/domain/types';
import { addDays, parseISODate, toISODate, type ISODate } from '@/lib/period';
import {
  createTask,
  queryTasks,
  setTaskStatus,
  softDeleteTasks,
  updateTask,
} from '@/services/tasks/service';

/** 优先级只显示 L1/L2/L3，用颜色区分高低；历史数据里的 high 与 urgent 同档。 */
const PRIORITY_META: Record<TaskPriority, { label: string; color: string; bg: string }> = {
  urgent: { label: 'L1', color: '#b42318', bg: '#fee4e2' },
  high: { label: 'L1', color: '#b42318', bg: '#fee4e2' },
  medium: { label: 'L2', color: '#b54708', bg: '#fef0c7' },
  low: { label: 'L3', color: '#1d4ed8', bg: '#e8efff' },
};

/** 状态：待办 / 进行中 / 已完成 / 已取消，各自一色。 */
const STATUS_META: Record<TaskStatus, { label: string; color: string; bg: string }> = {
  todo: { label: '待办', color: '#475569', bg: '#f1f5f9' },
  doing: { label: '进行中', color: '#1d4ed8', bg: '#e8efff' },
  done: { label: '已完成', color: '#15803d', bg: '#e7f6ec' },
  cancelled: { label: '已取消', color: '#94a3b8', bg: '#f8fafc' },
};

const PRIORITY_ORDER: readonly TaskPriority[] = ['urgent', 'medium', 'low'];
const STATUS_ORDER: readonly TaskStatus[] = ['todo', 'doing', 'done', 'cancelled'];

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

/** 初始向上/向下各铺多少天，滚到边缘时再按同样的步长继续铺。 */
const INITIAL_PAST_DAYS = 30;
const INITIAL_FUTURE_DAYS = 60;
const PAGE_DAYS = 30;
const EDGE_THRESHOLD = 120;

function weekdayName(date: ISODate): string {
  return WEEKDAY_NAMES[parseISODate(date).getDay()] ?? '';
}

function addDaysIso(date: ISODate, amount: number): ISODate {
  return toISODate(addDays(parseISODate(date), amount));
}

function daysBetween(from: ISODate, to: ISODate): ISODate[] {
  const days: ISODate[] = [];
  let cursor = from;
  // 最多一年，避免异常输入把内存撑爆。
  for (let index = 0; index < 370 && cursor <= to; index += 1) {
    days.push(cursor);
    cursor = addDaysIso(cursor, 1);
  }
  return days;
}

function Pill({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <span className="task-pill" style={{ color, background: bg }}>
      {label}
    </span>
  );
}

/** 任务提醒级别：已逾期（红） / 今天到期且未完成（黄）。 */
type TaskAlert = 'overdue' | 'due-today' | null;

function taskAlertOf(task: Task, today: ISODate): TaskAlert {
  if (task.dueDate === null) return null;
  if (task.status === 'done' || task.status === 'cancelled') return null;
  if (task.dueDate < today) return 'overdue';
  if (task.dueDate === today) return 'due-today';
  return null;
}

/**
 * 一行任务：标题 / 详情 / 优先级 / 状态 / 截止时间 / 备注。
 * 文本类字段「失焦即保存」；保存失败会提示并保留输入。
 */
function TaskRow({ task, date, today }: { task: Task; date: ISODate; today: ISODate }) {
  const { message, modal } = App.useApp();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [note, setNote] = useState(task.note);
  const [saving, setSaving] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveDate, setMoveDate] = useState<string>(task.planDate ?? date);

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description);
    setNote(task.note);
  }, [task.id, task.title, task.description, task.note]);

  const alert = taskAlertOf(task, today);
  const overdue = alert === 'overdue';
  const dueToday = alert === 'due-today';

  async function save(patch: Parameters<typeof updateTask>[1]) {
    setSaving(true);
    try {
      await updateTask(task.id, patch);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败，请重试。');
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete() {
    modal.confirm({
      title: '移入回收站？',
      content: '可在顶栏「回收站」里恢复。',
      okText: '移入',
      cancelText: '取消',
      onOk: () => softDeleteTasks([task.id]),
    });
  }

  return (
    <article
      className={`task-row${overdue ? ' is-overdue' : ''}${dueToday ? ' is-due-today' : ''}${
        task.status === 'done' ? ' is-done' : ''
      }`}
      aria-label={`任务 ${task.title}`}
      data-task-id={task.id}
    >
      <div className="task-row__cell">
        <Input
          variant="borderless"
          className="task-row__title"
          value={title}
          disabled={saving}
          aria-label="任务标题"
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => {
            const next = title.trim();
            if (next.length === 0) {
              setTitle(task.title);
              return;
            }
            if (next !== task.title) void save({ title: next });
          }}
          onPressEnter={(event) => event.currentTarget.blur()}
        />
      </div>

      <div className="task-row__cell">
        <Input
          variant="borderless"
          className="task-row__text"
          placeholder="—"
          value={description}
          aria-label="任务详情"
          onChange={(event) => setDescription(event.target.value)}
          onBlur={() => {
            if (description !== task.description) void save({ description });
          }}
          onPressEnter={(event) => event.currentTarget.blur()}
        />
      </div>

      <div className="task-row__cell">
        <Dropdown
          trigger={['click']}
          menu={{
            items: PRIORITY_ORDER.map((value) => ({
              key: value,
              label: <Pill {...PRIORITY_META[value]} />,
            })),
            onClick: ({ key }) => void save({ priority: key as TaskPriority }),
          }}
        >
          <button type="button" className="task-pill-btn" aria-label="优先级">
            <Pill {...PRIORITY_META[task.priority]} />
          </button>
        </Dropdown>
      </div>

      <div className="task-row__cell">
        <Dropdown
          trigger={['click']}
          menu={{
            items: STATUS_ORDER.map((value) => ({
              key: value,
              label: <Pill {...STATUS_META[value]} />,
            })),
            onClick: ({ key }) => void setTaskStatus(task.id, key as TaskStatus),
          }}
        >
          <button type="button" className="task-pill-btn" aria-label="状态">
            <Pill {...STATUS_META[task.status]} />
          </button>
        </Dropdown>
      </div>

      <div className="task-row__cell">
        <DatePicker
          size="small"
          variant="borderless"
          className="task-row__date"
          value={task.dueDate ? dayjs(task.dueDate) : null}
          aria-label="截止时间"
          placeholder="—"
          status={overdue ? 'error' : dueToday ? 'warning' : undefined}
          onChange={(value) => void save({ dueDate: value ? value.format('YYYY-MM-DD') : null })}
        />
      </div>

      <div className="task-row__cell">
        <Input
          variant="borderless"
          className="task-row__text"
          placeholder="—"
          value={note}
          aria-label="任务备注"
          onChange={(event) => setNote(event.target.value)}
          onBlur={() => {
            if (note !== task.note) void save({ note });
          }}
          onPressEnter={(event) => event.currentTarget.blur()}
        />
      </div>

      <div className="task-row__cell task-row__actions">
        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              { key: 'move', label: '改到其他日期' },
              { type: 'divider' as const },
              { key: 'delete', label: '移入回收站', danger: true },
            ],
            onClick: ({ key }) => {
              if (key === 'move') {
                setMoveDate(task.planDate ?? date);
                setMoveOpen(true);
                return;
              }
              confirmDelete();
            },
          }}
        >
          <Button type="text" size="small" aria-label="更多操作">
            ⋯
          </Button>
        </Dropdown>
      </div>

      <Modal
        title="改到其他日期"
        open={moveOpen}
        okText="移动"
        cancelText="取消"
        onCancel={() => setMoveOpen(false)}
        onOk={() => {
          setMoveOpen(false);
          if (moveDate !== (task.planDate ?? date)) void save({ planDate: moveDate });
        }}
      >
        <DatePicker
          value={dayjs(moveDate)}
          aria-label="新的计划日期"
          allowClear={false}
          style={{ width: '100%' }}
          onChange={(value) => {
            if (value) setMoveDate(value.format('YYYY-MM-DD'));
          }}
        />
      </Modal>
    </article>
  );
}

/** 每天一组：日期标题 + 任务行 + 原位快速新增（新任务落在当天最下方）。 */
function DayGroup({ date, today, tasks }: { date: ISODate; today: ISODate; tasks: Task[] }) {
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const isToday = date === today;
  const overdueCount = tasks.filter((task) => taskAlertOf(task, today) === 'overdue').length;
  const dueTodayCount = tasks.filter((task) => taskAlertOf(task, today) === 'due-today').length;
  const headState = overdueCount > 0 ? ' is-overdue' : dueTodayCount > 0 ? ' is-due-today' : '';

  async function submit() {
    const title = draft.trim();
    if (title.length === 0) return;
    setAdding(true);
    try {
      await createTask({ title, planDate: date });
      setDraft('');
    } finally {
      setAdding(false);
    }
  }

  return (
    <section
      className={`day-group${isToday ? ' day-group--today' : ''}${
        tasks.length === 0 ? ' day-group--empty' : ''
      }`}
      aria-label={`${date} 的安排`}
      data-date={date}
    >
      <header className={`day-group__head${headState}`}>
        <div className="day-group__head-main">
          <span className="day-group__date">{date.slice(5)}</span>
          <span className="day-group__weekday">{weekdayName(date)}</span>
          {isToday ? (
            <Tag color={overdueCount > 0 ? 'red' : 'blue'} bordered={false}>
              今天
            </Tag>
          ) : null}
          {overdueCount > 0 ? (
            <Tag color="red" bordered={false}>
              逾期 {overdueCount}
            </Tag>
          ) : null}
          {overdueCount === 0 && dueTodayCount > 0 ? (
            <Tag color="gold" bordered={false}>
              今日到期 {dueTodayCount}
            </Tag>
          ) : null}
        </div>
        <span className="day-group__count">{tasks.length} 项</span>
      </header>

      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} date={date} today={today} />
      ))}

      <Input
        size="small"
        variant="borderless"
        className="day-group__add"
        placeholder="+ 添加一件事，回车保存"
        value={draft}
        disabled={adding}
        onChange={(event) => setDraft(event.target.value)}
        onPressEnter={() => void submit()}
      />
    </section>
  );
}

export interface ScheduleBoardProps {
  selectedDate: ISODate;
  today: ISODate;
  weekStart: number;
  onSelectDate: (date: ISODate) => void;
  /** 页面的滚动容器（左栏），用于连续滚动与日期联动。 */
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
}

/**
 * 左栏：连续滚动的日程。
 *
 * - 上方是周导航与周条，点击/跳转会把对应日期滚到顶部；
 * - 向下滚动靠近边缘时继续铺未来日期，向上滚动则继续铺过去日期；
 * - 滚动时把「当前顶部那一天」回报给页面，日历（跳转到日期）与周条随之定位。
 */
export function ScheduleBoard({
  selectedDate,
  today,
  weekStart,
  onSelectDate,
  scrollContainerRef,
}: ScheduleBoardProps) {
  const [range, setRange] = useState(() => ({
    from: addDaysIso(today, -INITIAL_PAST_DAYS),
    to: addDaysIso(today, INITIAL_FUTURE_DAYS),
  }));
  const days = useMemo(() => daysBetween(range.from, range.to), [range]);

  const page = useLiveQuery(
    () =>
      queryTasks(
        { planFrom: range.from, planTo: range.to, status: 'all', archived: 'active' },
        { key: 'createdAt', direction: 'asc' },
        { page: 1, pageSize: 1000 },
      ),
    [range.from, range.to],
    undefined,
  );

  const grouped = useMemo(() => {
    const map = new Map<ISODate, Task[]>();
    for (const task of page?.items ?? []) {
      if (task.planDate === null) continue;
      const list = map.get(task.planDate) ?? [];
      list.push(task);
      map.set(task.planDate, list);
    }
    // 同一天内按创建时间升序，创建时间相同再按 id——保证新建的永远排在当天最下方。
    for (const list of map.values()) {
      list.sort((left, right) => {
        const byCreated = left.createdAt.localeCompare(right.createdAt);
        return byCreated !== 0 ? byCreated : left.id.localeCompare(right.id);
      });
    }
    return map;
  }, [page]);

  const weekDays = useMemo(() => {
    const base = startOfWeekDate(selectedDate, weekStart);
    return Array.from({ length: 7 }, (_, index) => addDaysIso(base, index));
  }, [selectedDate, weekStart]);

  const [calendarOpen, setCalendarOpen] = useState(false);
  const monthCells = useMemo(() => {
    const base = startOfWeekDate(`${selectedDate.slice(0, 7)}-01` as ISODate, weekStart);
    return Array.from({ length: 42 }, (_, index) => addDaysIso(base, index));
  }, [selectedDate, weekStart]);
  const monthLabel = `${selectedDate.slice(0, 4)} 年 ${Number(selectedDate.slice(5, 7))} 月`;
  const weekdayLabels = useMemo(() => weekDays.map((date) => weekdayName(date)), [weekDays]);

  const scrollRequest = useRef<ISODate | null>(null);
  const lastTopDay = useRef<ISODate | null>(null);
  const anchorScrollHeight = useRef<number | null>(null);
  const initialScrollDone = useRef(false);

  const ensureRange = useCallback((date: ISODate) => {
    setRange((current) => {
      if (date >= current.from && date <= current.to) return current;
      return {
        from: date < current.from ? addDaysIso(date, -PAGE_DAYS) : current.from,
        to: date > current.to ? addDaysIso(date, PAGE_DAYS) : current.to,
      };
    });
  }, []);

  const goTo = useCallback(
    (date: ISODate) => {
      ensureRange(date);
      scrollRequest.current = date;
      lastTopDay.current = date;
      onSelectDate(date);
    },
    [ensureRange, onSelectDate],
  );

  // 显式导航（周条/上一周/下一周/跳到日期/回到本周）后，把目标日期滚到顶部。
  useLayoutEffect(() => {
    const target = scrollRequest.current;
    const container = scrollContainerRef?.current;
    if (!target || !container) return;
    const node = container.querySelector<HTMLElement>(`[data-date="${target}"]`);
    if (!node) return;
    scrollRequest.current = null;
    scrollDateIntoView(container, node);
    // calendarOpen 变化会改变吸顶高度，需要重新对齐一次，否则当天会被月历顶到视口外。
  }, [calendarOpen, days, selectedDate, scrollContainerRef]);

  // 首次内容渲染后把今天滚到顶部，保证「最上面那天」= 日历定位的日期。
  useLayoutEffect(() => {
    if (initialScrollDone.current || page === undefined) return;
    const container = scrollContainerRef?.current;
    if (!container) return;
    const node = container.querySelector<HTMLElement>(`[data-date="${today}"]`);
    if (!node) return;
    scrollDateIntoView(container, node);
    lastTopDay.current = today;
    initialScrollDone.current = true;
  }, [days, page, scrollContainerRef, today]);

  const extendEarlier = useCallback(() => {
    const container = scrollContainerRef?.current;
    if (!container) return;
    anchorScrollHeight.current = container.scrollHeight;
    setRange((current) => ({ from: addDaysIso(current.from, -PAGE_DAYS), to: current.to }));
  }, [scrollContainerRef]);

  const extendLater = useCallback(() => {
    setRange((current) => ({ from: current.from, to: addDaysIso(current.to, PAGE_DAYS) }));
  }, []);

  // 向上补日期后，把滚动位置按新增长度下移，视觉上停在原处。
  useLayoutEffect(() => {
    const container = scrollContainerRef?.current;
    if (!container || anchorScrollHeight.current === null) return;
    const delta = container.scrollHeight - anchorScrollHeight.current;
    anchorScrollHeight.current = null;
    if (delta > 0) container.scrollTop += delta;
  }, [days, scrollContainerRef]);

  useEffect(() => {
    const container = scrollContainerRef?.current;
    if (!container) return;

    let frame = 0;
    const handleScroll = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (container.scrollTop < EDGE_THRESHOLD) extendEarlier();
        if (
          container.scrollTop + container.clientHeight >
          container.scrollHeight - EDGE_THRESHOLD
        ) {
          extendLater();
        }

        const top = container.getBoundingClientRect().top + stickyOffset(container);
        const nodes = container.querySelectorAll<HTMLElement>('[data-date]');
        for (const node of nodes) {
          const rect = node.getBoundingClientRect();
          if (rect.bottom > top + 2) {
            const date = node.dataset.date;
            if (date && date !== lastTopDay.current) {
              lastTopDay.current = date;
              onSelectDate(date);
            }
            break;
          }
        }
      });
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      container.removeEventListener('scroll', handleScroll);
    };
  }, [extendEarlier, extendLater, onSelectDate, scrollContainerRef]);

  const isCurrentWeek = weekDays.includes(today);
  const weekLabel = `${weekDays[0] ?? selectedDate} ~ ${(weekDays[6] ?? selectedDate).slice(5)}`;

  return (
    <div className="schedule-board">
      <div className="schedule-board__top">
        <div className="week-nav">
          <Button
            size="small"
            type="text"
            aria-label="上一周"
            title="上一周"
            onClick={() => goTo(addDaysIso(selectedDate, -7))}
          >
            ‹
          </Button>
          <span className="week-nav__label" aria-live="polite">
            {weekLabel}
            {isCurrentWeek ? <span className="week-nav__current">本周</span> : null}
          </span>
          <Button
            size="small"
            type="text"
            aria-label="下一周"
            title="下一周"
            onClick={() => goTo(addDaysIso(selectedDate, 7))}
          >
            ›
          </Button>
          <Button size="small" type="link" disabled={isCurrentWeek} onClick={() => goTo(today)}>
            回到本周
          </Button>
          <Button
            size="small"
            type="link"
            aria-label={calendarOpen ? '收起月历' : '展开月历'}
            onClick={() => {
              // 展开/收起会改变吸顶高度，重排后把当前选中日重新对齐到顶部。
              if (!calendarOpen) scrollRequest.current = selectedDate;
              setCalendarOpen((open) => !open);
            }}
          >
            {calendarOpen ? '收起月历' : '展开月历'}
          </Button>
          <DatePicker
            size="small"
            variant="borderless"
            value={dayjs(selectedDate)}
            aria-label="跳转到日期"
            allowClear={false}
            style={{ width: 128 }}
            onChange={(value) => {
              if (value) goTo(value.format('YYYY-MM-DD'));
            }}
          />
        </div>

        <nav className="week-strip" aria-label="选择日期">
          {weekDays.map((date) => {
            const isToday = date === today;
            const isSelected = date === selectedDate;
            const dateTasks = grouped.get(date) ?? [];
            const count = dateTasks.length;
            const hasOverdue = dateTasks.some((task) => taskAlertOf(task, today) === 'overdue');
            return (
              <button
                key={date}
                type="button"
                className={`week-strip__day${isToday ? ' is-today' : ''}${
                  isSelected ? ' is-selected' : ''
                }${hasOverdue ? ' is-overdue' : ''}`}
                aria-pressed={isSelected}
                aria-label={`${date} ${weekdayName(date)}${isToday ? '（今天）' : ''}${
                  hasOverdue ? '（有逾期）' : ''
                }`}
                onClick={() => goTo(date)}
              >
                <span className="week-strip__weekday">{weekdayName(date)}</span>
                <span className="week-strip__date">{date.slice(8)}</span>
                <span className="week-strip__count">{count === 0 ? '·' : count}</span>
              </button>
            );
          })}
        </nav>

        {calendarOpen ? (
          <div className="month-calendar" role="group" aria-label="月历">
            <div className="month-calendar__head">
              <span className="month-calendar__label">{monthLabel}</span>
              <Button size="small" type="text" onClick={() => setCalendarOpen(false)}>
                收起
              </Button>
            </div>
            <div className="month-calendar__grid">
              {weekdayLabels.map((label) => (
                <span key={label} className="month-calendar__weekday">
                  {label}
                </span>
              ))}
              {monthCells.map((date) => {
                const outside = date.slice(0, 7) !== selectedDate.slice(0, 7);
                const dateTasks = grouped.get(date) ?? [];
                const count = dateTasks.length;
                const hasOverdue = dateTasks.some((task) => taskAlertOf(task, today) === 'overdue');
                const hasDueToday = dateTasks.some(
                  (task) => taskAlertOf(task, today) === 'due-today',
                );
                return (
                  <button
                    key={date}
                    type="button"
                    className={`month-calendar__cell${outside ? ' is-outside' : ''}${
                      date === today ? ' is-today' : ''
                    }${date === selectedDate ? ' is-selected' : ''}${
                      hasOverdue ? ' is-overdue' : ''
                    }${hasDueToday ? ' is-due-today' : ''}`}
                    aria-label={
                      hasOverdue
                        ? `选择 ${date}（有逾期）`
                        : hasDueToday
                          ? `选择 ${date}（今日到期）`
                          : `选择 ${date}`
                    }
                    onClick={() => goTo(date)}
                  >
                    <span>{Number(date.slice(8, 10))}</span>
                    {count > 0 ? <span className="month-calendar__count">{count}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="task-table__head" aria-hidden="true">
          <span>标题</span>
          <span>详情</span>
          <span>优先级</span>
          <span>状态</span>
          <span>截止时间</span>
          <span>备注</span>
          <span />
        </div>
      </div>

      {page === undefined ? (
        <LoadingState tip="正在读取本安排…" />
      ) : (
        <div className="day-list">
          {days.map((date) => (
            <DayGroup key={date} date={date} today={today} tasks={grouped.get(date) ?? []} />
          ))}
        </div>
      )}
    </div>
  );
}

function stickyOffset(container: HTMLElement): number {
  return container.querySelector<HTMLElement>('.schedule-board__top')?.offsetHeight ?? 0;
}

/** 把某一天滚到「吸顶头部下沿」：按渲染后的矩形反复校正，避免布局测量误差。 */
function scrollDateIntoView(container: HTMLElement, node: HTMLElement): void {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offset =
      node.getBoundingClientRect().top -
      container.getBoundingClientRect().top -
      stickyOffset(container);
    if (Math.abs(offset) < 1) return;
    container.scrollTop = Math.max(0, container.scrollTop + offset);
  }
}

function startOfWeekDate(date: ISODate, weekStart: number): ISODate {
  const current = parseISODate(date);
  const weekday = current.getDay() === 0 ? 7 : current.getDay();
  const delta = (weekday - weekStart + 7) % 7;
  return toISODate(addDays(current, -delta));
}

/** 供页面计算周区间：返回 7 个连续日期。 */
export function weekDates(selectedDate: ISODate, weekStart: number): ISODate[] {
  const base = startOfWeekDate(selectedDate, weekStart);
  return Array.from({ length: 7 }, (_, index) => addDaysIso(base, index));
}
