// Task model. Status changes are recorded in task_status_history for audit.

import { query } from '../db.js';

export const TASK_STATUSES = Object.freeze(['todo', 'doing', 'blocked', 'done']);

export async function createTask({ projectId, phaseId = null, title, assigneePhone = null, priority = 'normal', dueOn = null }) {
  const { rows } = await query(
    `INSERT INTO tasks (project_id, phase_id, title, assignee_phone, priority, due_on)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [projectId, phaseId, title, assigneePhone, priority, dueOn]
  );
  return rows[0];
}

export async function getTask(id) {
  const { rows } = await query(`SELECT * FROM tasks WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function listTasks(projectId) {
  const { rows } = await query(
    `SELECT * FROM tasks WHERE project_id = $1 ORDER BY
       CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
       due_on NULLS LAST, id`,
    [projectId]
  );
  return rows;
}

export async function assignTask(id, assigneePhone) {
  const { rows } = await query(
    `UPDATE tasks SET assignee_phone = $1 WHERE id = $2 RETURNING *`, [assigneePhone, id]);
  return rows[0] ?? null;
}

/** Transition status and append an audit row. Returns the updated task. */
export async function setStatus(id, toStatus, byPhone) {
  if (!TASK_STATUSES.includes(toStatus)) throw new Error(`invalid status: ${toStatus}`);
  const current = await getTask(id);
  if (!current) return null;
  const { rows } = await query(
    `UPDATE tasks SET status = $1 WHERE id = $2 RETURNING *`, [toStatus, id]);
  await query(
    `INSERT INTO task_status_history (task_id, from_status, to_status, by_phone)
     VALUES ($1,$2,$3,$4)`,
    [id, current.status, toStatus, byPhone]
  );
  return rows[0];
}

export async function listHistory(taskId) {
  const { rows } = await query(
    `SELECT * FROM task_status_history WHERE task_id = $1 ORDER BY changed_at, id`, [taskId]);
  return rows;
}
