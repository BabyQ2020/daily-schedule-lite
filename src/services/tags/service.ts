/**
 * 标签应用服务：标签管理与使用量统计。
 * 删除标签时清理任务/项目/日志引用的四表事务在 Repository。
 */
export {
  countTagUsage,
  createTag,
  deleteTag,
  findTagByName,
  getTag,
  listTags,
  updateTag,
} from '@/repositories/tags';
export type { TagCreateInput, TagUpdateInput } from '@/repositories/tags';
export type { TagUsage } from '@/repositories/tags';
