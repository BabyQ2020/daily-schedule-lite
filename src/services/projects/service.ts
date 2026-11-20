/**
 * 项目应用服务：页面只依赖本模块，不直接接触仓储与数据库。
 * 事务、里程碑/风险的内嵌更新、删除前的任务计数都在 Repository。
 */
export {
  addMilestone,
  addRisk,
  archiveProject,
  countProjectTasks,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  queryProjects,
  removeMilestone,
  removeRisk,
  restoreProject,
  updateMilestone,
  updateProject,
  updateRisk,
} from '@/repositories/projects';
export type {
  MilestoneInput,
  ProjectCreateInput,
  ProjectFilter,
  ProjectUpdateInput,
  RiskInput,
} from '@/repositories/projects';
