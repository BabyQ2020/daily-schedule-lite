import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { LoadingState } from '@/components/states/LoadingState';
import { AppLayout } from '@/components/layout/AppLayout';

/**
 * 路由级懒加载：首屏只加载日程页依赖，其余页面按需拉取。
 * 每个页面是命名导出，这里转成默认导出供 lazy 使用。
 */
const SchedulePage = lazy(() =>
  import('@/pages/SchedulePage').then((module) => ({ default: module.SchedulePage })),
);
const SettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then((module) => ({ default: module.SettingsPage })),
);
const TodayPage = lazy(() =>
  import('@/pages/TodayPage').then((module) => ({ default: module.TodayPage })),
);
const ProjectsPage = lazy(() =>
  import('@/pages/ProjectsPage').then((module) => ({ default: module.ProjectsPage })),
);
const LogsPage = lazy(() =>
  import('@/pages/LogsPage').then((module) => ({ default: module.LogsPage })),
);
const ReportsPage = lazy(() =>
  import('@/pages/ReportsPage').then((module) => ({ default: module.ReportsPage })),
);
const NotFoundPage = lazy(() =>
  import('@/pages/NotFoundPage').then((module) => ({ default: module.NotFoundPage })),
);

function PageFallback() {
  return <LoadingState tip="正在加载页面…" />;
}

/** 路由表：日程为首页，`#/tasks` 重定向到首页，旧页面仅保留地址可达。 */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route
          index
          element={
            <Suspense fallback={<PageFallback />}>
              <SchedulePage />
            </Suspense>
          }
        />
        <Route path="tasks" element={<Navigate to="/" replace />} />
        <Route
          path="settings"
          element={
            <Suspense fallback={<PageFallback />}>
              <SettingsPage />
            </Suspense>
          }
        />
        <Route
          path="today"
          element={
            <Suspense fallback={<PageFallback />}>
              <TodayPage />
            </Suspense>
          }
        />
        <Route
          path="projects"
          element={
            <Suspense fallback={<PageFallback />}>
              <ProjectsPage />
            </Suspense>
          }
        />
        <Route
          path="logs"
          element={
            <Suspense fallback={<PageFallback />}>
              <LogsPage />
            </Suspense>
          }
        />
        <Route
          path="reports"
          element={
            <Suspense fallback={<PageFallback />}>
              <ReportsPage />
            </Suspense>
          }
        />
        <Route
          path="*"
          element={
            <Suspense fallback={<PageFallback />}>
              <NotFoundPage />
            </Suspense>
          }
        />
      </Route>
    </Routes>
  );
}
