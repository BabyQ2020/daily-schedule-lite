import { useState } from 'react';
import { App as AntApp, Button, Card, Space, Tag } from 'antd';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { EditOutlined, FileTextOutlined, PlusOutlined, ProjectOutlined } from '@ant-design/icons';

import { PageContainer } from '@/components/PageContainer';
import { LoadingState } from '@/components/states/LoadingState';
import type { Task, WorkLog } from '@/domain/types';
import { todayISO } from '@/lib/clock';
import { loadSettings } from '@/services/settings';
import { loadDashboard } from '@/services/stats/dashboard';
import { LogFormDrawer } from '@/features/logs/LogFormDrawer';
import { TaskFormDrawer } from '@/features/tasks/TaskFormDrawer';
import { useTaskQueryStore } from '@/features/tasks/filters';
import { DashboardCards } from '@/features/dashboard/DashboardCards';
import { BackupReminderAlert } from '@/features/system/BackupReminderAlert';
import {
  MoreHint,
  OverdueTaskList,
  ProjectHealthList,
  RecentLogList,
  WeekPlanList,
} from '@/features/dashboard/DashboardLists';

/** 综合仪表盘：今天的重点 + 本周计划 + 项目健康度 + 最近日志。 */
export function DashboardPage() {
  const navigate = useNavigate();
  const { message } = AntApp.useApp();

  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [logDrawerOpen, setLogDrawerOpen] = useState(false);
  const [activeLogId, setActiveLogId] = useState<string | null>(null);

  const today = todayISO();
  const settings = useLiveQuery(() => loadSettings(), []);
  const weekStart = settings?.weekStart ?? 1;
  const data = useLiveQuery(() => loadDashboard(today, weekStart), [today, weekStart]);

  function openTask(task: Task) {
    setActiveTaskId(task.id);
    setTaskDrawerOpen(true);
  }

  function openLog(log: WorkLog) {
    setActiveLogId(log.id);
    setLogDrawerOpen(true);
  }

  function openOverdueList() {
    useTaskQueryStore.getState().reset();
    navigate('/tasks');
    message.info('已打开任务页，可用「截止日期」筛选逾期任务');
  }

  function openWeekList() {
    if (!data) {
      return;
    }
    useTaskQueryStore.getState().reset();
    useTaskQueryStore.getState().patch({
      dueFrom: data.weekPeriod.start,
      dueTo: data.weekPeriod.end,
    });
    navigate('/tasks');
    message.info('已按本周截止日期筛选任务');
  }

  const loading = data === undefined;

  return (
    <PageContainer
      title="综合仪表盘"
      description="今天的重点、本周计划、逾期风险与项目健康度，全部来自本机数据。"
      extra={
        <Space wrap size={8}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setActiveTaskId(null);
              setTaskDrawerOpen(true);
            }}
          >
            新建任务
          </Button>
          <Button
            icon={<FileTextOutlined />}
            onClick={() => {
              setActiveLogId(null);
              setLogDrawerOpen(true);
            }}
          >
            写日志
          </Button>
          <Button icon={<EditOutlined />} onClick={() => navigate('/reports')}>
            生成周报
          </Button>
        </Space>
      }
    >
      <BackupReminderAlert
        action={
          <Button size="small" onClick={() => navigate('/settings')}>
            去备份
          </Button>
        }
      />

      <DashboardCards data={data ?? null} loading={loading} />

      {data === undefined ? (
        <LoadingState tip="正在汇总今日数据…" />
      ) : (
        <div className="two-col">
          <div className="stack-col">
            <Card
              size="small"
              title="今日待办"
              extra={
                <Button type="link" size="small" onClick={() => navigate('/today')}>
                  去每日工作台
                </Button>
              }
            >
              {data.plannedOpen.length === 0 ? (
                <MoreHint text="今日计划里没有未完成的任务。去每日工作台挑选今天要做的事。" />
              ) : (
                <ul className="dash-list">
                  {data.plannedOpen.map((task) => (
                    <li key={task.id} className="dash-row">
                      <button
                        type="button"
                        className="dash-row__main"
                        onClick={() => openTask(task)}
                      >
                        <span className="dash-row__title">{task.title}</span>
                        {task.dueDate ? (
                          <span className="dash-row__meta">截止 {task.dueDate}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card
              size="small"
              title={`本周计划 · ${data.weekPeriod.start} ~ ${data.weekPeriod.end}`}
              extra={
                <Button type="link" size="small" onClick={openWeekList}>
                  查看全部
                </Button>
              }
            >
              <WeekPlanList
                tasks={data.week}
                onOpenTask={openTask}
                emptyText="本周还没有计划任务"
              />
              {data.weekTotal > data.week.length ? (
                <p className="toolbar-hint">
                  共 {data.weekTotal} 项，这里展示前 {data.week.length} 项。
                </p>
              ) : null}
            </Card>
          </div>

          <div className="stack-col">
            <Card
              size="small"
              title={
                <Space size={6}>
                  逾期任务
                  {data.overdueTotal > 0 ? <Tag color="red">{data.overdueTotal}</Tag> : null}
                </Space>
              }
              extra={
                data.overdueTotal > 0 ? (
                  <Button type="link" size="small" onClick={openOverdueList}>
                    查看全部
                  </Button>
                ) : null
              }
            >
              <OverdueTaskList
                tasks={data.overdue}
                onOpenTask={openTask}
                emptyText="没有逾期任务，保持住"
              />
            </Card>

            <Card
              size="small"
              title={
                <Space size={6}>
                  <ProjectOutlined aria-hidden="true" />
                  项目健康度
                </Space>
              }
              extra={
                <Button type="link" size="small" onClick={() => navigate('/projects')}>
                  项目管理
                </Button>
              }
            >
              <ProjectHealthList items={data.health} onOpenProject={() => navigate('/projects')} />
            </Card>

            <Card
              size="small"
              title="最近日志"
              extra={
                <Button type="link" size="small" onClick={() => navigate('/logs')}>
                  全部日志
                </Button>
              }
            >
              <RecentLogList
                logs={data.recentLogs}
                onOpenLog={openLog}
                onGoLogs={() => navigate('/logs')}
              />
            </Card>
          </div>
        </div>
      )}

      <TaskFormDrawer
        open={taskDrawerOpen}
        taskId={activeTaskId}
        defaults={{ planDate: today }}
        onClose={() => setTaskDrawerOpen(false)}
        onSaved={() => message.success('任务已保存')}
      />
      <LogFormDrawer
        open={logDrawerOpen}
        logId={activeLogId}
        defaults={{ date: today }}
        onClose={() => setLogDrawerOpen(false)}
        onSaved={() => message.success('日志已保存')}
      />
    </PageContainer>
  );
}
