import { db } from '@/db/db';
import type { WorkbenchDatabase } from '@/db/db';
import type { Id, Tag, TagKind } from '@/domain/types';
import { createTag, listTags } from '@/repositories/tags';

export const TAG_NAME_MAX_LENGTH = 24;

/**
 * 标签在阶段 C 的轻量入口：任务/项目表单里可以边写边建标签。
 * 完整标签管理（改名、改色、批量清理）在阶段 H 的「系统设置」。
 */
export async function resolveTagIds(
  names: readonly string[],
  kind: TagKind = 'general',
  database: WorkbenchDatabase = db,
): Promise<Id[]> {
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw.trim().slice(0, TAG_NAME_MAX_LENGTH);
    if (name.length === 0) {
      continue;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    cleaned.push(name);
  }

  if (cleaned.length === 0) {
    return [];
  }

  // 同名标签跨类型复用：避免「工作」「工作(task)」并存导致筛选取不到。
  const existing = await listTags('all', database);
  const byName = new Map(existing.map((tag) => [tag.name.toLowerCase(), tag]));
  const ids: Id[] = [];

  for (const name of cleaned) {
    const found = byName.get(name.toLowerCase());
    if (found) {
      ids.push(found.id);
      continue;
    }
    const created = await createTag({ name, kind }, database);
    byName.set(name.toLowerCase(), created);
    ids.push(created.id);
  }

  return ids;
}

/** 把任务上的标签 id 还原成名称，供表单回填。 */
export function tagNamesOf(tagIds: readonly Id[], tags: readonly Tag[]): string[] {
  const byId = new Map(tags.map((tag) => [tag.id, tag.name]));
  return tagIds.map((id) => byId.get(id)).filter((name): name is string => Boolean(name));
}
