import type { WorkbenchDatabase } from '@/db/db';
import { db } from '@/db/db';
import type {
  Id,
  Milestone,
  Project,
  ProjectRisk,
  ProjectStatus,
  ProgressMode,
} from '@/domain/types';
import type { ISODate } from '@/lib/period';
import { nowISOString } from '@/lib/clock';
import { createId } from '@/lib/id';

import { ConflictError, NotFoundError, ValidationError } from './errors';

export type RiskLevel = ProjectRisk['level'];

export interface ProjectFilter {
  status?: ProjectStatus | 'all';
  keyword?: string;
  tagId?: Id | 'all';
  archived?: 'active' | 'archived' | 'all';
}

export interface ProjectCreateInput {
  name: string;
  description?: string;
  status?: ProjectStatus;
  startDate?: ISODate | null;
  endDate?: ISODate | null;
  tags?: readonly Id[];
  progressMode?: ProgressMode;
  now?: string;
}

export interface ProjectUpdateInput {
  name?: string;
  description?: string;
  status?: ProjectStatus;
  startDate?: ISODate | null;
  endDate?: ISODate | null;
  tags?: readonly Id[];
  progressMode?: ProgressMode;
  now?: string;
}

export interface MilestoneInput {
  title: string;
  dueDate?: ISODate | null;
  done?: boolean;
}

export interface MilestoneUpdate {
  title?: string;
  dueDate?: ISODate | null;
  done?: boolean;
}

export interface RiskInput {
  title: string;
  level?: RiskLevel;
  status?: ProjectRisk['status'];
  note?: string;
}

export interface RiskUpdate {
  title?: string;
  level?: RiskLevel;
  status?: ProjectRisk['status'];
  note?: string;
}

function requireName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new ValidationError('项目名称不能为空。');
  }
  return trimmed;
}

function compareDates(left: ISODate | null, right: ISODate | null): number {
  if (left === right) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return left < right ? -1 : 1;
}

function matched(project: Project, filter: ProjectFilter): boolean {
  const archived = filter.archived ?? 'active';
  if (archived === 'active' && project.archivedAt !== null) {
    return false;
  }
  if (archived === 'archived' && project.archivedAt === null) {
    return false;
  }
  if (filter.status && filter.status !== 'all' && project.status !== filter.status) {
    return false;
  }
  if (filter.tagId && filter.tagId !== 'all' && !project.tags.includes(filter.tagId)) {
    return false;
  }
  const keyword = filter.keyword?.trim().toLowerCase();
  if (keyword) {
    const haystack = `${project.name} ${project.description}`.toLowerCase();
    if (!haystack.includes(keyword)) {
      return false;
    }
  }
  return true;
}

export async function queryProjects(
  filter: ProjectFilter = {},
  database: WorkbenchDatabase = db,
): Promise<Project[]> {
  const candidates =
    filter.status && filter.status !== 'all'
      ? await database.projects.where('status').equals(filter.status).toArray()
      : await database.projects.toArray();
  return candidates
    .filter((project) => matched(project, filter))
    .sort((left, right) => compareDates(right.updatedAt, left.updatedAt));
}

export async function listProjects(
  filter: ProjectFilter = {},
  database: WorkbenchDatabase = db,
): Promise<Project[]> {
  return queryProjects(filter, database);
}

export async function getProject(
  id: Id,
  database: WorkbenchDatabase = db,
): Promise<Project | undefined> {
  return database.projects.get(id);
}

export async function createProject(
  input: ProjectCreateInput,
  database: WorkbenchDatabase = db,
): Promise<Project> {
  const now = input.now ?? nowISOString();
  const project: Project = {
    id: createId('proj'),
    name: requireName(input.name),
    description: input.description ?? '',
    status: input.status ?? 'active',
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    tags: [...(input.tags ?? [])],
    progressMode: input.progressMode ?? 'auto',
    manualProgress: null,
    milestones: [],
    risks: [],
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await database.projects.add(project);
  return project;
}

export async function updateProject(
  id: Id,
  patch: ProjectUpdateInput,
  database: WorkbenchDatabase = db,
): Promise<Project> {
  const existing = await database.projects.get(id);
  if (!existing) {
    throw new NotFoundError('项目');
  }
  const now = patch.now ?? nowISOString();
  const next: Project = {
    ...existing,
    ...(patch.name !== undefined ? { name: requireName(patch.name) } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.startDate !== undefined ? { startDate: patch.startDate } : {}),
    ...(patch.endDate !== undefined ? { endDate: patch.endDate } : {}),
    ...(patch.tags !== undefined ? { tags: [...patch.tags] } : {}),
    ...(patch.progressMode !== undefined ? { progressMode: patch.progressMode } : {}),
    updatedAt: now,
  };
  await database.projects.put(next);
  return next;
}

export async function archiveProject(id: Id, database: WorkbenchDatabase = db): Promise<Project> {
  const existing = await database.projects.get(id);
  if (!existing) {
    throw new NotFoundError('项目');
  }
  const now = nowISOString();
  const next: Project = { ...existing, archivedAt: now, updatedAt: now };
  await database.projects.put(next);
  return next;
}

export async function restoreProject(id: Id, database: WorkbenchDatabase = db): Promise<Project> {
  const existing = await database.projects.get(id);
  if (!existing) {
    throw new NotFoundError('项目');
  }
  const now = nowISOString();
  const next: Project = { ...existing, archivedAt: null, updatedAt: now };
  await database.projects.put(next);
  return next;
}

export async function countProjectTasks(
  projectId: Id,
  database: WorkbenchDatabase = db,
): Promise<number> {
  return database.tasks.where('projectId').equals(projectId).count();
}

/**
 * 删除项目（D19）：存在关联任务时禁止直接删除，避免任务悬空。
 * 用户可选：先归档项目，或把任务改派到其他项目/清空项目。
 */
export async function deleteProject(id: Id, database: WorkbenchDatabase = db): Promise<void> {
  const existing = await database.projects.get(id);
  if (!existing) {
    throw new NotFoundError('项目');
  }
  const taskCount = await countProjectTasks(id, database);
  if (taskCount > 0) {
    throw new ConflictError(
      `该项目下还有 ${taskCount} 个任务，无法直接删除。请先把任务改派到其他项目，或改为归档项目。`,
    );
  }
  await database.projects.delete(id);
}

/* ------------------------------------------------------------------ *
 * 里程碑
 * ------------------------------------------------------------------ */

export async function addMilestone(
  projectId: Id,
  input: MilestoneInput,
  database: WorkbenchDatabase = db,
): Promise<Project> {
  const project = await database.projects.get(projectId);
  if (!project) {
    throw new NotFoundError('项目');
  }
  const title = input.title.trim();
  if (title.length === 0) {
    throw new ValidationError('里程碑名称不能为空。');
  }
  const now = nowISOString();
  const milestone: Milestone = {
    id: createId('ms'),
    title,
    dueDate: input.dueDate ?? null,
    done: input.done ?? false,
    doneAt: input.done ? now : null,
  };
  const next: Project = {
    ...project,
    milestones: [...project.milestones, milestone],
    updatedAt: now,
  };
  await database.projects.put(next);
  return next;
}

export async function updateMilestone(
  projectId: Id,
  milestoneId: Id,
  patch: MilestoneUpdate,
  database: WorkbenchDatabase = db,
): Promise<Project> {
  const project = await database.projects.get(projectId);
  if (!project) {
    throw new NotFoundError('项目');
  }
  const index = project.milestones.findIndex((item) => item.id === milestoneId);
  if (index < 0) {
    throw new NotFoundError('里程碑');
  }
  const now = nowISOString();
  const current = project.milestones[index] as Milestone;
  const title = patch.title === undefined ? current.title : patch.title.trim();
  if (title.length === 0) {
    throw new ValidationError('里程碑名称不能为空。');
  }
  const done = patch.done ?? current.done;
  const updated: Milestone = {
    ...current,
    title,
    dueDate: patch.dueDate !== undefined ? patch.dueDate : current.dueDate,
    done,
    doneAt: done ? (current.doneAt ?? now) : null,
  };
  const milestones = project.milestones.map((item) => (item.id === milestoneId ? updated : item));
  const next: Project = { ...project, milestones, updatedAt: now };
  await database.projects.put(next);
  return next;
}

export async function removeMilestone(
  projectId: Id,
  milestoneId: Id,
  database: WorkbenchDatabase = db,
): Promise<Project> {
  const project = await database.projects.get(projectId);
  if (!project) {
    throw new NotFoundError('项目');
  }
  const now = nowISOString();
  const next: Project = {
    ...project,
    milestones: project.milestones.filter((item) => item.id !== milestoneId),
    updatedAt: now,
  };
  await database.projects.put(next);
  return next;
}

/* ------------------------------------------------------------------ *
 * 风险记录
 * ------------------------------------------------------------------ */

export async function addRisk(
  projectId: Id,
  input: RiskInput,
  database: WorkbenchDatabase = db,
): Promise<Project> {
  const project = await database.projects.get(projectId);
  if (!project) {
    throw new NotFoundError('项目');
  }
  const title = input.title.trim();
  if (title.length === 0) {
    throw new ValidationError('风险标题不能为空。');
  }
  const now = nowISOString();
  const risk: ProjectRisk = {
    id: createId('risk'),
    title,
    level: input.level ?? 'medium',
    status: input.status ?? 'open',
    note: input.note ?? '',
    createdAt: now,
  };
  const next: Project = { ...project, risks: [...project.risks, risk], updatedAt: now };
  await database.projects.put(next);
  return next;
}

export async function updateRisk(
  projectId: Id,
  riskId: Id,
  patch: RiskUpdate,
  database: WorkbenchDatabase = db,
): Promise<Project> {
  const project = await database.projects.get(projectId);
  if (!project) {
    throw new NotFoundError('项目');
  }
  const index = project.risks.findIndex((item) => item.id === riskId);
  if (index < 0) {
    throw new NotFoundError('风险记录');
  }
  const now = nowISOString();
  const current = project.risks[index] as ProjectRisk;
  const title = patch.title === undefined ? current.title : patch.title.trim();
  if (title.length === 0) {
    throw new ValidationError('风险标题不能为空。');
  }
  const updated: ProjectRisk = {
    ...current,
    title,
    level: patch.level ?? current.level,
    status: patch.status ?? current.status,
    note: patch.note ?? current.note,
  };
  const risks = project.risks.map((item) => (item.id === riskId ? updated : item));
  const next: Project = { ...project, risks, updatedAt: now };
  await database.projects.put(next);
  return next;
}

export async function removeRisk(
  projectId: Id,
  riskId: Id,
  database: WorkbenchDatabase = db,
): Promise<Project> {
  const project = await database.projects.get(projectId);
  if (!project) {
    throw new NotFoundError('项目');
  }
  const now = nowISOString();
  const next: Project = {
    ...project,
    risks: project.risks.filter((item) => item.id !== riskId),
    updatedAt: now,
  };
  await database.projects.put(next);
  return next;
}
