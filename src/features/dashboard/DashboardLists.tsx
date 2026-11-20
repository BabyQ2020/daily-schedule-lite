import { Button, Empty, Progress, Tag, Typography } from 'antd';
import { ArrowRightOutlined } from '@ant-design/icons';

import type { Task, WorkLog } from '@/domain/types';
import { TASK_STATUS_LABELS } from '@/domain/labels';
import { HEALTH_LEVEL_LABELS, type ProjectHealth } from '@/services/stats/health';

interface TaskListProps {
  tasks: Task[];
  onOpenTask: (task: Task) => void;
  emptyText: string;
}

function TaskRow({ task, onOpenTask }: { task: Task; onOpenTask: (task: Task) => void }) {
  return (
    <li className="dash-row">
      <button type="button" className="dash-row__main" onClick={() => onOpenTask(task)}>
        <span className="dash-row__title">{task.title}</span>
        <span className="dash-row__meta">
          {task.dueDate ? <span>截止 {task.dueDate}</span> : null}
          {task.planDate ? <span>计划 {task.planDate}</span> : null}
        </span>
      </button>
      <Tag color={TASK_STATUS_LABELS[task.status].color}>
        {TASK_STATUS_LABELS[task.status].label}
      </Tag>
    </li>
  );
}

export function OverdueTaskList({ tasks, onOpenTask, emptyText }: TaskListProps) {
  if (tasks.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />;
  }
  return (
    <ul className="dash-list">
      {tasks.map((task) => (
        <li key={task.id} className="dash-row dash-row--overdue">
          <button type="button" className="dash-row__main" onClick={() => onOpenTask(task)}>
            <span className="dash-row__title">{task.title}</span>
            <span className="dash-row__meta">截止 {task.dueDate}</span>
          </button>
          <Tag color="red">逾期</Tag>
        </li>
      ))}
    </ul>
  );
}

export function WeekPlanList({ tasks, onOpenTask, emptyText }: TaskListProps) {
  if (tasks.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />;
  }
  return (
    <ul className="dash-list">
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} onOpenTask={onOpenTask} />
      ))}
    </ul>
  );
}

interface ProjectHealthListProps {
  items: ProjectHealth[];
  onOpenProject: (item: ProjectHealth) => void;
}

export function ProjectHealthList({ items, onOpenProject }: ProjectHealthListProps) {
  if (items.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有进行中的项目" />;
  }
  return (
    <ul className="dash-list">
      {items.map((item) => {
        const label = HEALTH_LEVEL_LABELS[item.level];
        return (
          <li key={item.projectId} className="dash-row">
            <button type="button" className="dash-row__main" onClick={() => onOpenProject(item)}>
              <span className="dash-row__title">
                {item.name} <Tag color={label.color}>{label.label}</Tag>
              </span>
              <span className="dash-row__meta">{item.reasons.join('；')}</span>
              <Progress
                percent={item.progress.percent ?? 0}
                size="small"
                showInfo={item.progress.percent !== null}
                format={(value) => `${value}%`}
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

interface RecentLogListProps {
  logs: WorkLog[];
  onOpenLog: (log: WorkLog) => void;
  onGoLogs: () => void;
}

export function RecentLogList({ logs, onOpenLog, onGoLogs }: RecentLogListProps) {
  if (logs.length === 0) {
    return (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有工作日志">
        <Button size="small" onClick={onGoLogs}>
          去写日志
        </Button>
      </Empty>
    );
  }
  return (
    <ul className="dash-list">
      {logs.map((log) => (
        <li key={log.id} className="dash-row">
          <button type="button" className="dash-row__main" onClick={() => onOpenLog(log)}>
            <span className="dash-row__title">{log.title}</span>
            <span className="dash-row__meta">
              {log.date}
              {log.projectNameSnapshot ? ` · ${log.projectNameSnapshot}` : ''}
            </span>
          </button>
          <ArrowRightOutlined className="dash-row__arrow" aria-hidden="true" />
        </li>
      ))}
    </ul>
  );
}

export function MoreHint({ text }: { text: string }) {
  return <Typography.Text type="secondary">{text}</Typography.Text>;
}
