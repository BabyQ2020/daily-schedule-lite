import { DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { Button, List, Pagination, Popconfirm, Space, Tag, Typography } from 'antd';

import type { Id, WorkLog } from '@/domain/types';

import { HighlightedText, makeSnippet } from './highlight';

export interface LogListProps {
  logs: readonly WorkLog[];
  keyword: string;
  projectNames: ReadonlyMap<Id, string>;
  taskNames: ReadonlyMap<Id, string>;
  tagNames: ReadonlyMap<Id, string>;
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onEdit: (log: WorkLog) => void;
  onDelete: (log: WorkLog) => void;
}

function LogLinkInfo({
  log,
  projectNames,
  taskNames,
  tagNames,
}: Pick<LogListProps, 'projectNames' | 'taskNames' | 'tagNames'> & { log: WorkLog }) {
  const projectName = log.projectId ? projectNames.get(log.projectId) : undefined;
  const taskExists = log.taskId !== null && taskNames.has(log.taskId);
  const taskName = log.taskId
    ? (taskNames.get(log.taskId) ?? log.taskTitleSnapshot)
    : log.taskTitleSnapshot;

  return (
    <Space size={[6, 6]} wrap>
      {projectName ? <Tag color="blue">{projectName}</Tag> : null}
      {taskName ? (
        taskExists ? (
          <Tag>{taskName}</Tag>
        ) : (
          <Tag color="default" className="log-tag--deleted">
            {taskName}（任务已删除）
          </Tag>
        )
      ) : null}
      {log.tags.map((tagId) => {
        const name = tagNames.get(tagId);
        return name ? <Tag key={tagId}>{name}</Tag> : null;
      })}
    </Space>
  );
}

export function LogList({
  logs,
  keyword,
  projectNames,
  taskNames,
  tagNames,
  total,
  page,
  pageSize,
  onPageChange,
  onEdit,
  onDelete,
}: LogListProps) {
  return (
    <>
      <List
        itemLayout="vertical"
        dataSource={[...logs]}
        renderItem={(log) => {
          const snippet = makeSnippet(
            [log.content, log.insight, log.problem, log.solution].join(' '),
            keyword,
          );
          return (
            <List.Item
              key={log.id}
              actions={[
                <Button
                  key="edit"
                  type="link"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => {
                    onEdit(log);
                  }}
                >
                  编辑
                </Button>,
                <Popconfirm
                  key="delete"
                  title="删除这条日志？"
                  description="删除后无法恢复，建议先导出备份。"
                  okText="删除"
                  cancelText="取消"
                  onConfirm={() => {
                    onDelete(log);
                  }}
                >
                  <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                    删除
                  </Button>
                </Popconfirm>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Space size={8} wrap>
                    <Tag>{log.date}</Tag>
                    <Typography.Link
                      className="log-list__title"
                      onClick={() => {
                        onEdit(log);
                      }}
                    >
                      <HighlightedText text={log.title} keyword={keyword} />
                    </Typography.Link>
                  </Space>
                }
                description={
                  <LogLinkInfo
                    log={log}
                    projectNames={projectNames}
                    taskNames={taskNames}
                    tagNames={tagNames}
                  />
                }
              />
              {snippet ? (
                <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                  <HighlightedText text={snippet} keyword={keyword} />
                </Typography.Paragraph>
              ) : null}
              {log.insight ? (
                <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>
                  心得：
                  <HighlightedText text={log.insight} keyword={keyword} />
                </Typography.Paragraph>
              ) : null}
              {log.problem ? (
                <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>
                  问题：
                  <HighlightedText text={log.problem} keyword={keyword} />
                </Typography.Paragraph>
              ) : null}
              {log.solution ? (
                <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>
                  解决方案：
                  <HighlightedText text={log.solution} keyword={keyword} />
                </Typography.Paragraph>
              ) : null}
            </List.Item>
          );
        }}
      />
      <div className="list-footer">
        <Pagination
          current={page}
          pageSize={pageSize}
          total={total}
          showSizeChanger={false}
          showTotal={(value) => `共 ${String(value)} 条`}
          onChange={onPageChange}
        />
      </div>
    </>
  );
}
