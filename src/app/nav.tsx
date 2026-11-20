import type { ReactNode } from 'react';

import { CalendarOutlined, SettingOutlined } from '@ant-design/icons';

export interface NavItem {
  readonly key: string;
  readonly path: string;
  readonly label: string;
  readonly description: string;
  readonly icon: ReactNode;
}

/** 顶部唯一的导航项：日程。 */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    key: 'schedule',
    path: '/',
    label: '日程',
    description: '按天安排普通任务，旁边维护长期任务',
    icon: <CalendarOutlined />,
  },
];

/**
 * 仍保留但不再出现在导航里的页面标题。
 * 这些页面只能通过直接访问地址或从数据抽屉跳转进入。
 */
const EXTRA_TITLES: Record<string, string> = {
  '/settings': '系统设置',
  '/today': '每日工作台（旧）',
  '/projects': '项目管理（旧）',
  '/logs': '工作日志（旧）',
  '/reports': '统计与报告（旧）',
};

/** 按路由匹配标题；'/' 永远是日程。 */
export function findNavItem(pathname: string): NavItem | undefined {
  if (pathname === '/' || pathname === '') {
    return NAV_ITEMS[0];
  }
  const extra = EXTRA_TITLES[pathname];
  if (extra) {
    return {
      key: `extra:${pathname}`,
      path: pathname,
      label: extra,
      description: '',
      icon: <SettingOutlined />,
    };
  }
  return NAV_ITEMS.find((item) => item.path !== '/' && pathname.startsWith(item.path));
}
