import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { AppRoutes } from '@/app/router';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

const ROUTES: readonly { path: string; title: string }[] = [
  { path: '/', title: '日程' },
  { path: '/today', title: '每日工作台' },
  { path: '/projects', title: '项目管理' },
  { path: '/logs', title: '工作日志' },
  { path: '/reports', title: '统计与报告' },
  { path: '/settings', title: '系统设置' },
];

describe('路由与页面骨架', () => {
  // 页面按路由懒加载，标题要等对应 chunk 载入后才出现。
  it.each(ROUTES.map((route) => [route.path, route.title]))(
    '%s 渲染唯一的一级标题「%s」',
    async (path, title) => {
      renderAt(path);
      expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    },
  );

  it('旧的 #/tasks 入口重定向到日程首页', async () => {
    renderAt('/tasks');
    expect(await screen.findByRole('heading', { level: 1, name: '日程' })).toBeInTheDocument();
  });

  it('顶栏提供数据、回收站与新建任务入口', async () => {
    renderAt('/');
    expect(await screen.findByRole('button', { name: /数\s*据/ })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /回收站/ })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '快速新建任务' })).toBeInTheDocument();
  });

  it('未知路径显示 404 页面并提供返回入口', async () => {
    renderAt('/not-a-real-page');
    expect(
      await screen.findByRole('heading', { level: 1, name: '页面未找到' }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /返回仪表盘/ })).toBeInTheDocument();
  });

  it('页脚声明数据仅存本地，无外传', async () => {
    renderAt('/');
    expect(await screen.findByText(/数据保存在本机 IndexedDB/)).toBeInTheDocument();
  });

  it('设置页能读通 IndexedDB 并展示各分区', async () => {
    renderAt('/settings');
    // 设置页各卡片依赖 IndexedDB 异步读取，结构版本行出现说明 Dexie 在 jsdom 中跑通。
    expect(await screen.findByText('完整备份与恢复')).toBeInTheDocument();
    expect(await screen.findByText(/IndexedDB v2/)).toBeInTheDocument();
    expect(await screen.findByText('标签管理')).toBeInTheDocument();
  });
});
