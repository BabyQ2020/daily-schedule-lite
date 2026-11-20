import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { WorkbenchDatabase } from '@/db/db';
import { createProject } from '@/repositories/projects';
import { createTask, deleteTasks } from '@/repositories/tasks';
import { createLog } from '@/repositories/logs';
import { createTag } from '@/repositories/tags';
import { createTestDatabase, destroyTestDatabase } from '@/test/db';
import {
  escapeCsvCell,
  exportLogsCsv,
  exportTasksCsv,
  logCsvFileName,
  taskCsvFileName,
  toCsv,
  TASK_CSV_HEADERS,
} from '@/services/exporters';

const NOW = new Date(2026, 10, 16, 9, 30, 0);

describe('CSV 序列化', () => {
  it('以 BOM 开头，使用 CRLF 与固定表头', () => {
    const text = toCsv(TASK_CSV_HEADERS, [['写日报', '项目 A', '已完成']]);

    expect(text.startsWith('\uFEFF')).toBe(true);
    expect(text).toContain('标题,项目,状态');
    expect(text.split('\r\n').length).toBe(3);
  });

  it('逗号、引号与换行会加引号并转义', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('说"你好"')).toBe('"说""你好"""');
    expect(escapeCsvCell('第一行\n第二行')).toBe('"第一行\n第二行"');
    expect(escapeCsvCell('普通文本')).toBe('普通文本');
  });

  it('公式前缀会加单引号，避免被 Excel 当公式执行', () => {
    expect(escapeCsvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(escapeCsvCell('+1')).toBe("'+1");
    expect(escapeCsvCell('-1')).toBe("'-1");
    expect(escapeCsvCell('@cmd')).toBe("'@cmd");
  });

  it('文件名带导出日期', () => {
    expect(taskCsvFileName(NOW)).toBe('daily-schedule-lite-任务-20261116.csv');
    expect(logCsvFileName(NOW)).toBe('daily-schedule-lite-日志-20261116.csv');
  });
});

describe('导出任务 CSV', () => {
  let database: WorkbenchDatabase;

  beforeEach(() => {
    database = createTestDatabase('exporter-tasks');
  });

  afterEach(async () => {
    await destroyTestDatabase(database);
  });

  it('把项目、状态、优先级、标签翻译成可读文本', async () => {
    const project = await createProject({ name: '离线改造' }, database);
    const tag = await createTag({ name: '前端', kind: 'task' }, database);
    const task = await createTask(
      {
        title: '补离线缓存',
        description: '使用 Service Worker',
        projectId: project.id,
        status: 'done',
        priority: 'high',
        planDate: '2026-11-16',
        dueDate: '2026-11-20',
        tags: [tag.id],
        note: '注意版本号',
      },
      database,
    );

    const result = await exportTasksCsv(database, NOW);

    expect(result.rowCount).toBe(1);
    expect(result.fileName).toBe('daily-schedule-lite-任务-20261116.csv');
    expect(result.text).toContain('补离线缓存,离线改造,已完成,高');
    expect(result.text).toContain('2026-11-16,2026-11-20');
    expect(result.text).toContain('前端');
    expect(result.text).toContain('使用 Service Worker');
    expect(result.text).toContain('注意版本号');
    // 已完成任务必须有完成时间，说明表单层补时间逻辑在导出前已生效。
    expect(task.completedAt).not.toBeNull();
  });

  it('没有项目与标签时留空单元格而不是 undefined', async () => {
    await createTask({ title: '独立任务' }, database);

    const result = await exportTasksCsv(database, NOW);

    expect(result.text).toContain('独立任务,,待办,中,,,');
    expect(result.text).not.toContain('undefined');
  });
});

describe('导出日志 CSV', () => {
  let database: WorkbenchDatabase;

  beforeEach(() => {
    database = createTestDatabase('exporter-logs');
  });

  afterEach(async () => {
    await destroyTestDatabase(database);
  });

  it('按日期倒序，并保留任务快照', async () => {
    const task = await createTask({ title: '补离线缓存' }, database);
    await createLog({ date: '2026-11-10', title: '较早的日志', content: '正文 A' }, database);
    await createLog(
      {
        date: '2026-11-16',
        title: '今天的日志',
        content: '正文 B',
        insight: '心得',
        problem: '问题',
        solution: '方案',
        taskId: task.id,
      },
      database,
    );
    // 删除任务后日志应保留标题快照，导出也要能读到。
    await deleteTasks([task.id], database);

    const result = await exportLogsCsv(database, NOW);
    const lines = result.text.replace('\uFEFF', '').split('\r\n');

    expect(result.rowCount).toBe(2);
    expect(lines[0]).toContain('日期,标题,项目,任务快照');
    expect(lines[1]).toContain('2026-11-16,今天的日志');
    expect(lines[1]).toContain('补离线缓存');
    expect(lines[1]).toContain('心得,问题,方案');
    expect(lines[2]).toContain('2026-11-10,较早的日志');
  });
});
