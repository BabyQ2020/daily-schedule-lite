import {
  App,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Descriptions,
  Drawer,
  Empty,
  Input,
  List,
  Popconfirm,
  Progress,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  PROJECT_STATUS_LABELS,
  RISK_LEVEL_LABELS,
  RISK_STATUS_LABELS,
  TASK_STATUS_LABELS,
} from '@/domain/labels';
import { RISK_LEVELS, RISK_STATUSES } from '@/domain/types';
import type { Id, RiskLevel } from '@/domain/types';
import {
  addMilestone,
  addRisk,
  getProject,
  removeMilestone,
  removeRisk,
  updateMilestone,
  updateRisk,
} from '@/services/projects/service';
import { queryTasks } from '@/services/tasks/service';
import { listTags } from '@/services/lookups';
import { computeProjectProgress } from '@/services/stats/progress';
import { useTaskQueryStore } from '@/features/tasks/filters';

export interface ProjectDetailDrawerProps {
  open: boolean;
  projectId: Id | null;
  onClose: () => void;
}

export function ProjectDetailDrawer({ open, projectId, onClose }: ProjectDetailDrawerProps) {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const focusProject = useTaskQueryStore((state) => state.focusProject);
  const [milestoneTitle, setMilestoneTitle] = useState('');
  const [milestoneDue, setMilestoneDue] = useState<dayjs.Dayjs | null>(null);
  const [riskTitle, setRiskTitle] = useState('');
  const [riskLevel, setRiskLevel] = useState<RiskLevel>('medium');

  const project = useLiveQuery(
    () => (projectId === null ? Promise.resolve(undefined) : getProject(projectId)),
    [projectId],
  );
  const tags = useLiveQuery(() => listTags(), []);
  const related = useLiveQuery(
    () =>
      projectId === null
        ? Promise.resolve(undefined)
        : queryTasks(
            { projectId, archived: 'all' },
            { key: 'updatedAt', direction: 'desc' },
            {
              page: 1,
              pageSize: 100,
            },
          ),
    [projectId],
  );

  const progress = computeProjectProgress(related?.items ?? []);
  const tagNames = (tags ?? [])
    .filter((tag) => project?.tags.includes(tag.id))
    .map((tag) => tag.name);

  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      message.success(success);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败');
    }
  };

  const handleAddMilestone = () => {
    if (projectId === null) {
      return;
    }
    const title = milestoneTitle.trim();
    if (title.length === 0) {
      message.warning('请填写里程碑名称');
      return;
    }
    void run(async () => {
      await addMilestone(projectId, {
        title,
        dueDate: milestoneDue ? milestoneDue.format('YYYY-MM-DD') : null,
      });
      setMilestoneTitle('');
      setMilestoneDue(null);
    }, '里程碑已添加');
  };

  const handleAddRisk = () => {
    if (projectId === null) {
      return;
    }
    const title = riskTitle.trim();
    if (title.length === 0) {
      message.warning('请填写风险描述');
      return;
    }
    void run(async () => {
      await addRisk(projectId, { title, level: riskLevel });
      setRiskTitle('');
      setRiskLevel('medium');
    }, '风险已记录');
  };

  return (
    <Drawer open={open} onClose={onClose} width={680} title="项目详情" destroyOnHidden>
      {!project ? (
        <Empty description="项目不存在或已被删除" />
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div>
            <Space size={8} wrap>
              <Typography.Title level={3} style={{ margin: 0 }}>
                {project.name}
              </Typography.Title>
              <Tag color={PROJECT_STATUS_LABELS[project.status].color}>
                {PROJECT_STATUS_LABELS[project.status].label}
              </Tag>
              {project.archivedAt ? <Tag>已归档</Tag> : null}
            </Space>
            {project.description ? (
              <Typography.Paragraph style={{ marginTop: 8, marginBottom: 0 }}>
                {project.description}
              </Typography.Paragraph>
            ) : null}
          </div>

          <Descriptions size="small" column={2} bordered>
            <Descriptions.Item label="起止日期">
              {project.startDate ?? '—'} ~ {project.endDate ?? '—'}
            </Descriptions.Item>
            <Descriptions.Item label="标签">
              {tagNames.length > 0
                ? tagNames.map((name) => (
                    <Tag key={name} bordered={false}>
                      {name}
                    </Tag>
                  ))
                : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="任务进度">
              {progress.percent === null ? (
                '—'
              ) : (
                <Space>
                  <Progress type="circle" size={28} percent={progress.percent} />
                  <span>
                    已完成 {progress.done} / {progress.counted}
                  </span>
                </Space>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="参与计算的任务">
              排除归档 {progress.archived} 个、取消 {progress.cancelled} 个
            </Descriptions.Item>
            <Descriptions.Item label="创建于">
              {dayjs(project.createdAt).format('YYYY-MM-DD HH:mm')}
            </Descriptions.Item>
            <Descriptions.Item label="更新于">
              {dayjs(project.updatedAt).format('YYYY-MM-DD HH:mm')}
            </Descriptions.Item>
          </Descriptions>

          <Card
            size="small"
            title={`里程碑（${project.milestones.length}）`}
            extra={
              <Space.Compact>
                <Input
                  value={milestoneTitle}
                  onChange={(event) => setMilestoneTitle(event.target.value)}
                  placeholder="里程碑名称"
                  onPressEnter={handleAddMilestone}
                  style={{ width: 180 }}
                  aria-label="里程碑名称"
                />
                <DatePicker
                  value={milestoneDue}
                  onChange={(value) => setMilestoneDue(value)}
                  format="YYYY-MM-DD"
                  style={{ width: 130 }}
                  aria-label="里程碑日期"
                />
                <Button type="primary" onClick={handleAddMilestone}>
                  添加
                </Button>
              </Space.Compact>
            }
          >
            <List
              size="small"
              dataSource={[...project.milestones]}
              locale={{ emptyText: '还没有里程碑' }}
              renderItem={(milestone) => (
                <List.Item
                  actions={[
                    <Popconfirm
                      key="remove"
                      title="删除这个里程碑？"
                      okText="删除"
                      cancelText="取消"
                      onConfirm={() =>
                        projectId === null
                          ? undefined
                          : void run(() => removeMilestone(projectId, milestone.id), '里程碑已删除')
                      }
                    >
                      <Button type="link" size="small" danger>
                        删除
                      </Button>
                    </Popconfirm>,
                  ]}
                >
                  <Space>
                    <Checkbox
                      checked={milestone.done}
                      onChange={(event) =>
                        projectId === null
                          ? undefined
                          : void run(
                              () =>
                                updateMilestone(projectId, milestone.id, {
                                  done: event.target.checked,
                                }),
                              event.target.checked ? '里程碑已完成' : '里程碑已标记为未完成',
                            )
                      }
                    >
                      <Typography.Text delete={milestone.done}>{milestone.title}</Typography.Text>
                    </Checkbox>
                    <Typography.Text type="secondary">
                      {milestone.dueDate ?? '无日期'}
                    </Typography.Text>
                  </Space>
                </List.Item>
              )}
            />
          </Card>

          <Card
            size="small"
            title={`风险记录（${project.risks.length}）`}
            extra={
              <Space.Compact>
                <Input
                  value={riskTitle}
                  onChange={(event) => setRiskTitle(event.target.value)}
                  placeholder="风险描述"
                  onPressEnter={handleAddRisk}
                  style={{ width: 200 }}
                  aria-label="风险描述"
                />
                <Select
                  value={riskLevel}
                  onChange={setRiskLevel}
                  style={{ width: 90 }}
                  aria-label="风险级别"
                  options={RISK_LEVELS.map((level) => ({
                    label: RISK_LEVEL_LABELS[level].label,
                    value: level,
                  }))}
                />
                <Button type="primary" onClick={handleAddRisk}>
                  记录
                </Button>
              </Space.Compact>
            }
          >
            <List
              size="small"
              dataSource={[...project.risks]}
              locale={{ emptyText: '还没有记录风险' }}
              renderItem={(risk) => (
                <List.Item
                  actions={[
                    <Popconfirm
                      key="remove"
                      title="删除这条风险记录？"
                      okText="删除"
                      cancelText="取消"
                      onConfirm={() =>
                        projectId === null
                          ? undefined
                          : void run(() => removeRisk(projectId, risk.id), '风险记录已删除')
                      }
                    >
                      <Button type="link" size="small" danger>
                        删除
                      </Button>
                    </Popconfirm>,
                  ]}
                >
                  <Space wrap>
                    <Tag color={RISK_LEVEL_LABELS[risk.level].color}>
                      {RISK_LEVEL_LABELS[risk.level].label}
                    </Tag>
                    <Typography.Text>{risk.title}</Typography.Text>
                    <Select
                      size="small"
                      value={risk.status}
                      style={{ width: 100 }}
                      aria-label="风险状态"
                      onChange={(status) =>
                        projectId === null
                          ? undefined
                          : void run(
                              () => updateRisk(projectId, risk.id, { status }),
                              '风险状态已更新',
                            )
                      }
                      options={RISK_STATUSES.map((status) => ({
                        label: RISK_STATUS_LABELS[status].label,
                        value: status,
                      }))}
                    />
                  </Space>
                </List.Item>
              )}
            />
          </Card>

          <Card
            size="small"
            title={`关联任务（${related?.total ?? 0}）`}
            extra={
              <Button
                type="link"
                size="small"
                onClick={() => {
                  focusProject(project.id);
                  onClose();
                  navigate('/tasks');
                }}
              >
                在任务页查看
              </Button>
            }
          >
            <List
              size="small"
              dataSource={related?.items ?? []}
              locale={{ emptyText: '这个项目还没有任务' }}
              renderItem={(task) => (
                <List.Item>
                  <Space wrap>
                    <Typography.Text delete={task.status === 'cancelled'}>
                      {task.title}
                    </Typography.Text>
                    <Tag color={TASK_STATUS_LABELS[task.status].color}>
                      {TASK_STATUS_LABELS[task.status].label}
                    </Tag>
                    {task.dueDate ? (
                      <Typography.Text type="secondary">截止 {task.dueDate}</Typography.Text>
                    ) : null}
                  </Space>
                </List.Item>
              )}
            />
          </Card>
        </Space>
      )}
    </Drawer>
  );
}
