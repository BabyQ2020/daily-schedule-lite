import { App, Button, Modal, Popconfirm, Select, Space, Typography } from 'antd';
import { useState } from 'react';

import { TASK_PRIORITIES, TASK_STATUSES } from '@/domain/types';
import type { Id, Project, Tag, TaskPriority, TaskStatus } from '@/domain/types';
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from '@/domain/labels';
import {
  batchAddTag,
  batchArchive,
  batchAssignProject,
  batchRemove,
  batchSetPriority,
  batchSetStatus,
} from '@/services/task-actions';

type DialogKind = 'status' | 'priority' | 'project' | 'tag';

export interface TaskBatchBarProps {
  ids: readonly Id[];
  projects: readonly Project[];
  tags: readonly Tag[];
  /** 当前落在归档视图时，批量操作给「恢复归档」而不是「归档」。 */
  viewingArchived: boolean;
  onDone: () => void;
  onClear: () => void;
}

export function TaskBatchBar({
  ids,
  projects,
  tags,
  viewingArchived,
  onDone,
  onClear,
}: TaskBatchBarProps) {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [statusValue, setStatusValue] = useState<TaskStatus>('done');
  const [priorityValue, setPriorityValue] = useState<TaskPriority>('medium');
  const [projectValue, setProjectValue] = useState<Id | null>(null);
  const [tagValue, setTagValue] = useState<Id | null>(null);

  const count = ids.length;

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    try {
      const text = await action();
      message.success(text);
      onDone();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败，请重试');
    } finally {
      setBusy(false);
      setDialog(null);
    }
  };

  const handleConfirmDialog = () => {
    if (dialog === 'status') {
      void run(async () => {
        await batchSetStatus(ids, statusValue);
        return `已把 ${count} 个任务改为「${TASK_STATUS_LABELS[statusValue].label}」`;
      });
    } else if (dialog === 'priority') {
      void run(async () => {
        await batchSetPriority(ids, priorityValue);
        return `已把 ${count} 个任务的优先级改为「${TASK_PRIORITY_LABELS[priorityValue].label}」`;
      });
    } else if (dialog === 'project') {
      void run(async () => {
        await batchAssignProject(ids, projectValue);
        return `已把 ${count} 个任务移到「${projects.find((p) => p.id === projectValue)?.name ?? '无项目'}」`;
      });
    } else if (dialog === 'tag') {
      if (tagValue === null) {
        message.warning('请先选择要添加的标签');
        return;
      }
      void run(async () => {
        const changed = await batchAddTag(ids, tagValue);
        return changed === count
          ? `已为 ${count} 个任务添加标签`
          : `已为 ${changed} 个任务添加标签（其余已有该标签）`;
      });
    }
  };

  const dialogTitles: Record<DialogKind, string> = {
    status: `批量改状态（${count} 个任务）`,
    priority: `批量改优先级（${count} 个任务）`,
    project: `批量改项目（${count} 个任务）`,
    tag: `批量加标签（${count} 个任务）`,
  };

  return (
    <div className="batch-bar" role="region" aria-label="批量操作">
      <Space size={8} wrap>
        <Typography.Text strong>已选 {count} 项</Typography.Text>
        <Button
          size="small"
          loading={busy}
          onClick={() =>
            void run(async () => {
              await batchSetStatus(ids, 'done');
              return `已完成 ${count} 个任务`;
            })
          }
        >
          完成
        </Button>
        <Button size="small" onClick={() => setDialog('status')}>
          改状态
        </Button>
        <Button size="small" onClick={() => setDialog('priority')}>
          改优先级
        </Button>
        <Button size="small" onClick={() => setDialog('project')}>
          改项目
        </Button>
        <Button size="small" onClick={() => setDialog('tag')}>
          加标签
        </Button>
        <Button
          size="small"
          onClick={() =>
            void run(async () => {
              await batchArchive(ids, !viewingArchived);
              return viewingArchived ? `已恢复 ${count} 个任务` : `已归档 ${count} 个任务`;
            })
          }
        >
          {viewingArchived ? '恢复归档' : '归档'}
        </Button>
        <Popconfirm
          title={`删除选中的 ${count} 个任务？`}
          description="删除后不可恢复；关联的工作日志会保留任务标题快照。"
          okText="删除"
          okButtonProps={{ danger: true }}
          cancelText="取消"
          onConfirm={() =>
            void run(async () => {
              const result = await batchRemove(ids);
              return `已删除 ${result.deleted} 个任务${result.detachedLogs > 0 ? `，${result.detachedLogs} 条日志转为无任务关联` : ''}`;
            })
          }
        >
          <Button size="small" danger>
            删除
          </Button>
        </Popconfirm>
        <Button size="small" type="text" onClick={onClear}>
          取消选择
        </Button>
      </Space>

      <Modal
        open={dialog !== null}
        title={dialog ? dialogTitles[dialog] : ''}
        okText="确定"
        cancelText="取消"
        confirmLoading={busy}
        onOk={handleConfirmDialog}
        onCancel={() => setDialog(null)}
        destroyOnHidden
      >
        {dialog === 'status' ? (
          <Select
            style={{ width: '100%' }}
            value={statusValue}
            onChange={setStatusValue}
            options={TASK_STATUSES.map((status) => ({
              label: TASK_STATUS_LABELS[status].label,
              value: status,
            }))}
          />
        ) : null}
        {dialog === 'priority' ? (
          <Select
            style={{ width: '100%' }}
            value={priorityValue}
            onChange={setPriorityValue}
            options={TASK_PRIORITIES.map((priority) => ({
              label: TASK_PRIORITY_LABELS[priority].label,
              value: priority,
            }))}
          />
        ) : null}
        {dialog === 'project' ? (
          <Select
            style={{ width: '100%' }}
            value={projectValue}
            onChange={setProjectValue}
            allowClear
            placeholder="不归属任何项目"
            options={projects
              .filter((project) => project.archivedAt === null)
              .map((project) => ({ label: project.name, value: project.id }))}
          />
        ) : null}
        {dialog === 'tag' ? (
          <Select
            style={{ width: '100%' }}
            value={tagValue}
            onChange={setTagValue}
            placeholder={tags.length === 0 ? '还没有标签，请先在任务编辑里创建' : '选择标签'}
            options={tags.map((tag) => ({ label: tag.name, value: tag.id }))}
          />
        ) : null}
      </Modal>
    </div>
  );
}
