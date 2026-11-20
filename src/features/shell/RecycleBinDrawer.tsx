import { useState } from 'react';

import { App, Button, Drawer, Popconfirm, Space, Table, Tabs, Tag } from 'antd';

import type { LongTask } from '@/domain/long-task';
import type { Task } from '@/domain/types';
import type { LongTaskAggregate } from '@/services/long-tasks/service';
import { listDeleted, purge, restore } from '@/services/long-tasks/service';
import { listDeletedTasks, purgeTasks, restoreTasks } from '@/services/tasks/service';
import { useLiveQuery } from 'dexie-react-hooks';
import { Empty } from 'antd';

const PAGE = { page: 1, pageSize: 100 } as const;

function TaskTab() {
  const { message } = App.useApp();
  const page = useLiveQuery(() => listDeletedTasks(PAGE), [], undefined);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await action();
      message.success(ok);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败。');
    } finally {
      setBusy(false);
    }
  }

  const rows = page?.items ?? [];

  return (
    <div className="recycle-panel">
      <p className="list-hint">普通任务删除后进这里；恢复后回到原来的计划日期。</p>
      {rows.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="回收站里没有普通任务" />
      ) : (
        <Table<Task>
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={rows}
          columns={[
            { title: '标题', dataIndex: 'title', ellipsis: true },
            {
              title: '计划日',
              dataIndex: 'planDate',
              width: 110,
              render: (value: string | null) => value ?? '—',
            },
            {
              title: '操作',
              width: 150,
              render: (_value, record) => (
                <Space size="small">
                  <Button
                    type="link"
                    size="small"
                    disabled={busy}
                    onClick={() =>
                      void run(() => restoreTasks([record.id]).then(() => undefined), '已恢复')
                    }
                  >
                    恢复
                  </Button>
                  <Popconfirm
                    title="彻底删除？"
                    description="无法撤销，相关日志会保留标题快照。"
                    okText="彻底删除"
                    cancelText="取消"
                    onConfirm={() =>
                      void run(() => purgeTasks([record.id]).then(() => undefined), '已彻底删除')
                    }
                  >
                    <Button type="link" size="small" danger disabled={busy}>
                      彻底删除
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}

function LongTaskTab() {
  const { message } = App.useApp();
  const page = useLiveQuery(() => listDeleted(PAGE), [], undefined);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await action();
      message.success(ok);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败。');
    } finally {
      setBusy(false);
    }
  }

  const rows: LongTaskAggregate[] = page?.items ?? [];

  return (
    <div className="recycle-panel">
      <p className="list-hint">长期任务删除后进这里；恢复不会自动重新启用已结束的任务。</p>
      {rows.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="回收站里没有长期任务" />
      ) : (
        <Table<LongTaskAggregate>
          rowKey={(row) => row.task.id}
          size="small"
          pagination={false}
          dataSource={rows}
          columns={[
            {
              title: '标题',
              ellipsis: true,
              render: (_value, row) => row.task.title,
            },
            {
              title: '规则',
              width: 120,
              render: (_value, row: LongTaskAggregate) => {
                const task: LongTask = row.task;
                return <Tag bordered={false}>{task.events.length} 条生命周期记录</Tag>;
              },
            },
            {
              title: '操作',
              width: 170,
              render: (_value, row) => (
                <Space size="small">
                  <Button
                    type="link"
                    size="small"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => restore(row.task.id, { expectedUpdatedAt: row.task.updatedAt }),
                        '已恢复',
                      )
                    }
                  >
                    恢复
                  </Button>
                  <Popconfirm
                    title="彻底删除？"
                    description="会连同规则版本与例外记录一起删除，无法撤销。"
                    okText="彻底删除"
                    cancelText="取消"
                    onConfirm={() =>
                      void run(
                        () => purge(row.task.id, { expectedUpdatedAt: row.task.updatedAt }),
                        '已彻底删除',
                      )
                    }
                  >
                    <Button type="link" size="small" danger disabled={busy}>
                      彻底删除
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}

/** 回收站抽屉：普通任务与长期任务两个页签。 */
export function RecycleBinDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Drawer
      title="回收站"
      placement="right"
      width="min(94vw, 620px)"
      open={open}
      onClose={onClose}
      destroyOnHidden
    >
      <Tabs
        items={[
          { key: 'tasks', label: '普通任务', children: <TaskTab /> },
          { key: 'long', label: '长期任务', children: <LongTaskTab /> },
        ]}
      />
    </Drawer>
  );
}
