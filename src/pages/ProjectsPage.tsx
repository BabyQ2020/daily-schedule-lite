import {
  App,
  Button,
  Card,
  Dropdown,
  Input,
  Progress,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';

import { EmptyState } from '@/components/states/EmptyState';
import { LoadingState } from '@/components/states/LoadingState';
import { PageContainer } from '@/components/PageContainer';
import { PROJECT_STATUS_LABELS } from '@/domain/labels';
import type { Id, Project, ProjectStatus } from '@/domain/types';
import { PROJECT_STATUSES } from '@/domain/types';
import { ProjectDetailDrawer } from '@/features/projects/ProjectDetailDrawer';
import { ProjectFormModal } from '@/features/projects/ProjectFormModal';
import {
  archiveProject,
  deleteProject,
  listProjects,
  restoreProject,
} from '@/services/projects/service';
import { listTags } from '@/services/lookups';
import { loadProjectProgress } from '@/services/stats/project-progress';

type ArchivedFilter = 'active' | 'archived' | 'all';

const ARCHIVED_OPTIONS: { label: string; value: ArchivedFilter }[] = [
  { label: '进行中', value: 'active' },
  { label: '已归档', value: 'archived' },
  { label: '全部', value: 'all' },
];

export function ProjectsPage() {
  const { message, modal } = App.useApp();
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<ProjectStatus | 'all'>('all');
  const [archived, setArchived] = useState<ArchivedFilter>('active');
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<Id | null>(null);
  const [detailId, setDetailId] = useState<Id | null>(null);

  const projects = useLiveQuery(() => listProjects({ archived: 'all' }), []);
  const progressMap = useLiveQuery(() => loadProjectProgress(), []);
  const tags = useLiveQuery(() => listTags(), []);

  const tagNameById = useMemo(() => {
    const map = new Map<Id, string>();
    for (const tag of tags ?? []) {
      map.set(tag.id, tag.name);
    }
    return map;
  }, [tags]);

  const filtered = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    return (projects ?? [])
      .filter((project) => {
        if (archived === 'active' && project.archivedAt !== null) {
          return false;
        }
        if (archived === 'archived' && project.archivedAt === null) {
          return false;
        }
        if (status !== 'all' && project.status !== status) {
          return false;
        }
        if (normalized.length === 0) {
          return true;
        }
        return `${project.name} ${project.description}`.toLowerCase().includes(normalized);
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [projects, archived, status, keyword]);

  const openCreate = () => {
    setEditingId(null);
    setFormOpen(true);
  };

  const openEdit = (project: Project) => {
    setEditingId(project.id);
    setFormOpen(true);
  };

  const handleArchive = async (project: Project, nextArchived: boolean) => {
    try {
      if (nextArchived) {
        await archiveProject(project.id);
        message.success('项目已归档');
      } else {
        await restoreProject(project.id);
        message.success('项目已恢复');
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败');
    }
  };

  const handleDelete = (project: Project) => {
    modal.confirm({
      title: `删除项目「${project.name}」？`,
      content: '项目本身会被永久删除；若项目下还有任务，将不允许删除，请先改派或改为归档。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteProject(project.id);
          message.success('项目已删除');
        } catch (error) {
          message.error(error instanceof Error ? error.message : '删除失败');
        }
      },
    });
  };

  const columns: ColumnsType<Project> = [
    {
      title: '项目',
      dataIndex: 'name',
      key: 'name',
      width: 300,
      render: (_, project) => (
        <Space direction="vertical" size={2}>
          <Space size={6} wrap>
            <Typography.Link onClick={() => setDetailId(project.id)}>
              {project.name}
            </Typography.Link>
            {project.archivedAt ? <Tag>已归档</Tag> : null}
            {project.tags.slice(0, 2).map((tagId) => (
              <Tag key={tagId} bordered={false}>
                {tagNameById.get(tagId) ?? tagId}
              </Tag>
            ))}
            {project.tags.length > 2 ? (
              <Tag bordered={false}>+{project.tags.length - 2}</Tag>
            ) : null}
          </Space>
          {project.description ? (
            <Typography.Text type="secondary" style={{ maxWidth: 280 }} ellipsis>
              {project.description}
            </Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 96,
      render: (value: ProjectStatus) => (
        <Tag color={PROJECT_STATUS_LABELS[value].color}>{PROJECT_STATUS_LABELS[value].label}</Tag>
      ),
    },
    {
      title: '进度',
      key: 'progress',
      width: 200,
      render: (_, project) => {
        const progress = progressMap?.get(project.id);
        if (!progress || progress.percent === null) {
          return <Typography.Text type="secondary">—</Typography.Text>;
        }
        return (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <Progress percent={progress.percent} size="small" />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              已完成 {progress.done} / {progress.counted}
            </Typography.Text>
          </Space>
        );
      },
    },
    {
      title: '起止日期',
      key: 'dates',
      width: 200,
      render: (_, project) =>
        project.startDate || project.endDate ? (
          <Typography.Text type="secondary">
            {project.startDate ?? '—'} ~ {project.endDate ?? '—'}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 190,
      render: (_, project) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => setDetailId(project.id)}>
            详情
          </Button>
          <Button type="link" size="small" onClick={() => openEdit(project)}>
            编辑
          </Button>
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                {
                  key: 'archive',
                  label: project.archivedAt ? '恢复归档' : '归档',
                },
                { key: 'delete', label: '删除', danger: true },
              ],
              onClick: ({ key }) => {
                if (key === 'archive') {
                  void handleArchive(project, project.archivedAt === null);
                } else if (key === 'delete') {
                  handleDelete(project);
                }
              },
            }}
          >
            <Button type="link" size="small">
              更多
            </Button>
          </Dropdown>
        </Space>
      ),
    },
  ];

  const loading = projects === undefined || progressMap === undefined;
  const hasFilters = keyword.trim().length > 0 || status !== 'all' || archived !== 'active';

  return (
    <PageContainer
      title="项目管理"
      description="统一管理长期项目的状态、里程碑、风险与关联任务；进度按完成任务数自动计算。"
      extra={
        <Button type="primary" onClick={openCreate}>
          新建项目
        </Button>
      }
    >
      <Card className="toolbar-card" styles={{ body: { padding: 12 } }}>
        <Space wrap size={12}>
          <Input.Search
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索项目名称或描述"
            allowClear
            style={{ width: 260 }}
            aria-label="搜索项目"
          />
          <Segmented
            value={archived}
            onChange={(value) => setArchived(value as ArchivedFilter)}
            options={ARCHIVED_OPTIONS}
            aria-label="归档状态"
          />
          <Select
            value={status}
            onChange={setStatus}
            style={{ width: 140 }}
            aria-label="项目状态"
            options={[
              { label: '全部状态', value: 'all' },
              ...PROJECT_STATUSES.map((item) => ({
                label: PROJECT_STATUS_LABELS[item].label,
                value: item,
              })),
            ]}
          />
          {hasFilters ? (
            <Button
              type="link"
              onClick={() => {
                setKeyword('');
                setStatus('all');
                setArchived('active');
              }}
            >
              清除筛选
            </Button>
          ) : null}
        </Space>
      </Card>

      <Card styles={{ body: { padding: loading ? 24 : 0 } }}>
        {loading ? (
          <LoadingState tip="正在加载项目" />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={hasFilters ? '没有匹配的项目' : '还没有项目'}
            description={
              hasFilters
                ? '试试更换关键词、状态或归档范围。'
                : '项目用来承载长期目标，可挂里程碑、风险与关联任务。'
            }
            actions={
              hasFilters ? (
                <Button
                  onClick={() => {
                    setKeyword('');
                    setStatus('all');
                    setArchived('active');
                  }}
                >
                  清除筛选
                </Button>
              ) : (
                <Button type="primary" onClick={openCreate}>
                  新建项目
                </Button>
              )
            }
          />
        ) : (
          <Table<Project>
            rowKey="id"
            columns={columns}
            dataSource={filtered}
            pagination={{
              pageSize: 20,
              showSizeChanger: true,
              pageSizeOptions: [20, 50, 100],
              showTotal: (total) => `共 ${total} 个项目`,
            }}
            scroll={{ x: 1000 }}
          />
        )}
      </Card>

      <ProjectFormModal
        open={formOpen}
        projectId={editingId}
        onClose={() => setFormOpen(false)}
        onSaved={(project) => setEditingId(project.id)}
      />
      <ProjectDetailDrawer
        open={detailId !== null}
        projectId={detailId}
        onClose={() => setDetailId(null)}
      />
    </PageContainer>
  );
}

export default ProjectsPage;
