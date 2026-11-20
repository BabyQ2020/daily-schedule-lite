import { Suspense, lazy, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';

import {
  DeleteOutlined,
  DatabaseOutlined,
  PlusOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { Button, Layout, Tag, Tooltip } from 'antd';

import { findNavItem } from '@/app/nav';

const TaskFormDrawer = lazy(() =>
  import('@/features/tasks/TaskFormDrawer').then((module) => ({
    default: module.TaskFormDrawer,
  })),
);
const DataDrawer = lazy(() =>
  import('@/features/shell/DataDrawer').then((module) => ({ default: module.DataDrawer })),
);
const RecycleBinDrawer = lazy(() =>
  import('@/features/shell/RecycleBinDrawer').then((module) => ({
    default: module.RecycleBinDrawer,
  })),
);

/**
 * 应用外壳：顶部一条工具条 + 单页内容区。
 * 原来左侧的七项导航已移除，日程页自身承担主要导航。
 */
export function AppLayout() {
  const location = useLocation();
  const current = findNavItem(location.pathname);
  const [quickTaskOpen, setQuickTaskOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [recycleOpen, setRecycleOpen] = useState(false);

  return (
    <Layout className="app-shell">
      <Layout.Header className="app-header">
        <Link to="/" className="app-brand app-brand--inline" aria-label="回到日程">
          <span className="app-brand__logo">日</span>
          <span className="app-brand__text">
            <span className="app-brand__name">日程轻量版</span>
            <span className="app-brand__tagline">本地优先 · 离线可用</span>
          </span>
        </Link>

        {current && current.path !== '/' ? (
          <span className="app-header__crumb">{current.label}</span>
        ) : null}

        <span className="app-header__spacer" />

        <Tag className="app-header__badge" bordered={false}>
          数据仅存本地
        </Tag>
        <Tooltip title="备份、恢复与存储占用">
          <Button icon={<DatabaseOutlined />} onClick={() => setDataOpen(true)}>
            数据
          </Button>
        </Tooltip>
        <Tooltip title="已删除的普通任务与长期任务">
          <Button icon={<DeleteOutlined />} onClick={() => setRecycleOpen(true)}>
            回收站
          </Button>
        </Tooltip>
        <Tooltip title="新建普通任务">
          <Button
            type="primary"
            icon={<PlusOutlined />}
            aria-label="快速新建任务"
            onClick={() => setQuickTaskOpen(true)}
          >
            新建任务
          </Button>
        </Tooltip>
      </Layout.Header>

      <Layout.Content className="app-content">
        <Outlet />
      </Layout.Content>

      <footer className="app-footer">
        <UnorderedListOutlined /> 离线可用 · 数据保存在本机 IndexedDB · 无遥测、无外传
      </footer>

      <Suspense fallback={null}>
        {quickTaskOpen ? (
          <TaskFormDrawer
            open
            taskId={null}
            onClose={() => setQuickTaskOpen(false)}
            onSaved={() => setQuickTaskOpen(false)}
          />
        ) : null}
        {dataOpen ? <DataDrawer open onClose={() => setDataOpen(false)} /> : null}
        {recycleOpen ? <RecycleBinDrawer open onClose={() => setRecycleOpen(false)} /> : null}
      </Suspense>
    </Layout>
  );
}
