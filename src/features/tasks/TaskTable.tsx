import { Button, Dropdown, Empty, Space, Table, Tag, Typography } from 'antd';
import type { MenuProps, TableColumnsType } from 'antd';
import { MoreOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';

import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from '@/domain/labels';
import type { Id, Project, Tag as TagEntity, Task } from '@/domain/types';
import type { TaskSortKey } from '@/services/tasks/service';
import { isOverdue } from '@/services/stats/progress';

export interface TaskTableProps {
  tasks: readonly Task[];
  loading: boolean;
  total: number;
  page: number;
  pageSize: number;
  sortKey: TaskSortKey;
  sortDirection: 'asc' | 'desc';
  selectedIds: readonly Id[];
  projects: readonly Project[];
  tags: readonly TagEntity[];
  today: string;
  emptyText: ReactNode;
  onSelectionChange: (ids: Id[]) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onSortChange: (key: TaskSortKey, direction: 'asc' | 'desc') => void;
  onEdit: (task: Task) => void;
  onToggleDone: (task: Task) => void;
  onToggleArchive: (task: Task) => void;
  onDelete: (task: Task) => void;
}

export function TaskTable({
  tasks,
  loading,
  total,
  page,
  pageSize,
  sortKey,
  sortDirection,
  selectedIds,
  projects,
  tags,
  today,
  emptyText,
  onSelectionChange,
  onPageChange,
  onPageSizeChange,
  onSortChange,
  onEdit,
  onToggleDone,
  onToggleArchive,
  onDelete,
}: TaskTableProps) {
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const tagNames = new Map(tags.map((tag) => [tag.id, tag.name]));

  const rowMenu = (task: Task): MenuProps => ({
    items: [
      { key: 'edit', label: '编辑' },
      { key: 'done', label: task.status === 'done' ? '重新打开' : '标记完成' },
      { key: 'archive', label: task.archivedAt ? '恢复归档' : '归档' },
      { type: 'divider' },
      { key: 'delete', label: '删除', danger: true },
    ],
    onClick: ({ key, domEvent }) => {
      domEvent.stopPropagation();
      if (key === 'edit') {
        onEdit(task);
      } else if (key === 'done') {
        onToggleDone(task);
      } else if (key === 'archive') {
        onToggleArchive(task);
      } else if (key === 'delete') {
        onDelete(task);
      }
    },
  });

  const sortOrderOf = (key: TaskSortKey) =>
    sortKey === key ? (sortDirection === 'asc' ? 'ascend' : 'descend') : null;

  const columns: TableColumnsType<Task> = [
    {
      title: '任务',
      dataIndex: 'title',
      key: 'title',
      sorter: true,
      sortOrder: sortOrderOf('title'),
      render: (_, task) => (
        <div>
          <Space size={6} wrap>
            <Typography.Text strong delete={task.status === 'cancelled'}>
              {task.title}
            </Typography.Text>
            {task.archivedAt ? <Tag>已归档</Tag> : null}
            {task.tags.slice(0, 2).map((tagId) => (
              <Tag key={tagId} bordered={false}>
                {tagNames.get(tagId) ?? '未知标签'}
              </Tag>
            ))}
            {task.tags.length > 2 ? <Tag bordered={false}>+{task.tags.length - 2}</Tag> : null}
          </Space>
          {task.description ? (
            <Typography.Paragraph type="secondary" ellipsis={{ rows: 1 }} style={{ margin: 0 }}>
              {task.description}
            </Typography.Paragraph>
          ) : null}
        </div>
      ),
    },
    {
      title: '项目',
      key: 'project',
      width: 140,
      render: (_, task) =>
        task.projectId ? (
          <Typography.Text ellipsis style={{ maxWidth: 120 }}>
            {projectNames.get(task.projectId) ?? '未知项目'}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 96,
      render: (status: Task['status']) => (
        <Tag color={TASK_STATUS_LABELS[status].color}>{TASK_STATUS_LABELS[status].label}</Tag>
      ),
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      key: 'priority',
      width: 92,
      sorter: true,
      sortOrder: sortOrderOf('priority'),
      render: (priority: Task['priority']) => (
        <Tag color={TASK_PRIORITY_LABELS[priority].color}>
          {TASK_PRIORITY_LABELS[priority].label}
        </Tag>
      ),
    },
    {
      title: '计划',
      dataIndex: 'planDate',
      key: 'planDate',
      width: 116,
      sorter: true,
      sortOrder: sortOrderOf('planDate'),
      render: (planDate: Task['planDate']) => (
        <Typography.Text type={planDate ? undefined : 'secondary'}>
          {planDate ?? '—'}
        </Typography.Text>
      ),
    },
    {
      title: '截止',
      dataIndex: 'dueDate',
      key: 'dueDate',
      width: 128,
      sorter: true,
      sortOrder: sortOrderOf('dueDate'),
      render: (dueDate: Task['dueDate'], task) => {
        if (!dueDate) {
          return <Typography.Text type="secondary">—</Typography.Text>;
        }
        return isOverdue(task, today) ? (
          <Tag color="red">{dueDate} 逾期</Tag>
        ) : (
          <Typography.Text>{dueDate}</Typography.Text>
        );
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 96,
      fixed: 'right',
      render: (_, task) => (
        <Space size={0}>
          <Button type="link" size="small" onClick={() => onEdit(task)}>
            编辑
          </Button>
          <Dropdown menu={rowMenu(task)} trigger={['click']}>
            <Button
              type="text"
              size="small"
              icon={<MoreOutlined />}
              aria-label={`更多操作：${task.title}`}
            />
          </Dropdown>
        </Space>
      ),
    },
  ];

  return (
    <Table<Task>
      rowKey="id"
      size="middle"
      loading={loading}
      dataSource={[...tasks]}
      columns={columns}
      scroll={{ x: 1080 }}
      rowSelection={{
        selectedRowKeys: [...selectedIds],
        onChange: (keys) => onSelectionChange(keys.map(String)),
        preserveSelectedRowKeys: false,
      }}
      locale={{
        emptyText: tasks.length === 0 ? emptyText : <Empty description="没有匹配的任务" />,
      }}
      sortDirections={['ascend', 'descend']}
      onChange={(pagination, _filters, sorter) => {
        const single = Array.isArray(sorter) ? sorter[0] : sorter;
        const columnKey = single?.columnKey as TaskSortKey | undefined;
        if (columnKey && single?.order) {
          const next: 'asc' | 'desc' = single.order === 'ascend' ? 'asc' : 'desc';
          if (next !== sortDirection || columnKey !== sortKey) {
            onSortChange(columnKey, next);
          }
          return;
        }
        if (pagination.current !== page) {
          onPageChange(pagination.current ?? 1);
          return;
        }
        if (pagination.pageSize && pagination.pageSize !== pageSize) {
          onPageSizeChange(pagination.pageSize);
        }
      }}
      pagination={{
        current: page,
        pageSize,
        total,
        showSizeChanger: true,
        pageSizeOptions: [20, 50, 100],
        showTotal: (count) => `共 ${count} 条`,
        size: 'default',
      }}
    />
  );
}
