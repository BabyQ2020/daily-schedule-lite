import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { App, Button, Card, DatePicker, Input, Select, Space } from 'antd';
import dayjs from 'dayjs';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';

import { PageContainer } from '@/components/PageContainer';
import { EmptyState } from '@/components/states/EmptyState';
import { LoadingState } from '@/components/states/LoadingState';
import type { Id, WorkLog } from '@/domain/types';
import { LogFormDrawer } from '@/features/logs/LogFormDrawer';
import { LogList } from '@/features/logs/LogList';
import { hasActiveLogFilters, toLogFilter, useLogQueryStore } from '@/features/logs/filters';
import { deleteLog, queryLogs } from '@/services/logs/service';
import { listProjects, listTags, listTasks } from '@/services/lookups';

interface LogPageData {
  result: { items: WorkLog[]; total: number; page: number; pageSize: number; totalPages: number };
  projectNames: Map<Id, string>;
  taskNames: Map<Id, string>;
  tagNames: Map<Id, string>;
}

export function LogsPage() {
  const { message } = App.useApp();
  const query = useLogQueryStore();
  const [keywordInput, setKeywordInput] = useState(query.keyword);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<Id | null>(null);

  const activeFilters = hasActiveLogFilters(query);

  const projects = useLiveQuery(() => listProjects({ archived: 'all' }), [], []);
  const tags = useLiveQuery(() => listTags(), [], []);

  const data = useLiveQuery(
    async (): Promise<LogPageData> => {
      const filter = toLogFilter(query);
      const [result, projectList, taskList, tagList] = await Promise.all([
        queryLogs(filter, { page: query.page, pageSize: query.pageSize }),
        listProjects({ archived: 'all' }),
        listTasks({ archived: 'all' }),
        listTags(),
      ]);
      return {
        result,
        projectNames: new Map(projectList.map((project) => [project.id, project.name])),
        taskNames: new Map(taskList.map((task) => [task.id, task.title])),
        tagNames: new Map(tagList.map((tag) => [tag.id, tag.name])),
      };
    },
    [
      query.keyword,
      query.projectId,
      query.taskId,
      query.tagId,
      query.dateFrom,
      query.dateTo,
      query.page,
      query.pageSize,
    ],
    undefined,
  );

  // 搜索框防抖，避免每个按键都触发一次全表匹配。
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (keywordInput !== query.keyword) {
        query.patch({ keyword: keywordInput });
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [keywordInput, query]);

  const openCreate = () => {
    setEditingId(null);
    setFormOpen(true);
  };

  const openEdit = (log: WorkLog) => {
    setEditingId(log.id);
    setFormOpen(true);
  };

  const handleDelete = async (log: WorkLog) => {
    try {
      await deleteLog(log.id);
      message.success('日志已删除');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除日志失败，请稍后重试。');
    }
  };

  const resetFilters = () => {
    setKeywordInput('');
    query.reset();
  };

  const total = data?.result.total ?? 0;

  return (
    <PageContainer
      title="工作日志"
      description="记录每天做了什么、遇到什么、怎么解决，可按日期、项目、任务、标签和关键词查找。"
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建日志
        </Button>
      }
    >
      <Card className="toolbar-card" size="small">
        <Space size={[12, 12]} wrap>
          <Input.Search
            value={keywordInput}
            allowClear
            placeholder="搜索标题、正文、心得、问题、解决方案、标签"
            aria-label="搜索日志"
            onChange={(event) => {
              setKeywordInput(event.target.value);
            }}
            onSearch={(value) => {
              query.patch({ keyword: value });
            }}
            style={{ width: 300 }}
          />

          <Select
            allowClear
            placeholder="全部项目"
            aria-label="按项目筛选"
            style={{ width: 160 }}
            value={query.projectId ?? undefined}
            onChange={(value?: Id) => {
              query.patch({ projectId: value ?? 'all' });
            }}
            options={projects.map((project) => ({ value: project.id, label: project.name }))}
          />

          <Select
            allowClear
            placeholder="全部标签"
            aria-label="按标签筛选"
            style={{ width: 160 }}
            value={query.tagId ?? undefined}
            onChange={(value?: Id) => {
              query.patch({ tagId: value ?? 'all' });
            }}
            options={tags.map((tag) => ({ value: tag.id, label: tag.name }))}
          />

          <DatePicker.RangePicker
            aria-label="按日期筛选"
            value={
              query.dateFrom && query.dateTo ? [dayjs(query.dateFrom), dayjs(query.dateTo)] : null
            }
            onChange={(range) => {
              query.patch({
                dateFrom: range?.[0]?.format('YYYY-MM-DD') ?? null,
                dateTo: range?.[1]?.format('YYYY-MM-DD') ?? null,
              });
            }}
          />

          <Button icon={<ReloadOutlined />} onClick={resetFilters} disabled={!activeFilters}>
            清除筛选
          </Button>

          {data ? <span className="toolbar-hint">共 {total} 条日志</span> : null}
        </Space>
      </Card>

      <Card size="small" styles={{ body: { padding: 0 } }}>
        {data === undefined ? (
          <div style={{ padding: 24 }}>
            <LoadingState tip="正在读取日志…" />
          </div>
        ) : total === 0 ? (
          activeFilters ? (
            <EmptyState
              title="没有匹配的日志"
              description="换个关键词，或清除筛选条件再试。"
              actions={
                <Button icon={<ReloadOutlined />} onClick={resetFilters}>
                  清除筛选
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="还没有工作日志"
              description="先把今天做的事记下来，后面写日报、周报会轻松很多。"
              actions={
                <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                  写第一条日志
                </Button>
              }
            />
          )
        ) : (
          <LogList
            logs={data.result.items}
            keyword={keywordInput}
            projectNames={data.projectNames}
            taskNames={data.taskNames}
            tagNames={data.tagNames}
            total={data.result.total}
            page={data.result.page}
            pageSize={data.result.pageSize}
            onPageChange={(page) => {
              query.setPage(page);
            }}
            onEdit={openEdit}
            onDelete={(log) => {
              void handleDelete(log);
            }}
          />
        )}
      </Card>

      <LogFormDrawer
        open={formOpen}
        logId={editingId}
        onClose={() => {
          setFormOpen(false);
        }}
        onSaved={() => {
          setFormOpen(false);
        }}
      />
    </PageContainer>
  );
}
