import { App, DatePicker, Form, Input, Modal, Select, Space } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';

import { PROJECT_STATUSES } from '@/domain/types';
import type { Id, Project, ProjectStatus } from '@/domain/types';
import { PROJECT_STATUS_LABELS } from '@/domain/labels';
import { TagSelect } from '@/components/TagSelect';
import { createProject, getProject, updateProject } from '@/services/projects/service';
import { listTags } from '@/services/lookups';
import { resolveTagIds, tagNamesOf } from '@/services/tagging';

export interface ProjectFormModalProps {
  open: boolean;
  projectId: Id | null;
  onClose: () => void;
  onSaved?: (project: Project) => void;
}

interface ProjectFormValues {
  name: string;
  description?: string;
  status: ProjectStatus;
  startDate?: dayjs.Dayjs | null;
  endDate?: dayjs.Dayjs | null;
  tags?: string[];
}

const EMPTY_VALUES: ProjectFormValues = {
  name: '',
  description: '',
  status: 'active',
  startDate: null,
  endDate: null,
  tags: [],
};

export function ProjectFormModal({ open, projectId, onClose, onSaved }: ProjectFormModalProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<ProjectFormValues>();
  const [saving, setSaving] = useState(false);
  const [tagOptions, setTagOptions] = useState<{ label: string; value: string }[]>([]);

  useEffect(() => {
    if (!open) {
      return;
    }
    let active = true;

    const prepare = async () => {
      const tags = await listTags();
      if (!active) {
        return;
      }
      setTagOptions(tags.map((tag) => ({ label: tag.name, value: tag.name })));

      if (projectId === null) {
        form.setFieldsValue(EMPTY_VALUES);
        return;
      }
      const project = await getProject(projectId);
      if (!project) {
        throw new Error('项目不存在，可能已被删除。');
      }
      form.setFieldsValue({
        name: project.name,
        description: project.description,
        status: project.status,
        startDate: project.startDate ? dayjs(project.startDate) : null,
        endDate: project.endDate ? dayjs(project.endDate) : null,
        tags: tagNamesOf(project.tags, tags),
      });
    };

    prepare().catch((error: unknown) => {
      if (active) {
        message.error(error instanceof Error ? error.message : '项目加载失败');
      }
    });

    return () => {
      active = false;
    };
  }, [open, projectId, form, message]);

  const handleSubmit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const tagIds = await resolveTagIds(values.tags ?? [], 'project');
      const input = {
        name: values.name.trim(),
        description: values.description?.trim() ?? '',
        status: values.status,
        startDate: values.startDate ? values.startDate.format('YYYY-MM-DD') : null,
        endDate: values.endDate ? values.endDate.format('YYYY-MM-DD') : null,
        tags: tagIds,
      };
      const saved =
        projectId === null ? await createProject(input) : await updateProject(projectId, input);
      message.success(projectId === null ? '项目已创建' : '项目已保存');
      onSaved?.(saved);
      onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={projectId === null ? '新建项目' : '编辑项目'}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      onOk={handleSubmit}
      onCancel={onClose}
      destroyOnHidden
      width={560}
    >
      <Form form={form} layout="vertical" initialValues={EMPTY_VALUES} requiredMark="optional">
        <Form.Item
          name="name"
          label="项目名称"
          rules={[
            { required: true, message: '请填写项目名称' },
            { max: 80, message: '名称不超过 80 个字符' },
          ]}
        >
          <Input placeholder="例如：2026 年度预算体系重构" autoFocus maxLength={80} />
        </Form.Item>

        <Form.Item name="description" label="项目描述">
          <Input.TextArea rows={3} maxLength={2000} showCount placeholder="目标、范围、交付物" />
        </Form.Item>

        <Form.Item name="status" label="状态">
          <Select
            options={PROJECT_STATUSES.filter((status) => status !== 'archived').map((status) => ({
              label: PROJECT_STATUS_LABELS[status].label,
              value: status,
            }))}
            placeholder="归档请用列表里的「归档」操作"
          />
        </Form.Item>

        <Space.Compact block>
          <Form.Item name="startDate" label="开始日期" style={{ flex: 1 }}>
            <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" allowClear />
          </Form.Item>
          <Form.Item
            name="endDate"
            label="结束日期"
            style={{ flex: 1, marginLeft: 12 }}
            dependencies={['startDate']}
            rules={[
              ({ getFieldValue }) => ({
                validator(_, value: dayjs.Dayjs | null | undefined) {
                  const startDate = getFieldValue('startDate') as dayjs.Dayjs | null | undefined;
                  if (!value || !startDate || !value.isBefore(startDate, 'day')) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('结束日期不能早于开始日期'));
                },
              }),
            ]}
          >
            <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" allowClear />
          </Form.Item>
        </Space.Compact>

        <Form.Item name="tags" label="标签" extra="输入新名称后回车即可创建标签">
          <TagSelect options={tagOptions} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
