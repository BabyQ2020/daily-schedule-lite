/**
 * 报告应用服务：列表/版本/保存快照/删除。
 * 生成与正文渲染仍在 `services/reports/report-actions.ts` 与 `report-builder.ts`。
 */
export {
  createReport,
  deleteReport,
  getLatestReport,
  getReport,
  listReportVersions,
  listReports,
  saveReportSnapshot,
  updateReport,
} from '@/repositories/reports';
export type { ReportCreateInput, ReportFilter, ReportPatch } from '@/repositories/reports';
