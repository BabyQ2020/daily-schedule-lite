import { App, DatePicker, Drawer, Form, Input, Select, Space, Spin, Button } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';

import { TASK_PRIORITIES, TASK_STATUSES } from '@/domain/types';
import type { Id, Task, TaskPriority, TaskStatus } from '@/domain/types';
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from '@/domain/labels';
import { TagSelect } from '@/components/TagSelect';
import { createTask, getTask, updateTask } from '@/services/tasks/service';
import { listProjects, listTags } from '@/services/lookups';
import type { Project, Tag } from '@/domain/types';
import { resolveTagIds, tagNamesOf } from '@/services/tagging';

export interface TaskFormDrawerProps {
  open: boolean;
  /** null 表示新建任务。 */
  taskId: Id | null;
  /** 新建时的预填值，例如从某个项目下发起。 */
  defaults?: { projectId?: Id | null; planDate?: string | null };
  onClose: () => void;
  onSaved?: (task: Task) => void;
}

interface TaskFormValues {
  title: string;
  description?: string;
  projectId?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  planDate?: dayjs.Dayjs | null;
  dueDate?: dayjs.Dayjs | null;
  tags?: string[];
  note?: string;
}

const EMPTY_VALUES: TaskFormValues = {
  title: '',
  description: '',
  projectId: null,
  status: 'todo',
  priority: 'medium',
  planDate: null,
  dueDate: null,
  tags: [],
  note: '',
};

export function TaskFormDrawer({ open, taskId, defaults, onClose, onSaved }: TaskFormDrawerProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<TaskFormValues>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    let active = true;
    setLoading(true);
    setLoadError(null);

    const prepare = async () => {
      const [projectList, tagList] = await Promise.all([
        listProjects({ archived: 'all' }),
        listTags(),
      ]);
      if (!active) {
        return;
      }
      setProjects(projectList);
      setTags(tagList);

      if (taskId === null) {
        form.setFieldsValue({
          ...EMPTY_VALUES,
          projectId: defaults?.projectId ?? null,
          planDate: defaults?.planDate ? dayjs(defaults.planDate) : null,
        });
        return;
      }

      const task = await getTask(taskId);
      if (!task) {
        throw new Error('任务不存在，可能已被删除。');
      }
      form.setFieldsValue({
        title: task.title,
        description: task.description,
        projectId: task.projectId,
        status: task.status,
        priority: task.priority,
        planDate: task.planDate ? dayjs(task.planDate) : null,
        dueDate: task.dueDate ? dayjs(task.dueDate) : null,
        tags: tagNamesOf(task.tags, tagList),
        note: task.note,
      });
    };

    prepare()
      .catch((error: unknown) => {
        if (active) {
          setLoadError(error instanceof Error ? error.message : '任务加载失败');
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [open, taskId, defaults?.projectId, defaults?.planDate, form]);

  const handleSubmit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const tagIds = await resolveTagIds(values.tags ?? [], 'task');
      const input = {
        title: values.title.trim(),
        description: values.description?.trim() ?? '',
        projectId: values.projectId ?? null,
        status: values.status,
        priority: values.priority,
        planDate: values.planDate ? values.planDate.format('YYYY-MM-DD') : null,
        dueDate: values.dueDate ? values.dueDate.format('YYYY-MM-DD') : null,
        tags: tagIds,
        note: values.note?.trim() ?? '',
      };

      const saved = taskId === null ? await createTask(input) : await updateTask(taskId, input);

      message.success(taskId === null ? '任务已创建' : '任务已保存');
      onSaved?.(saved);
      onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const title = taskId === null ? '新建任务' : '编辑任务';

  return (
    <Drawer
      open={open}
      title={title}
      width={560}
      onClose={onClose}
      destroyOnHidden
      footer={
        <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={handleSubmit}>
            保存
          </Button>
        </Space>
      }
    >
      {loadError ? (
        <p role="alert" style={{ color: '#dc2626' }}>
          {loadError}
        </p>
      ) : null}
      <Spin spinning={loading}>
        <Form form={form} layout="vertical" initialValues={EMPTY_VALUES} requiredMark="optional">
          <Form.Item
            name="title"
            label="标题"
            rules={[
              { required: true, message: '请填写任务标题' },
              { max: 120, message: '标题不超过 120 个字符' },
            ]}
          >
            <Input placeholder="例如：完成季度预算复核" autoFocus maxLength={120} />
          </Form.Item>

          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} maxLength={2000} showCount placeholder="补充背景、验收标准" />
          </Form.Item>

          <Form.Item name="projectId" label="所属项目">
            <Select
              allowClear
              placeholder="不归属任何项目"
              options={projects.map((project) => ({
                label: project.archivedAt ? `${project.name}（已归档）` : project.name,
                value: project.id,
              }))}
            />
          </Form.Item>

          <Space.Compact block>
            <Form.Item name="status" label="状态" style={{ flex: 1 }}>
              <Select
                options={TASK_STATUSES.map((status) => ({
                  label: TASK_STATUS_LABELS[status].label,
                  value: status,
                }))}
              />
            </Form.Item>
            <Form.Item name="priority" label="优先级" style={{ flex: 1, marginLeft: 12 }}>
              <Select
                options={TASK_PRIORITIES.map((priority) => ({
                  label: TASK_PRIORITY_LABELS[priority].label,
                  value: priority,
                }))}
              />
            </Form.Item>
          </Space.Compact>

          <Space.Compact block>
            <Form.Item name="planDate" label="计划日期" style={{ flex: 1 }}>
              <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" allowClear />
            </Form.Item>
            <Form.Item
              name="dueDate"
              label="截止日期"
              style={{ flex: 1, marginLeft: 12 }}
              dependencies={['planDate']}
              rules={[
                ({ getFieldValue }) => ({
                  validator(_, value: dayjs.Dayjs | null | undefined) {
                    const planDate = getFieldValue('planDate') as dayjs.Dayjs | null | undefined;
                    if (!value || !planDate || !value.isBefore(planDate, 'day')) {
                      return Promise.resolve();
                    }
                    return Promise.reject(new Error('截止日期不能早于计划日期'));
                  },
                }),
              ]}
            >
              <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" allowClear />
            </Form.Item>
          </Space.Compact>

          <Form.Item name="tags" label="标签" extra="输入新名称后回车即可创建标签">
            <TagSelect options={tags.map((tag) => ({ label: tag.name, value: tag.name }))} />
          </Form.Item>

          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} maxLength={500} showCount placeholder="仅自己可见的补充说明" />
          </Form.Item>
        </Form>
      </Spin>
    </Drawer>
  );
}
