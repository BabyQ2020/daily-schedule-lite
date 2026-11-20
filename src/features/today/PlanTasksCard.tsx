import { useState } from 'react';

import { CloseOutlined } from '@ant-design/icons';
import { App, Button, Card, Checkbox, Input, Select, Tag, Typography } from 'antd';

import { EmptyState } from '@/components/states/EmptyState';
import type { DailyPlan, Id, Task } from '@/domain/types';
import type { ISODate } from '@/lib/period';
import {
  addExtra,
  addTaskToPlan,
  removeExtra,
  removeTaskFromPlan,
  upsertPlan,
} from '@/services/today/service';

export interface PlanTasksCardProps {
  date: ISODate;
  plan: DailyPlan | undefined;
  planned: readonly Task[];
  candidates: readonly Task[];
  projectNameOf: (projectId: Id | null) => string | undefined;
  onToggle: (task: Task) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，请稍后重试。';
}

export function PlanTasksCard({
  date,
  plan,
  planned,
  candidates,
  projectNameOf,
  onToggle,
}: PlanTasksCardProps) {
  const { message } = App.useApp();
  const [extraText, setExtraText] = useState('');
  const [note, setNote] = useState(plan?.note ?? '');
  const [savingNote, setSavingNote] = useState(false);

  async function handleAddTask(taskId: Id): Promise<void> {
    try {
      await addTaskToPlan(date, taskId);
      message.success('已加入今日计划');
    } catch (error) {
      message.error(errorMessage(error));
    }
  }

  async function handleRemoveTask(taskId: Id): Promise<void> {
    try {
      await removeTaskFromPlan(date, taskId);
      message.success('已移出今日计划');
    } catch (error) {
      message.error(errorMessage(error));
    }
  }

  async function handleAddExtra(): Promise<void> {
    const text = extraText.trim();
    if (text.length === 0) {
      return;
    }
    try {
      await addExtra(date, text);
      setExtraText('');
    } catch (error) {
      message.error(errorMessage(error));
    }
  }

  async function handleRemoveExtra(index: number): Promise<void> {
    try {
      await removeExtra(date, index);
    } catch (error) {
      message.error(errorMessage(error));
    }
  }

  async function handleSaveNote(): Promise<void> {
    if (note === (plan?.note ?? '')) {
      return;
    }
    setSavingNote(true);
    try {
      await upsertPlan(date, { note });
      message.success('当日备注已保存');
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setSavingNote(false);
    }
  }

  const extras = plan?.extras ?? [];

  return (
    <Card
      title={
        <span>
          今日计划 <Tag>{planned.length} 项</Tag>
        </span>
      }
      extra={
        <Select
          showSearch
          optionFilterProp="label"
          placeholder="从已有任务添加"
          aria-label="从已有任务添加到今日计划"
          style={{ width: 200 }}
          value={null}
          options={candidates.map((task) => ({ value: task.id, label: task.title }))}
          onChange={(taskId: Id) => {
            void handleAddTask(taskId);
          }}
          notFoundContent="没有可添加的任务"
        />
      }
    >
      {planned.length === 0 ? (
        <EmptyState
          compact
          title="今天还没有安排任务"
          description="从右上角选择已有任务，或到「全部任务」页新建任务后再加入。"
        />
      ) : (
        <ul className="today-task-list">
          {planned.map((task) => {
            const project = projectNameOf(task.projectId);
            return (
              <li key={task.id} className="today-task-list__item">
                <Checkbox
                  checked={task.status === 'done'}
                  onChange={() => {
                    onToggle(task);
                  }}
                >
                  <span className={task.status === 'done' ? 'today-task-list__done' : undefined}>
                    {task.title}
                  </span>
                  {project ? (
                    <Typography.Text type="secondary" className="today-task-list__project">
                      {project}
                    </Typography.Text>
                  ) : null}
                </Checkbox>
                <Button
                  type="text"
                  size="small"
                  icon={<CloseOutlined />}
                  aria-label={`移出今日计划：${task.title}`}
                  onClick={() => {
                    void handleRemoveTask(task.id);
                  }}
                />
              </li>
            );
          })}
        </ul>
      )}

      <div className="today-subsection">
        <Typography.Text strong>补充事项</Typography.Text>
        <div className="today-inline-form">
          <Input
            placeholder="不在任务列表里的事，例如「整理下周会议材料」"
            aria-label="补充事项"
            value={extraText}
            onChange={(event) => {
              setExtraText(event.target.value);
            }}
            onPressEnter={() => {
              void handleAddExtra();
            }}
            maxLength={120}
          />
          <Button
            onClick={() => {
              void handleAddExtra();
            }}
            disabled={extraText.trim().length === 0}
          >
            添加
          </Button>
        </div>
        {extras.length === 0 ? (
          <Typography.Text type="secondary">暂无补充事项</Typography.Text>
        ) : (
          <ul className="today-extra-list">
            {extras.map((extra, index) => (
              <li key={`${extra}-${String(index)}`}>
                <span>{extra}</span>
                <Button
                  type="text"
                  size="small"
                  icon={<CloseOutlined />}
                  aria-label={`删除补充事项：${extra}`}
                  onClick={() => {
                    void handleRemoveExtra(index);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="today-subsection">
        <Typography.Text strong>当日备注</Typography.Text>
        <Input.TextArea
          rows={3}
          aria-label="当日备注"
          placeholder="记录今天的状态、约束或提醒"
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
          onBlur={() => {
            void handleSaveNote();
          }}
          maxLength={500}
        />
        <div className="today-subsection__footer">
          <Button size="small" onClick={() => void handleSaveNote()} loading={savingNote}>
            保存备注
          </Button>
        </div>
      </div>
    </Card>
  );
}
