import { useState } from 'react';
import {
  App as AntApp,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag as AntTag,
  Typography,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useLiveQuery } from 'dexie-react-hooks';

import type { Tag, TagKind } from '@/domain/types';
import { TAG_KIND_LABELS } from '@/domain/labels';
import {
  countTagUsage,
  createTag,
  deleteTag,
  listTags,
  updateTag,
  type TagUsage,
} from '@/services/tags/service';
import { useDataRefreshStore } from '@/features/system/data-refresh';

const { Text } = Typography;

const TAG_COLORS = [
  '#2563eb',
  '#16a34a',
  '#d97706',
  '#dc2626',
  '#7c3aed',
  '#0891b2',
  '#db2777',
  '#475569',
] as const;

interface TagRow {
  tag: Tag;
  usage: TagUsage;
}

interface TagFormValues {
  name: string;
  kind: TagKind;
  color: string;
}

const KIND_OPTIONS = (Object.keys(TAG_KIND_LABELS) as TagKind[]).map((kind) => ({
  value: kind,
  label: TAG_KIND_LABELS[kind],
}));

async function loadTagRows(): Promise<TagRow[]> {
  const tags = await listTags('all');
  const rows = await Promise.all(
    tags.map(async (tag) => ({ tag, usage: await countTagUsage(tag.id) })),
  );
  return rows.sort((left, right) => left.tag.name.localeCompare(right.tag.name, 'zh-CN'));
}

/** 标签管理：重命名、改颜色/类型、查看引用次数、删除并同步清理引用。 */
export function TagManagerCard() {
  const { message } = AntApp.useApp();
  const bump = useDataRefreshStore((state) => state.bump);
  const [editing, setEditing] = useState<Tag | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<TagFormValues>();

  const rows = useLiveQuery(() => loadTagRows(), []);

  function openCreate() {
    setEditing(null);
    form.setFieldsValue({ name: '', kind: 'general', color: TAG_COLORS[0] });
    setModalOpen(true);
  }

  function openEdit(tag: Tag) {
    setEditing(tag);
    form.setFieldsValue({ name: tag.name, kind: tag.kind, color: tag.color });
    setModalOpen(true);
  }

  async function handleSubmit() {
    const values = await form.validateFields();
    setSaving(true);
    try {
      if (editing) {
        await updateTag(editing.id, values);
        message.success('标签已更新');
      } else {
        await createTag(values);
        message.success('标签已创建');
      }
      setModalOpen(false);
      bump();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(tag: Tag) {
    try {
      await deleteTag(tag.id);
      bump();
      message.success(`标签「${tag.name}」已删除，并从相关记录中移除`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除失败');
    }
  }

  function usageText(usage: TagUsage): string {
    const parts = [
      usage.tasks > 0 ? `任务 ${usage.tasks}` : null,
      usage.projects > 0 ? `项目 ${usage.projects}` : null,
      usage.logs > 0 ? `日志 ${usage.logs}` : null,
    ].filter((part): part is string => part !== null);
    return parts.length === 0 ? '未使用' : parts.join(' · ');
  }

  return (
    <Card
      title="标签管理"
      size="small"
      extra={
        <Button size="small" icon={<PlusOutlined />} onClick={openCreate}>
          新建标签
        </Button>
      }
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Text type="secondary">
          任务、项目、日志表单里输入的新标签也会自动出现在这里。删除标签会从所有记录上摘除，但不会删除记录本身。
        </Text>
        {rows && rows.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="还没有标签，可以直接新建，或在表单里随手输入"
          />
        ) : (
          <Table<TagRow>
            rowKey={(row) => row.tag.id}
            size="small"
            pagination={false}
            dataSource={rows ?? []}
            loading={rows === undefined}
            columns={[
              {
                title: '名称',
                dataIndex: ['tag', 'name'],
                render: (_, row) => (
                  <Space size={6}>
                    <span
                      className="tag-dot"
                      style={{ background: row.tag.color }}
                      aria-hidden="true"
                    />
                    <span>{row.tag.name}</span>
                  </Space>
                ),
              },
              {
                title: '类型',
                dataIndex: ['tag', 'kind'],
                width: 120,
                render: (_, row) => <AntTag>{TAG_KIND_LABELS[row.tag.kind]}</AntTag>,
              },
              {
                title: '使用情况',
                width: 200,
                render: (_, row) => <Text type="secondary">{usageText(row.usage)}</Text>,
              },
              {
                title: '操作',
                width: 140,
                render: (_, row) => (
                  <Space size={4}>
                    <Button type="link" size="small" onClick={() => openEdit(row.tag)}>
                      编辑
                    </Button>
                    <Popconfirm
                      title="删除标签"
                      description={`「${row.tag.name}」会从 ${usageText(row.usage)} 上移除，此操作不可撤销。`}
                      okText="删除"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => void handleDelete(row.tag)}
                    >
                      <Button type="link" size="small" danger>
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Space>

      <Modal
        open={modalOpen}
        title={editing ? '编辑标签' : '新建标签'}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        onOk={() => void handleSubmit()}
        onCancel={() => setModalOpen(false)}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="name"
            label="名称"
            rules={[
              { required: true, whitespace: true, message: '请输入标签名称' },
              { max: 24, message: '标签名称最多 24 个字符' },
            ]}
          >
            <Input placeholder="例如：离线、前端" autoFocus />
          </Form.Item>
          <Form.Item name="kind" label="类型" rules={[{ required: true }]}>
            <Select options={KIND_OPTIONS} />
          </Form.Item>
          <Form.Item name="color" label="颜色" rules={[{ required: true }]}>
            <Select
              options={TAG_COLORS.map((color) => ({
                value: color,
                label: (
                  <Space size={6}>
                    <span className="tag-dot" style={{ background: color }} aria-hidden="true" />
                    {color}
                  </Space>
                ),
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
