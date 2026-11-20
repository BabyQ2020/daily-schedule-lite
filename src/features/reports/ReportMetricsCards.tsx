import { Card, Col, Row, Statistic, Tooltip } from 'antd';

import type { PeriodStats } from '@/services/stats/period-stats';

interface ReportMetricsCardsProps {
  stats: PeriodStats | null;
  loading?: boolean;
}

function valueOf(value: number | null, suffix = ''): string {
  return value === null ? '—' : `${value}${suffix}`;
}

/** 报告页顶部的统计卡片：每个数字都直接来自 PeriodStats，便于与原始数据核对。 */
export function ReportMetricsCards({ stats, loading = false }: ReportMetricsCardsProps) {
  const tasks = stats?.tasks;
  const logs = stats?.logs;

  return (
    <Row gutter={[12, 12]} className="report-metrics">
      <Col xs={12} md={6}>
        <Card size="small" loading={loading}>
          <Statistic title="计划任务" value={tasks?.plannedTotal ?? 0} suffix="项" />
        </Card>
      </Col>
      <Col xs={12} md={6}>
        <Card size="small" loading={loading}>
          <Statistic title="计划内已完成" value={tasks?.plannedDone ?? 0} suffix="项" />
        </Card>
      </Col>
      <Col xs={12} md={6}>
        <Card size="small" loading={loading}>
          <Tooltip title="计划任务中已完成的比例；没有计划任务时为空">
            <Statistic
              title="计划完成率"
              value={valueOf(tasks?.completionRate ?? null, '%')}
              valueStyle={{ color: '#2563eb' }}
            />
          </Tooltip>
        </Card>
      </Col>
      <Col xs={12} md={6}>
        <Card size="small" loading={loading}>
          <Tooltip title="按完成时间统计，和上面的计划完成率是两种口径">
            <Statistic
              title="按完成时间完成"
              value={tasks?.completedByCompletion ?? 0}
              suffix="项"
            />
          </Tooltip>
        </Card>
      </Col>
      <Col xs={12} md={6}>
        <Card size="small" loading={loading}>
          <Statistic title="期末逾期" value={tasks?.overdueAtEnd ?? 0} suffix="项" />
        </Card>
      </Col>
      <Col xs={12} md={6}>
        <Card size="small" loading={loading}>
          <Statistic title="待结转" value={tasks?.carryOverAtEnd ?? 0} suffix="项" />
        </Card>
      </Col>
      <Col xs={12} md={6}>
        <Card size="small" loading={loading}>
          <Statistic title="其中本期新建" value={tasks?.created ?? 0} suffix="项" />
        </Card>
      </Col>
      <Col xs={12} md={6}>
        <Card size="small" loading={loading}>
          <Statistic
            title="工作日志"
            value={logs?.total ?? 0}
            suffix={`条 / ${logs?.daysWithLogs ?? 0} 天`}
          />
        </Card>
      </Col>
    </Row>
  );
}
