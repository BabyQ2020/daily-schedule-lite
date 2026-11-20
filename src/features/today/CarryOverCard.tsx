import { CalendarOutlined, CheckOutlined } from '@ant-design/icons';
import { Button, Card, List, Tag, Typography } from 'antd';

import { EmptyState } from '@/components/states/EmptyState';
import type { Task } from '@/domain/types';

export interface CarryOverCardProps {
  overdue: readonly Task[];
  carryOver: readonly Task[];
  onComplete: (task: Task) => void;
  onMoveToToday: (task: Task) => void;
}

function TaskRow({
  task,
  hint,
  onComplete,
  onMoveToToday,
}: {
  task: Task;
  hint: string;
  onComplete: (task: Task) => void;
  onMoveToToday: (task: Task) => void;
}) {
  return (
    <List.Item
      actions={[
        <Button
          key="done"
          size="small"
          icon={<CheckOutlined />}
          aria-label={`标记完成：${task.title}`}
          onClick={() => {
            onComplete(task);
          }}
        >
          完成
        </Button>,
        <Button
          key="move"
          size="small"
          icon={<CalendarOutlined />}
          aria-label={`改到今天：${task.title}`}
          onClick={() => {
            onMoveToToday(task);
          }}
        >
          改到今天
        </Button>,
      ]}
    >
      <List.Item.Meta
        title={task.title}
        description={
          <Typography.Text type="secondary">
            {hint}
            {task.projectId ? ' · 已关联项目' : ''}
          </Typography.Text>
        }
      />
    </List.Item>
  );
}

export function CarryOverCard({
  overdue,
  carryOver,
  onComplete,
  onMoveToToday,
}: CarryOverCardProps) {
  const empty = overdue.length === 0 && carryOver.length === 0;

  return (
    <Card
      title={
        <span>
          逾期与待结转
          {overdue.length > 0 ? (
            <Tag color="red" style={{ marginInlineStart: 8 }}>
              逾期 {overdue.length}
            </Tag>
          ) : null}
          {carryOver.length > 0 ? (
            <Tag color="orange" style={{ marginInlineStart: 4 }}>
              待结转 {carryOver.length}
            </Tag>
          ) : null}
        </span>
      }
    >
      {empty ? (
        <EmptyState
          compact
          title="没有逾期或待结转任务"
          description="截止日期早于今天且未完成的任务会出现在这里；计划日期已过但未逾期的任务算作待结转。"
        />
      ) : (
        <>
          {overdue.length > 0 ? (
            <section className="today-section">
              <Typography.Text strong>逾期任务</Typography.Text>
              <Typography.Paragraph type="secondary" className="today-section__hint">
                截止日期早于今天且未完成。逾期按截止日期计算，与计划日期无关。
              </Typography.Paragraph>
              <List
                size="small"
                dataSource={[...overdue]}
                renderItem={(task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    hint={`截止 ${task.dueDate ?? '—'}`}
                    onComplete={onComplete}
                    onMoveToToday={onMoveToToday}
                  />
                )}
              />
            </section>
          ) : null}

          {carryOver.length > 0 ? (
            <section className="today-section">
              <Typography.Text strong>待结转任务</Typography.Text>
              <Typography.Paragraph type="secondary" className="today-section__hint">
                计划日期早于今天、仍未完成。待结转不等于逾期，系统不会自动结转。
              </Typography.Paragraph>
              <List
                size="small"
                dataSource={[...carryOver]}
                renderItem={(task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    hint={`原计划 ${task.planDate ?? '—'}`}
                    onComplete={onComplete}
                    onMoveToToday={onMoveToToday}
                  />
                )}
              />
            </section>
          ) : null}
        </>
      )}
    </Card>
  );
}
