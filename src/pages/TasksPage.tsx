import { App, Button, Card, DatePicker, Empty, Input, Segmented, Select, Space } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';

import { PageContainer } from '@/components/PageContainer';
import { EmptyState } from '@/components/states/EmptyState';
import { LoadingState } from '@/components/states/LoadingState';
import { TASK_PRIORITIES, TASK_STATUSES } from '@/domain/types';
import type { Id, Task } from '@/domain/types';
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from '@/domain/labels';
import {
  archiveTasks,
  deleteTasks,
  queryTasks,
  setTaskStatus,
  unarchiveTasks,
} from '@/services/tasks/service';
import type { TaskSortKey } from '@/services/tasks/service';
import { listProjects, listTags } from '@/services/lookups';
import { todayISO } from '@/lib/clock';
import { loadTaskOverview } from '@/services/stats/project-progress';
import { TaskBatchBar } from '@/features/tasks/TaskBatchBar';
import { TaskFormDrawer } from '@/features/tasks/TaskFormDrawer';
import { TaskTable } from '@/features/tasks/TaskTable';
import {
  hasActiveFilters,
  toTaskFilter,
  toTaskSort,
  useTaskQueryStore,
} from '@/features/tasks/filters';

const SORT_OPTIONS: { label: string; value: string }[] = [
  { label: '最近更新', value: 'updatedAt:desc' },
  { label: '最新创建', value: 'createdAt:desc' },
  { label: '截止日期（近→远）', value: 'dueDate:asc' },
  { label: '计划日期（近→远）', value: 'planDate:asc' },
  { label: '优先级（高→低）', value: 'priority:desc' },
  { label: '标题（A→Z）', value: 'title:asc' },
];

export function TasksPage() {
  const { message, modal } = App.useApp();
  const query = useTaskQueryStore();
  const today = useMemo(() => todayISO(), []);
  const [selectedIds, setSelectedIds] = useState<Id[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<Id | null>(null);
  const [keywordInput, setKeywordInput] = useState(query.keyword);

  const activeFilters = hasActiveFilters(query);

  const projects = useLiveQuery(() => listProjects({ archived: 'all' }), []);
  const tags = useLiveQuery(() => listTags(), []);
  const overview = useLiveQuery(() => loadTaskOverview(today), [today]);

  const result = useLiveQuery(
    () =>
      queryTasks(toTaskFilter(query), toTaskSort(query), {
        page: query.page,
        pageSize: query.pageSize,
      }),
    [
      query.keyword,
      query.projectId,
      query.status,
      query.priorities,
      query.tagId,
      query.dueFrom,
      query.dueTo,
      query.archived,
      query.sortKey,
      query.sortDirection,
      query.page,
      query.pageSize,
    ],
    undefined,
  );

  // 输入防抖：避免每个按键都触发一次全表扫描。
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (keywordInput !== query.keyword) {
        query.patch({ keyword: keywordInput });
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [keywordInput, query]);

  // 筛选变化后旧的选中项可能已不在列表中，直接清空，避免批量操作误伤不可见任务。
  useEffect(() => {
    setSelectedIds([]);
  }, [
    query.keyword,
    query.projectId,
    query.status,
    query.priorities,
    query.tagId,
    query.dueFrom,
    query.dueTo,
    query.archived,
    query.page,
    query.pageSize,
  ]);

  const openCreate = () => {
    setEditingId(null);
    setDrawerOpen(true);
  };

  const openEdit = (task: Task) => {
    setEditingId(task.id);
    setDrawerOpen(true);
  };

  const handleToggleDone = async (task: Task) => {
    try {
      const next = task.status === 'done' ? 'todo' : 'done';
      await setTaskStatus(task.id, next);
      message.success(next === 'done' ? '任务已完成' : '任务已重新打开');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败');
    }
  };

  const handleToggleArchive = async (task: Task) => {
    try {
      if (task.archivedAt) {
        await unarchiveTasks([task.id]);
        message.success('任务已恢复');
      } else {
        await archiveTasks([task.id]);
        message.success('任务已归档');
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败');
    }
  };

  const handleDelete = (task: Task) => {
    modal.confirm({
      title: `删除任务「${task.title}」？`,
      content: '删除后不可恢复；关联的工作日志会保留任务标题快照。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const result = await deleteTasks([task.id]);
        message.success(
          result.detachedLogs > 0
            ? `任务已删除，${result.detachedLogs} 条日志转为无任务关联`
            : '任务已删除',
        );
      },
    });
  };

  const loading = projects === undefined || tags === undefined || result === undefined;
  const items = result?.items ?? [];
  const total = result?.total ?? 0;

  return (
    <PageContainer
      title="全部任务"
      description="按项目、状态、标签、日期组合筛选，批量完成任务或归档。"
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建任务
        </Button>
      }
    >
      <Card size="small" className="toolbar-card">
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space size={8} wrap style={{ width: '100%' }}>
            <Input.Search
              allowClear
              placeholder="搜索标题、描述、备注、标签"
              value={keywordInput}
              onChange={(event) => setKeywordInput(event.target.value)}
              onSearch={(value) => query.patch({ keyword: value })}
              style={{ width: 280 }}
              aria-label="搜索任务"
            />
            <Segmented
              value={query.archived}
              onChange={(value) =>
                query.patch({ archived: value as 'active' | 'archived' | 'all' })
              }
              options={[
                { label: '进行中', value: 'active' },
                { label: '已归档', value: 'archived' },
                { label: '全部', value: 'all' },
              ]}
            />
            <Select
              value={query.projectId ?? 'all'}
              onChange={(value) => query.patch({ projectId: value })}
              style={{ width: 170 }}
              aria-label="按项目筛选"
              options={[
                { label: '全部项目', value: 'all' },
                { label: '无项目', value: 'none' },
                ...(projects ?? []).map((project) => ({
                  label: project.archivedAt ? `${project.name}（已归档）` : project.name,
                  value: project.id,
                })),
              ]}
            />
            <Select
              value={query.status}
              onChange={(value) => query.patch({ status: value })}
              style={{ width: 130 }}
              aria-label="按状态筛选"
              options={[
                { label: '全部状态', value: 'all' },
                ...TASK_STATUSES.map((status) => ({
                  label: TASK_STATUS_LABELS[status].label,
                  value: status,
                })),
              ]}
            />
            <Select
              mode="multiple"
              allowClear
              value={[...query.priorities]}
              onChange={(value) => query.patch({ priorities: value })}
              style={{ width: 170 }}
              placeholder="优先级"
              maxTagCount="responsive"
              aria-label="按优先级筛选"
              options={TASK_PRIORITIES.map((priority) => ({
                label: TASK_PRIORITY_LABELS[priority].label,
                value: priority,
              }))}
            />
            <Select
              value={query.tagId}
              onChange={(value) => query.patch({ tagId: value })}
              style={{ width: 150 }}
              placeholder="标签"
              aria-label="按标签筛选"
              options={[
                { label: '全部标签', value: 'all' },
                ...(tags ?? []).map((tag) => ({ label: tag.name, value: tag.id })),
              ]}
            />
            <DatePicker.RangePicker
              value={
                query.dueFrom && query.dueTo ? [dayjs(query.dueFrom), dayjs(query.dueTo)] : null
              }
              onChange={(dates) =>
                query.patch({
                  dueFrom: dates?.[0] ? dates[0].format('YYYY-MM-DD') : null,
                  dueTo: dates?.[1] ? dates[1].format('YYYY-MM-DD') : null,
                })
              }
              placeholder={['截止日期从', '到']}
              style={{ width: 250 }}
              aria-label="按截止日期筛选"
            />
            <Select
              value={`${query.sortKey}:${query.sortDirection}`}
              onChange={(value) => {
                const [key, direction] = value.split(':') as [TaskSortKey, 'asc' | 'desc'];
                query.setSort(key, direction);
              }}
              style={{ width: 190 }}
              aria-label="排序方式"
              options={SORT_OPTIONS}
            />
            {activeFilters ? (
              <Button
                icon={<ReloadOutlined />}
                onClick={() => {
                  setKeywordInput('');
                  query.reset();
                }}
              >
                清除筛选
              </Button>
            ) : null}
          </Space>

          <Space size={16} wrap>
            <span>
              共 <strong>{overview?.total ?? 0}</strong> 个任务
            </span>
            <span>
              进行中 <strong>{overview?.active ?? 0}</strong>
            </span>
            <span>
              已完成 <strong>{overview?.done ?? 0}</strong>
            </span>
            <span style={{ color: (overview?.overdue ?? 0) > 0 ? '#dc2626' : undefined }}>
              逾期 <strong>{overview?.overdue ?? 0}</strong>
            </span>
          </Space>
        </Space>
      </Card>

      {selectedIds.length > 0 ? (
        <TaskBatchBar
          ids={selectedIds}
          projects={projects ?? []}
          tags={tags ?? []}
          viewingArchived={query.archived === 'archived'}
          onDone={() => setSelectedIds([])}
          onClear={() => setSelectedIds([])}
        />
      ) : null}

      <Card size="small" styles={{ body: { padding: 0 } }}>
        {loading ? (
          <LoadingState tip="正在读取任务…" />
        ) : (
          <TaskTable
            tasks={items}
            loading={false}
            total={total}
            page={query.page}
            pageSize={query.pageSize}
            sortKey={query.sortKey}
            sortDirection={query.sortDirection}
            selectedIds={selectedIds}
            projects={projects ?? []}
            tags={tags ?? []}
            today={today}
            emptyText={
              activeFilters ? (
                <Empty description="没有匹配的任务，试着放宽筛选条件" />
              ) : (
                <EmptyState
                  title="还没有任务"
                  description="先记下第一件要做的事，之后可以再归到项目下。"
                  actions={
                    <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                      新建任务
                    </Button>
                  }
                />
              )
            }
            onSelectionChange={setSelectedIds}
            onPageChange={(page) => query.setPage(page)}
            onPageSizeChange={(pageSize) => query.setPageSize(pageSize)}
            onSortChange={(key, direction) => query.setSort(key, direction)}
            onEdit={openEdit}
            onToggleDone={(task) => void handleToggleDone(task)}
            onToggleArchive={(task) => void handleToggleArchive(task)}
            onDelete={handleDelete}
          />
        )}
      </Card>

      <TaskFormDrawer
        open={drawerOpen}
        taskId={editingId}
        onClose={() => setDrawerOpen(false)}
        onSaved={() => setSelectedIds([])}
      />
    </PageContainer>
  );
}
