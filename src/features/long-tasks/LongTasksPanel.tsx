import { useCallback, useEffect, useMemo, useState } from 'react';

import { useLiveQuery } from 'dexie-react-hooks';
import {
  App,
  Button,
  Checkbox,
  DatePicker,
  Dropdown,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Space,
  Tag,
  Tooltip,
} from 'antd';
import dayjs from 'dayjs';

import { LoadingState } from '@/components/states/LoadingState';
import type { EndCondition, LifecycleEvent, RecurrenceSpec } from '@/domain/long-task';
import type { TaskPriority } from '@/domain/types';
import { addDays, parseISODate, toISODate, type ISODate } from '@/lib/period';
import {
  addLifecycleEvent,
  createLongTask,
  listOccurrences,
  move,
  queryLongTaskAggregates,
  reopenWithRuleVersion,
  replaceRule,
  setArchived,
  softDelete,
  updateLongTaskInfoById,
  writeException,
  type LongTaskAggregate,
  type ResolvedOccurrence,
} from '@/services/long-tasks/service';

const PRIORITY_OPTIONS: readonly { value: TaskPriority; label: string }[] = [
  { value: 'urgent', label: 'L1 高' },
  { value: 'medium', label: 'L2 中' },
  { value: 'low', label: 'L3 低' },
];

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

type LongTaskStatus = 'active' | 'paused' | 'ended';

const STATUS_TAG: Record<LongTaskStatus, { color: string; label: string }> = {
  active: { color: 'green', label: '启用中' },
  paused: { color: 'gold', label: '已暂停' },
  ended: { color: 'default', label: '已结束' },
};

/** 由生命周期事件推导当前状态（created 不算转换）。 */
export function statusOf(events: readonly LifecycleEvent[]): LongTaskStatus {
  let status: LongTaskStatus = 'active';
  for (const event of events) {
    if (event.type === 'paused') status = 'paused';
    else if (event.type === 'resumed' || event.type === 'reopened') status = 'active';
    else if (event.type === 'ended') status = 'ended';
  }
  return status;
}

/** 规则的人话描述。 */
export function describeSpec(spec: RecurrenceSpec): string {
  if (spec.kind === 'daily') return '每天';
  if (spec.kind === 'weekly') {
    const names = [...spec.weekdays]
      .sort((left, right) => left - right)
      .map((day) => WEEKDAY_LABELS[day - 1] ?? '')
      .filter(Boolean);
    return `每周 ${names.join('、')}`;
  }
  if (spec.monthDays.includes(-1)) return '每月最后一天';
  return `每月 ${spec.monthDays.join('、')} 日`;
}

export function describeEnd(end: EndCondition): string {
  if (end.type === 'never') return '不设结束';
  if (end.type === 'until') return `到 ${end.until} 为止`;
  return `共 ${end.count} 次`;
}

function plusDays(date: ISODate, amount: number): ISODate {
  return toISODate(addDays(parseISODate(date), amount));
}

/** 未来 5 次：由服务层展开，页面只负责渲染。 */
function useUpcoming(taskId: string, refreshKey: string, today: ISODate) {
  const [items, setItems] = useState<ResolvedOccurrence[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    listOccurrences(taskId, today, plusDays(today, 180))
      .then((result) => {
        if (!cancelled) setItems(result.slice(0, 5));
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : '读取未来安排失败。');
          setItems([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, refreshKey, today]);

  return { items, error };
}

interface SpecFieldsProps {
  kind: 'daily' | 'weekly' | 'monthly';
  weekdays: number[];
  monthDay: number;
  lastDayOfMonth: boolean;
  onChange: (patch: {
    kind?: 'daily' | 'weekly' | 'monthly';
    weekdays?: number[];
    monthDay?: number;
    lastDayOfMonth?: boolean;
  }) => void;
}

function SpecFields({ kind, weekdays, monthDay, lastDayOfMonth, onChange }: SpecFieldsProps) {
  return (
    <div className="spec-fields">
      <Segmented
        block
        value={kind}
        options={[
          { value: 'daily', label: '每天' },
          { value: 'weekly', label: '每周' },
          { value: 'monthly', label: '每月' },
        ]}
        onChange={(value) => onChange({ kind: value as SpecFieldsProps['kind'] })}
        aria-label="重复方式"
      />
      {kind === 'weekly' ? (
        <Checkbox.Group
          value={weekdays}
          onChange={(values) => onChange({ weekdays: values.map((value) => Number(value)) })}
          aria-label="选择星期"
          className="spec-fields__weekdays"
          options={WEEKDAY_LABELS.map((label, index) => ({ label, value: index + 1 }))}
        />
      ) : null}
      {kind === 'monthly' ? (
        <Space wrap>
          <Select
            value={lastDayOfMonth ? -1 : monthDay}
            style={{ width: 132 }}
            aria-label="每月日期"
            options={[
              ...Array.from({ length: 31 }, (_, index) => ({
                value: index + 1,
                label: `${index + 1} 日`,
              })),
              { value: -1, label: '最后一天' },
            ]}
            onChange={(value) => onChange({ monthDay: value, lastDayOfMonth: value === -1 })}
          />
          <span className="list-hint">2 月等月份会自动收敛到月末</span>
        </Space>
      ) : null}
    </div>
  );
}

function buildSpec(
  kind: 'daily' | 'weekly' | 'monthly',
  weekdays: number[],
  monthDay: number,
): RecurrenceSpec {
  if (kind === 'daily') return { kind: 'daily' };
  if (kind === 'weekly') return { kind: 'weekly', weekdays: [...weekdays].sort((a, b) => a - b) };
  return { kind: 'monthly', monthDays: [monthDay] };
}

/** 新建长期任务 / 调整规则共用的表单。 */
interface LongTaskFormProps {
  open: boolean;
  mode: 'create' | 'rule';
  initial?: {
    title: string;
    description?: string;
    note?: string;
    priority: TaskPriority;
    spec: RecurrenceSpec;
    startDate: ISODate;
    endCondition: EndCondition;
  };
  today: ISODate;
  onClose: () => void;
  onSubmit: (values: {
    title: string;
    description: string;
    note: string;
    priority: TaskPriority;
    startDate: ISODate;
    spec: RecurrenceSpec;
    endCondition: EndCondition;
    effectiveFrom?: ISODate;
  }) => Promise<void>;
}

function LongTaskFormModal({ open, mode, initial, today, onClose, onSubmit }: LongTaskFormProps) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [priority, setPriority] = useState<TaskPriority>(initial?.priority ?? 'medium');
  const [startDate, setStartDate] = useState<ISODate>(initial?.startDate ?? today);
  const [kind, setKind] = useState<'daily' | 'weekly' | 'monthly'>(initial?.spec.kind ?? 'daily');
  const [weekdays, setWeekdays] = useState<number[]>(
    initial?.spec.kind === 'weekly' ? [...initial.spec.weekdays] : [1, 3, 5],
  );
  const [monthDay, setMonthDay] = useState<number>(
    initial?.spec.kind === 'monthly' ? (initial.spec.monthDays[0] ?? 1) : 1,
  );
  const [endKind, setEndKind] = useState<EndCondition['type']>(
    initial?.endCondition.type ?? 'never',
  );
  const [until, setUntil] = useState<ISODate>(today);
  const [count, setCount] = useState<number>(10);
  const [saving, setSaving] = useState(false);
  const { message } = App.useApp();

  useEffect(() => {
    if (!open) return;
    setTitle(initial?.title ?? '');
    setDescription(initial?.description ?? '');
    setNote(initial?.note ?? '');
    setPriority(initial?.priority ?? 'medium');
    setStartDate(initial?.startDate ?? today);
    setKind(initial?.spec.kind ?? 'daily');
    setWeekdays(initial?.spec.kind === 'weekly' ? [...initial.spec.weekdays] : [1, 3, 5]);
    setMonthDay(initial?.spec.kind === 'monthly' ? (initial.spec.monthDays[0] ?? 1) : 1);
    setEndKind(initial?.endCondition.type ?? 'never');
    setUntil(today);
    setCount(10);
  }, [open, initial, today]);

  const monthDays = useMemo(() => [monthDay], [monthDay]);

  async function submit() {
    const nextTitle = title.trim();
    if (nextTitle.length === 0) {
      message.warning('请填写标题。');
      return;
    }
    if (kind === 'weekly' && weekdays.length === 0) {
      message.warning('每周重复至少要选一天。');
      return;
    }
    const spec: RecurrenceSpec =
      kind === 'monthly' ? { kind: 'monthly', monthDays } : buildSpec(kind, weekdays, monthDay);
    const endCondition: EndCondition =
      endKind === 'until'
        ? { type: 'until', until }
        : endKind === 'count'
          ? { type: 'count', count }
          : { type: 'never' };

    setSaving(true);
    try {
      await onSubmit({
        title: nextTitle,
        description,
        note,
        priority,
        startDate,
        spec,
        endCondition,
      });
      onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title={mode === 'create' ? '新建长期任务' : '调整重复规则'}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      onOk={() => void submit()}
      onCancel={onClose}
      destroyOnHidden
      width={560}
    >
      <Form layout="vertical">
        {mode === 'create' ? (
          <>
            <Form.Item label="标题" required>
              <Input
                value={title}
                aria-label="长期任务标题"
                maxLength={120}
                placeholder="例如：每周整理会议纪要"
                onChange={(event) => setTitle(event.target.value)}
              />
            </Form.Item>
            <Form.Item label="任务详情">
              <Input.TextArea
                value={description}
                aria-label="长期任务详情"
                autoSize={{ maxRows: 10 }}
                rows={4}
                style={{ resize: 'vertical' }}
                maxLength={500}
                placeholder="这条长期任务要做什么"
                onChange={(event) => setDescription(event.target.value)}
              />
            </Form.Item>
            <Form.Item label="备注">
              <Input
                value={note}
                aria-label="长期任务备注"
                maxLength={200}
                placeholder="可选"
                onChange={(event) => setNote(event.target.value)}
              />
            </Form.Item>
            <Space size="middle" wrap>
              <Form.Item label="优先级">
                <Select
                  value={priority}
                  style={{ width: 120 }}
                  aria-label="长期任务优先级"
                  options={PRIORITY_OPTIONS.map((item) => ({ ...item }))}
                  onChange={(value) => setPriority(value)}
                />
              </Form.Item>
              <Form.Item label="首次计划日">
                <DatePicker
                  value={dayjs(startDate)}
                  aria-label="首次计划日"
                  onChange={(value) => setStartDate(value ? value.format('YYYY-MM-DD') : today)}
                />
              </Form.Item>
            </Space>
          </>
        ) : (
          <p className="list-hint">保存后立即覆盖当前规则并生效，历史安排也按新规则重新展开。</p>
        )}

        <Form.Item label="重复方式">
          <SpecFields
            kind={kind}
            weekdays={weekdays}
            monthDay={monthDay}
            lastDayOfMonth={monthDay === -1}
            onChange={(patch) => {
              if (patch.kind) setKind(patch.kind);
              if (patch.weekdays) setWeekdays(patch.weekdays);
              if (patch.monthDay !== undefined) setMonthDay(patch.monthDay);
            }}
          />
        </Form.Item>

        {mode === 'create' ? (
          <>
            <Form.Item label="结束条件">
              <Select
                value={endKind}
                aria-label="结束条件"
                options={[
                  { value: 'never', label: '一直重复' },
                  { value: 'until', label: '到某天为止' },
                  { value: 'count', label: '总共执行 N 次' },
                ]}
                onChange={(value) => setEndKind(value)}
              />
            </Form.Item>
            {endKind === 'until' ? (
              <DatePicker
                value={dayjs(until)}
                aria-label="结束日期"
                onChange={(value) => setUntil(value ? value.format('YYYY-MM-DD') : today)}
              />
            ) : null}
            {endKind === 'count' ? (
              <InputNumber
                min={1}
                max={2000}
                value={count}
                aria-label="执行次数"
                onChange={(value) => setCount(value ?? 1)}
              />
            ) : null}
          </>
        ) : null}
      </Form>
    </Modal>
  );
}

/** 编辑长期任务的基本信息（标题/描述/备注/优先级），不触碰规则与历史。 */
function LongTaskInfoModal({
  open,
  aggregate,
  onClose,
}: {
  open: boolean;
  aggregate: LongTaskAggregate | null;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const task = aggregate?.task;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [note, setNote] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !task) return;
    setTitle(task.title);
    setDescription(task.description);
    setNote(task.note);
    setPriority(task.priority);
  }, [open, task]);

  async function submit() {
    if (!task) return;
    const next = title.trim();
    if (next.length === 0) {
      message.warning('标题不能为空。');
      return;
    }
    setSaving(true);
    try {
      await updateLongTaskInfoById(task.id, {
        expectedUpdatedAt: task.updatedAt,
        patch: { title: next, description, note, priority },
      });
      message.success('已保存。');
      onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败，请重试。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title="编辑长期任务"
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      onOk={() => void submit()}
      onCancel={onClose}
      destroyOnHidden
    >
      <Form layout="vertical">
        <Form.Item label="标题">
          <Input
            value={title}
            aria-label="长期任务标题"
            maxLength={80}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Form.Item>
        <Form.Item label="描述">
          <Input.TextArea
            value={description}
            aria-label="长期任务描述"
            rows={2}
            maxLength={500}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Form.Item>
        <Form.Item label="备注">
          <Input
            value={note}
            aria-label="长期任务备注"
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
          />
        </Form.Item>
        <Form.Item label="优先级">
          <Select
            value={priority}
            aria-label="长期任务优先级"
            options={[...PRIORITY_OPTIONS]}
            onChange={(value: TaskPriority) => setPriority(value)}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** 单张长期任务卡：规则、未来 5 次、生命周期与规则调整入口。 */
function LongTaskCard({
  aggregate,
  today,
  onAdjust,
  onOnce,
  onEdit,
}: {
  aggregate: LongTaskAggregate;
  today: ISODate;
  onAdjust: (aggregate: LongTaskAggregate) => void;
  onOnce: (aggregate: LongTaskAggregate, occurrence: ResolvedOccurrence) => void;
  onEdit: (aggregate: LongTaskAggregate) => void;
}) {
  const { message } = App.useApp();
  const task = aggregate.task;
  const status = statusOf(task.events);
  const latestVersion = aggregate.versions[aggregate.versions.length - 1];
  const upcoming = useUpcoming(task.id, task.updatedAt, today);
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (action: () => Promise<unknown>, fallback: string) => {
      setBusy(true);
      try {
        await action();
      } catch (error) {
        message.error(error instanceof Error ? error.message : fallback);
      } finally {
        setBusy(false);
      }
    },
    [message],
  );

  const lifecycle = (type: 'paused' | 'resumed' | 'ended') =>
    run(
      () =>
        addLifecycleEvent(task.id, {
          type,
          date: today,
          expectedUpdatedAt: task.updatedAt,
          note: '界面操作',
        }),
      '操作失败。',
    );

  const menuItems = [
    { key: 'edit', label: '编辑信息' },
    { key: 'adjust', label: '调整规则' },
    { key: 'pause', label: '暂停（今天起）', disabled: status !== 'active' },
    { key: 'resume', label: '恢复（今天起）', disabled: status !== 'paused' },
    { key: 'end', label: '结束（今天起）', disabled: status === 'ended' },
    { key: 'reopen', label: '重新启用', disabled: status !== 'ended' },
    { type: 'divider' as const },
    { key: 'archive', label: '归档' },
    { key: 'delete', label: '移入回收站' },
  ];

  return (
    <article className="long-card" aria-label={`长期任务 ${task.title}`}>
      <header className="long-card__head">
        <span className="long-card__title">{task.title}</span>
        <Tag color={STATUS_TAG[status].color} bordered={false}>
          {STATUS_TAG[status].label}
        </Tag>
        <span className="long-card__spacer" />
        <Button
          size="small"
          type="text"
          aria-label="上移"
          title="上移"
          disabled={busy}
          onClick={() =>
            void run(
              () => move(task.id, 'up', { expectedUpdatedAt: task.updatedAt }),
              '调整顺序失败。',
            )
          }
        >
          ↑
        </Button>
        <Button
          size="small"
          type="text"
          aria-label="下移"
          title="下移"
          disabled={busy}
          onClick={() =>
            void run(
              () => move(task.id, 'down', { expectedUpdatedAt: task.updatedAt }),
              '调整顺序失败。',
            )
          }
        >
          ↓
        </Button>
        <Dropdown
          trigger={['click']}
          menu={{
            items: menuItems,
            onClick: ({ key }) => {
              if (key === 'edit') onEdit(aggregate);
              else if (key === 'adjust') onAdjust(aggregate);
              else if (key === 'pause') void lifecycle('paused');
              else if (key === 'resume') void lifecycle('resumed');
              else if (key === 'end') void lifecycle('ended');
              else if (key === 'reopen') {
                void run(
                  () =>
                    reopenWithRuleVersion(task.id, {
                      date: today,
                      spec: latestVersion?.spec ?? { kind: 'daily' },
                      effectiveFrom: today,
                      expectedUpdatedAt: task.updatedAt,
                      changeNote: '界面重新启用',
                    }),
                  '重新启用失败。',
                );
              } else if (key === 'archive') {
                void run(
                  () => setArchived(task.id, { archived: true, expectedUpdatedAt: task.updatedAt }),
                  '归档失败。',
                );
              } else if (key === 'delete') {
                void run(
                  () => softDelete(task.id, { expectedUpdatedAt: task.updatedAt }),
                  '移入回收站失败。',
                );
              }
            },
          }}
        >
          <Button type="text" size="small" aria-label="更多操作" disabled={busy}>
            ⋯
          </Button>
        </Dropdown>
      </header>

      <p className="long-card__rule">
        {describeSpec(latestVersion?.spec ?? { kind: 'daily' })} · {describeEnd(task.endCondition)}{' '}
        · 从 {task.startDate}
        {task.endDate ? ` 到 ${task.endDate}` : ''}
      </p>

      {task.description ? <p className="long-card__detail">{task.description}</p> : null}
      {task.note ? <p className="long-card__note">备注：{task.note}</p> : null}

      <div className="long-card__upcoming">
        <span className="long-card__label">未来 5 次</span>
        {upcoming.items === null ? <span className="list-hint">读取中…</span> : null}
        {upcoming.error ? <span className="long-card__error">{upcoming.error}</span> : null}
        {upcoming.items !== null && upcoming.items.length === 0 && !upcoming.error ? (
          <span className="list-hint">没有后续安排</span>
        ) : null}
        <div className="occurrence-list">
          {(upcoming.items ?? []).map((occurrence) => (
            <Tooltip key={occurrence.date} title="只改这一次（不影响规则）">
              <button
                type="button"
                className="occurrence-chip"
                onClick={() => onOnce(aggregate, occurrence)}
              >
                {occurrence.date.slice(5)}
                {occurrence.overridden ? ' *' : ''}
              </button>
            </Tooltip>
          ))}
        </div>
      </div>
    </article>
  );
}

export interface LongTasksPanelProps {
  today: ISODate;
}

/**
 * 右栏：长期任务规则卡。
 *
 * 长期任务本身不出现在左栏日程里，这里只展示规则与未来 5 次预览。
 */
export function LongTasksPanel({ today }: LongTasksPanelProps) {
  const { message, modal } = App.useApp();
  const page = useLiveQuery(
    () =>
      queryLongTaskAggregates(
        { deleted: 'active', archived: 'active' },
        { key: 'updatedAt', direction: 'desc' },
        { page: 1, pageSize: 50 },
      ),
    [],
    undefined,
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<LongTaskAggregate | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<LongTaskAggregate | null>(null);
  const [onceTarget, setOnceTarget] = useState<{
    aggregate: LongTaskAggregate;
    occurrence: ResolvedOccurrence;
  } | null>(null);
  const [onceTitle, setOnceTitle] = useState('');
  const [onceSkip, setOnceSkip] = useState(false);

  const items = page?.items ?? [];

  function openOnce(aggregate: LongTaskAggregate, occurrence: ResolvedOccurrence) {
    setOnceTitle(occurrence.title);
    setOnceSkip(false);
    setOnceTarget({ aggregate, occurrence });
  }

  async function submitCreate(values: {
    title: string;
    description: string;
    note: string;
    priority: TaskPriority;
    startDate: ISODate;
    spec: RecurrenceSpec;
    endCondition: EndCondition;
  }) {
    await createLongTask({
      title: values.title,
      description: values.description,
      note: values.note,
      priority: values.priority,
      startDate: values.startDate,
      spec: values.spec,
      endCondition: values.endCondition,
    });
    message.success('长期任务已创建。');
  }

  async function submitRule(values: {
    title: string;
    description: string;
    note: string;
    priority: TaskPriority;
    startDate: ISODate;
    spec: RecurrenceSpec;
    endCondition: EndCondition;
  }) {
    if (!adjustTarget) return;
    await replaceRule(adjustTarget.task.id, {
      spec: values.spec,
      changeNote: '界面覆盖规则',
      expectedUpdatedAt: adjustTarget.task.updatedAt,
    });
    message.success('规则已覆盖并立即生效。');
  }

  async function submitOnce() {
    if (!onceTarget) return;
    const { aggregate, occurrence } = onceTarget;
    if (!onceSkip && onceTitle.trim().length === 0) {
      message.warning('请填写新的标题，或选择跳过这一次。');
      return;
    }
    try {
      if (onceSkip) {
        await writeException(aggregate.task.id, {
          occurrenceDate: occurrence.date,
          changeKind: 'initial',
          state: { mode: 'skip' },
          reason: '界面跳过这一次',
          expectedUpdatedAt: aggregate.task.updatedAt,
        });
      } else {
        await writeException(aggregate.task.id, {
          occurrenceDate: occurrence.date,
          changeKind: 'initial',
          state: {
            mode: 'override',
            patch: { title: onceTitle.trim() },
          },
          reason: '界面只改这一次',
          expectedUpdatedAt: aggregate.task.updatedAt,
        });
      }
      message.success('这一次的安排已更新，规则未变。');
      setOnceTarget(null);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败。');
    }
  }

  return (
    <div className="long-panel">
      <header className="long-panel__head">
        <div>
          <h2 className="long-panel__title">长期任务</h2>
          <p className="list-hint">只显示规则；具体某天的事按规则自动展开。</p>
        </div>
        <Button type="primary" onClick={() => setCreateOpen(true)} aria-label="新建长期任务">
          新建
        </Button>
      </header>

      {page === undefined ? (
        <LoadingState tip="正在读取长期任务…" />
      ) : items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有长期任务，先建一条周期规则">
          <Button type="primary" onClick={() => setCreateOpen(true)}>
            创建第一条
          </Button>
        </Empty>
      ) : (
        <div className="long-list">
          {items.map((aggregate) => (
            <LongTaskCard
              key={aggregate.task.id}
              aggregate={aggregate}
              today={today}
              onAdjust={setAdjustTarget}
              onOnce={openOnce}
              onEdit={setEditTarget}
            />
          ))}
        </div>
      )}

      <LongTaskInfoModal
        open={editTarget !== null}
        aggregate={editTarget}
        onClose={() => setEditTarget(null)}
      />

      <LongTaskFormModal
        open={createOpen}
        mode="create"
        today={today}
        onClose={() => setCreateOpen(false)}
        onSubmit={submitCreate}
      />

      <LongTaskFormModal
        open={adjustTarget !== null}
        mode="rule"
        today={today}
        initial={
          adjustTarget
            ? {
                title: adjustTarget.task.title,
                description: adjustTarget.task.description,
                note: adjustTarget.task.note,
                priority: adjustTarget.task.priority,
                spec: adjustTarget.versions[adjustTarget.versions.length - 1]?.spec ?? {
                  kind: 'daily',
                },
                startDate:
                  adjustTarget.versions[adjustTarget.versions.length - 1]?.effectiveFrom ??
                  adjustTarget.task.startDate,
                endCondition: adjustTarget.task.endCondition,
              }
            : undefined
        }
        onClose={() => setAdjustTarget(null)}
        onSubmit={submitRule}
      />

      <Modal
        open={onceTarget !== null}
        title={`只改这一次：${onceTarget?.occurrence.date ?? ''}`}
        okText="保存这一次"
        cancelText="取消"
        onOk={() => void submitOnce()}
        onCancel={() => setOnceTarget(null)}
        destroyOnHidden
      >
        <p className="list-hint">只影响这一天，之后的安排仍按原规则生成。</p>
        <Form layout="vertical">
          <Form.Item label="这一次的标题">
            <Input
              value={onceTitle}
              aria-label="这一次的标题"
              disabled={onceSkip}
              onChange={(event) => setOnceTitle(event.target.value)}
            />
          </Form.Item>
          <Checkbox
            checked={onceSkip}
            onChange={(event) => setOnceSkip(event.target.checked)}
            aria-label="跳过这一次"
          >
            跳过这一次（仍然计入总次数）
          </Checkbox>
        </Form>
      </Modal>

      <Button
        type="text"
        className="long-panel__hint"
        onClick={() =>
          modal.info({
            title: '长期任务与普通任务的区别',
            content:
              '普通任务有一次具体的日期，出现在左栏；长期任务是重复规则，只在这里维护，按规则自动展开到每一天。',
            okText: '知道了',
          })
        }
      >
        两者有什么区别？
      </Button>
    </div>
  );
}
