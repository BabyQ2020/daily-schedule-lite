import type { WorkbenchDatabase } from '@/db/db';
import { db } from '@/db/db';
import type { Id, Tag, TagKind } from '@/domain/types';
import { nowISOString } from '@/lib/clock';
import { createTagId } from '@/lib/id';
import { toSearchText } from '@/lib/checksum';

import { ConflictError, NotFoundError, ValidationError } from './errors';
import { nextUpdatedAt } from './shared';

export interface TagCreateInput {
  name: string;
  color?: string;
  kind?: TagKind;
  now?: string;
}

export interface TagUpdateInput {
  name?: string;
  color?: string;
  kind?: TagKind;
}

const DEFAULT_COLOR = '#2563eb';

export async function listTags(
  kind?: TagKind | 'all',
  database: WorkbenchDatabase = db,
): Promise<Tag[]> {
  const tags =
    kind && kind !== 'all'
      ? await database.tags.where('kind').equals(kind).toArray()
      : await database.tags.toArray();
  return tags.sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'));
}

export async function getTag(id: Id, database: WorkbenchDatabase = db): Promise<Tag | undefined> {
  return database.tags.get(id);
}

export async function findTagByName(
  name: string,
  kind: TagKind,
  database: WorkbenchDatabase = db,
): Promise<Tag | undefined> {
  return database.tags.where('[name+kind]').equals([name, kind]).first();
}

export async function createTag(
  input: TagCreateInput,
  database: WorkbenchDatabase = db,
): Promise<Tag> {
  const name = input.name.trim();
  if (name.length === 0) {
    throw new ValidationError('标签名称不能为空。');
  }
  const kind = input.kind ?? 'general';
  const duplicate = await findTagByName(name, kind, database);
  if (duplicate) {
    throw new ConflictError(`标签"${name}"已存在。`);
  }
  const tag: Tag = {
    id: createTagId(),
    name,
    color: input.color ?? DEFAULT_COLOR,
    kind,
    createdAt: input.now ?? nowISOString(),
  };
  await database.tags.add(tag);
  return tag;
}

export async function updateTag(
  id: Id,
  patch: TagUpdateInput,
  database: WorkbenchDatabase = db,
): Promise<Tag> {
  const existing = await database.tags.get(id);
  if (!existing) {
    throw new NotFoundError('标签');
  }
  const name = patch.name === undefined ? existing.name : patch.name.trim();
  if (name.length === 0) {
    throw new ValidationError('标签名称不能为空。');
  }
  const kind = patch.kind ?? existing.kind;
  if (name !== existing.name || kind !== existing.kind) {
    const duplicate = await findTagByName(name, kind, database);
    if (duplicate && duplicate.id !== id) {
      throw new ConflictError(`标签"${name}"已存在。`);
    }
  }
  const next: Tag = {
    ...existing,
    name,
    kind,
    color: patch.color ?? existing.color,
  };
  await database.tags.put(next);
  return next;
}

/**
 * 删除标签：同一事务内从任务、项目、日志上摘除，并重算日志检索文本，
 * 避免留下指向已删除标签的悬空 id。
 */
export async function deleteTag(id: Id, database: WorkbenchDatabase = db): Promise<void> {
  const tag = await database.tags.get(id);
  if (!tag) {
    return;
  }
  const now = nowISOString();

  await database.transaction(
    'rw',
    [database.tags, database.tasks, database.projects, database.workLogs],
    async () => {
      await database.tags.delete(id);

      const tasks = await database.tasks.where('tags').equals(id).toArray();
      await database.tasks.bulkPut(
        tasks.map((task) => ({
          ...task,
          tags: task.tags.filter((tagId) => tagId !== id),
          // 与 tasks.ts 共用同一套严格递增规则，避免时钟回拨时 updatedAt 倒退。
          updatedAt: nextUpdatedAt(task.updatedAt, now),
        })),
      );

      const projects = await database.projects.where('tags').equals(id).toArray();
      await database.projects.bulkPut(
        projects.map((project) => ({
          ...project,
          tags: project.tags.filter((tagId) => tagId !== id),
          updatedAt: now,
        })),
      );

      const logs = await database.workLogs.where('tags').equals(id).toArray();
      const remainingIds = [...new Set(logs.flatMap((log) => log.tags))].filter(
        (tagId) => tagId !== id,
      );
      const remainingTags =
        remainingIds.length > 0 ? await database.tags.bulkGet(remainingIds) : [];
      const nameById = new Map(
        remainingTags
          .filter((item): item is Tag => item !== undefined)
          .map((item) => [item.id, item.name]),
      );
      await database.workLogs.bulkPut(
        logs.map((log) => {
          const tags = log.tags.filter((tagId) => tagId !== id);
          const tagNames = tags.map((tagId) => nameById.get(tagId) ?? '').join(' ');
          return {
            ...log,
            tags,
            searchText: toSearchText([
              log.title,
              log.content,
              log.insight,
              log.problem,
              log.solution,
              log.taskTitleSnapshot,
              log.projectNameSnapshot,
              tagNames,
            ]),
            updatedAt: now,
          };
        }),
      );
    },
  );
}

export interface TagUsage {
  tasks: number;
  projects: number;
  logs: number;
}

export async function countTagUsage(id: Id, database: WorkbenchDatabase = db): Promise<TagUsage> {
  const [tasks, projects, logs] = await Promise.all([
    database.tasks.where('tags').equals(id).count(),
    database.projects.where('tags').equals(id).count(),
    database.workLogs.where('tags').equals(id).count(),
  ]);
  return { tasks, projects, logs };
}
