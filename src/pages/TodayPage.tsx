import { useState } from 'react';

import { PlusOutlined } from '@ant-design/icons';
import { App, Button, Card, List, Statistic, Tag, Typography } from 'antd';
import { useLiveQuery } from 'dexie-react-hooks';

import { LoadingState } from '@/components/states/LoadingState';
import { PageContainer } from '@/components/PageContainer';
import type { Task } from '@/domain/types';
import { CarryOverCard } from '@/features/today/CarryOverCard';
import { DailyDraftCard } from '@/features/today/DailyDraftCard';
import { PlanTasksCard } from '@/features/today/PlanTasksCard';
import { QuickLogCard } from '@/features/today/QuickLogCard';
import { TaskFormDrawer } from '@/features/tasks/TaskFormDrawer';
import { todayISO } from '@/lib/clock';
import { formatPeriodLabel, periodFor, weekdayLabelOf } from '@/lib/period';
import { listProjects, listTasks } from '@/services/lookups';
import { setTaskStatus } from '@/services/tasks/service';
import { buildDailyDraft } from '@/services/reports/daily-draft';
import { loadSettings } from '@/services/settings';
import { isOpenTask, loadTodayBoard } from '@/services/stats/today';
import { addTaskToToday, saveQuickLog, toggleTaskDone } from '@/services/today-actions';

export function TodayPage() {
  const { message } = App.useApp();
  const today = todayISO();
  const [formOpen, setFormOpen] = useState(false);

  const data = useLiveQuery(async () => {
    const [board, settings, projects, taskPage] = await Promise.all([
      loadTodayBoard(today),
      loadSettings(),
      listProjects({ archived: 'all' }),
      listTasks({ archived: 'active' }),
    ]);
    const draft = buildDailyDraft(board, settings, projects);
    const plannedIds = new Set(board.planned.map((task) => task.id));
    return {
      board,
      draft,
      settings,
      projectNames: new Map(projects.map((project) => [project.id, project.name])),
      candidates: taskPage.filter((task) => isOpenTask(task) && !plannedIds.has(task.id)),
    };
  }, [today]);

  async function handleToggle(task: Task): Promise<void> {
    try {
      await toggleTaskDone(task);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '更新任务状态失败。');
    }
  }

  async function handleComplete(task: Task): Promise<void> {
    try {
      await setTaskStatus(task.id, 'done');
      message.success('已标记完成');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '更新任务状态失败。');
    }
  }

  async function handleMoveToToday(task: Task): Promise<void> {
    try {
      await addTaskToToday(task.id, today);
      message.success('已加入今日计划');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '改期失败。');
    }
  }

  async function handleAddDueTask(task: Task): Promise<void> {
    try {
      await addTaskToToday(task.id, today);
      message.success('已加入今日计划');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加入今日计划失败。');
    }
  }

  if (!data) {
    return (
      <PageContainer title="每日工作台">
        <LoadingState tip="正在读取今天的数据…" />
      </PageContainer>
    );
  }

  const { board, draft, settings, projectNames, candidates } = data;
  const rate =
    board.counts.planned === 0
      ? '—'
      : `${String(Math.floor((board.counts.plannedDone / board.counts.planned) * 100))}%`;

  return (
    <PageContainer
      title="每日工作台"
      description={`今天 ${today}（${weekdayLabelOf(today)}）· 本周 ${formatPeriodLabel(periodFor('week', today, settings.weekStart))}`}
      extra={
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            setFormOpen(true);
          }}
        >
          新建今日任务
        </Button>
      }
    >
      <div className="metric-grid">
        <Card>
          <Statistic title="今日计划" value={board.counts.planned} suffix="项" />
        </Card>
        <Card>
          <Statistic
            title="计划已完成"
            value={board.counts.plannedDone}
            suffix={`/ ${String(board.counts.planned)} 项`}
          />
          <Typography.Text type="secondary">完成率 {rate}</Typography.Text>
        </Card>
        <Card>
          <Statistic
            title="逾期任务"
            value={board.counts.overdue}
            suffix="项"
            valueStyle={board.counts.overdue > 0 ? { color: '#dc2626' } : undefined}
          />
        </Card>
        <Card>
          <Statistic
            title="待结转"
            value={board.counts.carryOver}
            suffix="项"
            valueStyle={board.counts.carryOver > 0 ? { color: '#d97706' } : undefined}
          />
        </Card>
      </div>

      <div className="two-col">
        <div className="page-stack">
          <PlanTasksCard
            date={today}
            plan={board.plan}
            planned={board.planned}
            candidates={candidates}
            projectNameOf={(projectId) =>
              projectId === null ? undefined : projectNames.get(projectId)
            }
            onToggle={(task) => void handleToggle(task)}
          />

          <Card
            title={
              <span>
                今天到期 <Tag>{board.dueToday.length} 项</Tag>
              </span>
            }
          >
            {board.dueToday.length === 0 ? (
              <Typography.Text type="secondary">没有今天到期但未安排的任务。</Typography.Text>
            ) : (
              <List
                size="small"
                dataSource={board.dueToday}
                renderItem={(task) => (
                  <List.Item
                    actions={[
                      <Button
                        key="add"
                        size="small"
                        aria-label={`加入今日计划：${task.title}`}
                        onClick={() => void handleAddDueTask(task)}
                      >
                        加入今日计划
                      </Button>,
                    ]}
                  >
                    <List.Item.Meta
                      title={task.title}
                      description={
                        <Typography.Text type="secondary">截止 {task.dueDate}</Typography.Text>
                      }
                    />
                  </List.Item>
                )}
              />
            )}
          </Card>

          <CarryOverCard
            overdue={board.overdue}
            carryOver={board.carryOver}
            onComplete={(task) => void handleComplete(task)}
            onMoveToToday={(task) => void handleMoveToToday(task)}
          />
        </div>

        <div className="page-stack">
          <QuickLogCard
            logs={board.logs}
            onSave={async (input) => {
              await saveQuickLog(today, input);
            }}
          />
          <DailyDraftCard draft={draft} />
          <Card
            title={
              <span>
                今日已完成 <Tag>{board.counts.doneByCompletion} 项</Tag>
              </span>
            }
          >
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
              按完成时间统计，与「计划已完成」不是一个口径。
            </Typography.Paragraph>
            {board.doneToday.length === 0 ? (
              <Typography.Text type="secondary">今天还没有完成的任务。</Typography.Text>
            ) : (
              <List
                size="small"
                dataSource={board.doneToday.slice(0, 10)}
                renderItem={(task) => (
                  <List.Item>
                    <Typography.Text delete={false}>{task.title}</Typography.Text>
                  </List.Item>
                )}
              />
            )}
          </Card>
        </div>
      </div>

      <TaskFormDrawer
        open={formOpen}
        taskId={null}
        defaults={{ planDate: today }}
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
