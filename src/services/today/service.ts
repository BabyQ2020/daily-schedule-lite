/**
 * 每日计划应用服务：今日计划条目的读写。
 * 计划与任务状态的一致性（完成情况不落库、由任务派生）在读取层 `services/stats/today.ts`。
 */
export {
  addExtra,
  addTaskToPlan,
  ensurePlan,
  getPlan,
  listPlans,
  removeExtra,
  removeTaskFromPlan,
  setPlanTasks,
  upsertPlan,
} from '@/repositories/plans';
export type { PlanUpdateInput } from '@/repositories/plans';
