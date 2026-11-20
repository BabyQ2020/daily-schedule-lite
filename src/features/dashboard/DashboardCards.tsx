import { Card, Col, Row, Statistic, Tooltip } from 'antd';

import type { DashboardData } from '@/services/stats/dashboard';

interface DashboardCardsProps {
  data: DashboardData | null;
  loading?: boolean;
}

/** 仪表盘四张指标卡：口径与每日工作台、统计页保持一致。 */
export function DashboardCards({ data, loading = false }: DashboardCardsProps) {
  const today = data?.today;
  const todoCount = today ? today.planned - today.plannedDone : 0;

  return (
    <Row gutter={[12, 12]}>
      <Col xs={12} md={6}>
        <Card size="small" loading={loading}>
          <Tooltip title="今日计划里还没完成的任务数">
            <Statistic title="今日待办" value={todoCount} suffix="项" />
          </Tooltip>
        </Card>
      </Col>
      <Col xs={12} md={6}>
        <Card size="small" loading={loading}>
          <Tooltip title="有截止日期、早于今天且未完成的任务">
            <Statistic
              title="逾期任务"
              value={data?.overdueTotal ?? 0}
              suffix="项"
              valueStyle={{ color: (data?.overdueTotal ?? 0) > 0 ? '#dc2626' : undefined }}
            />
          </Tooltip>
        </Card>
      </Col>
      <Col xs={12} md={6}>
        <Card size="small" loading={loading}>
          <Tooltip title="计划日期或截止日期落在本周的未完成任务">
            <Statistic title="本周计划" value={data?.weekTotal ?? 0} suffix="项" />
          </Tooltip>
        </Card>
      </Col>
      <Col xs={12} md={6}>
        <Card size="small" loading={loading}>
          <Tooltip title="按完成时间统计的今日完成数">
            <Statistic title="今日完成" value={today?.doneByCompletion ?? 0} suffix="项" />
          </Tooltip>
        </Card>
      </Col>
    </Row>
  );
}
