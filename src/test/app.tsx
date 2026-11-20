import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { render, type RenderResult } from '@testing-library/react';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';

import { db } from '@/db/db';

dayjs.locale('zh-cn');

/** 组件级测试统一挂载 antd 的 App 上下文（message / modal）与路由。 */
export function renderWithProviders(
  ui: ReactElement,
  options: { route?: string } = {},
): RenderResult {
  const { route = '/' } = options;
  return render(
    <ConfigProvider locale={zhCN}>
      <AntApp>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </AntApp>
    </ConfigProvider>,
  );
}

/** 每个用例前清空应用主库，避免 liveQuery 读到上一个用例的数据。 */
export async function resetAppDatabase(): Promise<void> {
  const tables = [
    db.tasks,
    db.projects,
    db.dailyPlans,
    db.workLogs,
    db.reports,
    db.tags,
    db.settings,
    db.meta,
    db.longTasks,
    db.longTaskRuleVersions,
    db.longTaskExceptions,
  ];
  await db.transaction('rw', tables, async () => {
    for (const table of tables) {
      await table.clear();
    }
  });
}
