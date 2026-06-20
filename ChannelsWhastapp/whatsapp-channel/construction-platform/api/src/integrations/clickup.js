import { query } from '../db.js';

const STATUS_MAP = {
  'to do': 'todo',
  'open': 'todo',
  'in progress': 'doing',
  'in review': 'doing',
  'blocked': 'blocked',
  'complete': 'done',
  'done': 'done',
  'closed': 'done',
};

const PRIORITY_MAP = {
  1: 'urgent',
  2: 'high',
  3: 'normal',
  4: 'low',
};

function mapClickUpStatus(cuStatus) {
  return STATUS_MAP[(cuStatus || '').toLowerCase()] ?? 'todo';
}

function mapClickUpPriority(cuPriority) {
  if (!cuPriority) return 'normal';
  if (typeof cuPriority === 'object') return PRIORITY_MAP[cuPriority.id] ?? 'normal';
  return PRIORITY_MAP[cuPriority] ?? 'normal';
}

function parseDueDate(tsMs) {
  if (!tsMs) return null;
  const d = new Date(Number(tsMs));
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function mapClickUpTask(cuTask) {
  return {
    clickupTaskId: cuTask.id,
    clickupUrl: cuTask.url,
    clickupListId: cuTask.list?.id ?? null,
    title: cuTask.name,
    status: mapClickUpStatus(cuTask.status),
    priority: mapClickUpPriority(cuTask.priority),
    dueOn: parseDueDate(cuTask.due_date),
    assigneeName: cuTask.assignees?.[0]?.username ?? null,
    tags: (cuTask.tags || []).map(t => t.name ?? t),
    listName: cuTask.list?.name ?? null,
  };
}

export async function upsertClickUpTask(projectId, mapped) {
  const existing = await query(
    `SELECT id FROM tasks WHERE clickup_task_id = $1`, [mapped.clickupTaskId]
  );

  if (existing.rows.length) {
    const { rows } = await query(
      `UPDATE tasks SET title = $1, status = $2, priority = $3, due_on = $4,
              assignee_name = $5, tags = $6, clickup_url = $7, clickup_list_id = $8
       WHERE clickup_task_id = $9 RETURNING *`,
      [mapped.title, mapped.status, mapped.priority, mapped.dueOn,
       mapped.assigneeName, mapped.tags, mapped.clickupUrl, mapped.clickupListId,
       mapped.clickupTaskId]
    );
    return { task: rows[0], action: 'updated' };
  }

  const { rows } = await query(
    `INSERT INTO tasks (project_id, title, status, priority, due_on,
       assignee_name, tags, clickup_task_id, clickup_url, clickup_list_id, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'clickup') RETURNING *`,
    [projectId, mapped.title, mapped.status, mapped.priority, mapped.dueOn,
     mapped.assigneeName, mapped.tags, mapped.clickupTaskId, mapped.clickupUrl,
     mapped.clickupListId]
  );
  return { task: rows[0], action: 'created' };
}

export async function syncClickUpBatch(projectId, clickupTasks) {
  const results = { created: 0, updated: 0, errors: [] };
  for (const cuTask of clickupTasks) {
    try {
      const mapped = mapClickUpTask(cuTask);
      const { action } = await upsertClickUpTask(projectId, mapped);
      results[action]++;
    } catch (e) {
      results.errors.push({ id: cuTask.id, name: cuTask.name, error: String(e.message) });
    }
  }
  return results;
}

export async function listClickUpTasks(projectId) {
  const { rows } = await query(
    `SELECT * FROM tasks WHERE project_id = $1 AND source = 'clickup'
     ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
     due_on NULLS LAST, id`,
    [projectId]
  );
  return rows;
}
