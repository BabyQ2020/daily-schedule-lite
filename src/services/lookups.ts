/**
 * 只读查询封装：页面与特性层需要的下拉数据（项目 / 标签 / 任务）。
 * 这一层存在的意义是让 UI 不直接依赖仓储与数据库，同时把「下拉要什么」
 * 收敛到一处，避免每个页面各写一遍过滤条件。
 */
export { listProjects } from '@/repositories/projects';
export { listTags } from '@/repositories/tags';
export { listTasks } from '@/repositories/tasks';
