import { useEffect, useRef, useState } from 'react';

import { App, DatePicker, Drawer, Form, Input, Select, Space, Button } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useLiveQuery } from 'dexie-react-hooks';

import { TagSelect } from '@/components/TagSelect';
import type { Id, Task } from '@/domain/types';
import { todayISO } from '@/lib/clock';
import { createLog, getLog, updateLog } from '@/services/logs/service';
import { listProjects, listTags, listTasks } from '@/services/lookups';
import { resolveTagIds } from '@/services/tagging';

export interface LogFormDrawerProps {
  open: boolean;
  logId: Id | null;
  defaults?: { date?: string; projectId?: Id | null; taskId?: Id | null };
  onClose: () => void;
  onSaved: () => void;
}

interface FormValues {
  date: Dayjs;
  title: string;
  content?: string;
  insight?: string;
  problem?: string;
  solution?: string;
  projectId?: Id | null;
  taskId?: Id | null;
  tags?: string[];
}

export function LogFormDrawer({ open, logId, defaults, onClose, onSaved }: LogFormDrawerProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const [saving, setSaving] = useState(false);

  const options = useLiveQuery(
    async () => {
      const [projects, tags, tasks] = await Promise.all([
        listProjects({ archived: 'all' }),
        listTags(),
        listTasks({ archived: 'active' }),
      ]);
      return { projects, tags, tasks };
    },
    [],
    { projects: [], tags: [], tasks: [] as Task[] },
  );

  // 标签 id → 名称的映射放进 ref：既能让回填逻辑读到最新标签，又不会因为 liveQuery
  // 每次返回新数组而反复触发回填、覆盖用户正在编辑的表单。
  const tagNamesRef = useRef(new Map<Id, string>());
  tagNamesRef.current = new Map(options.tags.map((tag) => [tag.id, tag.name]));

  useEffect(() => {
    if (!open) {
      return;
    }
    if (logId) {
      let cancelled = false;
      void (async () => {
        const log = await getLog(logId);
        if (cancelled) {
          return;
        }
        if (!log) {
          message.error('这条日志已不存在，可能已被删除。');
          onClose();
          return;
        }
        form.setFieldsValue({
          date: dayjs(log.date),
          title: log.title,
          content: log.content,
          insight: log.insight,
          problem: log.problem,
          solution: log.solution,
          projectId: log.projectId,
          taskId: log.taskId,
          tags: log.tags.flatMap((tagId) => {
            const name = tagNamesRef.current.get(tagId);
            return name ? [name] : [];
          }),
        });
      })();
      return () => {
        cancelled = true;
      };
    }
    form.resetFields();
    form.setFieldsValue({
      date: dayjs(defaults?.date ?? todayISO()),
      projectId: defaults?.projectId ?? null,
      taskId: defaults?.taskId ?? null,
      tags: [],
    });
    return undefined;
  }, [open, logId, defaults?.date, defaults?.projectId, defaults?.taskId, form, message, onClose]);

  const projectId = Form.useWatch('projectId', form);
  const taskOptions = options.tasks.filter((task) => !projectId || task.projectId === projectId);

  async function handleSubmit(): Promise<void> {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const tags = await resolveTagIds(values.tags ?? [], 'log');
      const payload = {
        date: values.date.format('YYYY-MM-DD'),
        title: values.title.trim(),
        content: values.content ?? '',
        insight: values.insight ?? '',
        problem: values.problem ?? '',
        solution: values.solution ?? '',
        projectId: values.projectId ?? null,
        taskId: values.taskId ?? null,
        tags,
      };
      if (logId) {
        await updateLog(logId, payload);
        message.success('日志已保存');
      } else {
        await createLog(payload);
        message.success('日志已创建');
      }
      onSaved();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存日志失败，请稍后重试。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      title={logId ? '编辑日志' : '新建日志'}
      width={640}
      open={open}
      onClose={onClose}
      destroyOnHidden
      extra={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={() => void handleSubmit()}>
            保存
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical" requiredMark="optional">
        <Form.Item name="date" label="日期" rules={[{ required: true, message: '请选择日志日期' }]}>
          <DatePicker style={{ width: 200 }} placeholder="选择日期" />
        </Form.Item>

        <Form.Item
          name="title"
          label="标题"
          rules={[
            { required: true, message: '请填写日志标题' },
            { max: 120, message: '标题最多 120 个字' },
          ]}
        >
          <Input placeholder="一句话概括这条日志" maxLength={120} />
        </Form.Item>

        <Form.Item name="content" label="正文">
          <Input.TextArea rows={6} placeholder="今天做了什么、进展如何" maxLength={4000} />
        </Form.Item>

        <Form.Item name="insight" label="心得">
          <Input.TextArea rows={2} placeholder="有什么体会或规律" maxLength={1000} />
        </Form.Item>

        <Form.Item name="problem" label="问题">
          <Input.TextArea rows={2} placeholder="遇到了什么问题" maxLength={1000} />
        </Form.Item>

        <Form.Item name="solution" label="解决方案">
          <Input.TextArea rows={2} placeholder="怎么解决的，或打算怎么解决" maxLength={1000} />
        </Form.Item>

        <Form.Item name="projectId" label="关联项目">
          <Select
            allowClear
            placeholder="可选"
            options={options.projects.map((project) => ({
              value: project.id,
              label: project.name,
            }))}
            onChange={() => {
              form.setFieldValue('taskId', null);
            }}
          />
        </Form.Item>

        <Form.Item name="taskId" label="关联任务">
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder={projectId ? '可选，已按项目过滤' : '可选'}
            options={taskOptions.map((task) => ({ value: task.id, label: task.title }))}
            notFoundContent="没有可关联的任务"
          />
        </Form.Item>

        <Form.Item name="tags" label="标签">
          <TagSelect options={options.tags.map((tag) => ({ label: tag.name, value: tag.name }))} />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
