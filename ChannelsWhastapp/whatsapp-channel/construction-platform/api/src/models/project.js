// Project / phase / milestone model + access scoping.

import { query } from '../db.js';

/**
 * Pure access rule, exported for testing and reuse by other modules.
 * - founder/admin: every project
 * - customer: only projects where they are the client
 * - worker: only projects they are assigned to
 */
export function canAccessProject(user, project) {
  if (!user || !project) return false;
  if (user.role === 'admin' || user.role === 'founder') return true;
  if (user.role === 'customer') return project.client_phone === user.phone;
  if (user.role === 'worker') {
    return Array.isArray(project.worker_phones) && project.worker_phones.includes(user.phone);
  }
  return false;
}

// ── Projects ────────────────────────────────────────────────────────────────
export async function createProject({ name, address, clientPhone, workerPhones = [], budget = 0, startsOn = null, endsOn = null }) {
  const { rows } = await query(
    `INSERT INTO projects (name, address, client_phone, worker_phones, budget, starts_on, ends_on)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [name, address ?? null, clientPhone, workerPhones, budget, startsOn, endsOn]
  );
  return rows[0];
}

export async function getProject(id) {
  const { rows } = await query(`SELECT * FROM projects WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

/** List projects visible to a user (scoped by role). */
export async function listProjectsForUser(user) {
  if (user.role === 'admin' || user.role === 'founder') {
    const { rows } = await query(`SELECT * FROM projects ORDER BY created_at DESC`);
    return rows;
  }
  if (user.role === 'customer') {
    const { rows } = await query(
      `SELECT * FROM projects WHERE client_phone = $1 ORDER BY created_at DESC`, [user.phone]);
    return rows;
  }
  // worker
  const { rows } = await query(
    `SELECT * FROM projects WHERE $1 = ANY(worker_phones) ORDER BY created_at DESC`, [user.phone]);
  return rows;
}

export async function updateProject(id, fields) {
  const allowed = ['name', 'address', 'status', 'budget', 'starts_on', 'ends_on', 'worker_phones'];
  const sets = [];
  const vals = [];
  let i = 1;
  for (const k of allowed) {
    if (k in fields) { sets.push(`${k} = $${i++}`); vals.push(fields[k]); }
  }
  if (!sets.length) return getProject(id);
  vals.push(id);
  const { rows } = await query(
    `UPDATE projects SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals);
  return rows[0] ?? null;
}

// ── Phases ──────────────────────────────────────────────────────────────────
export async function createPhase({ projectId, name, position = 0 }) {
  const { rows } = await query(
    `INSERT INTO phases (project_id, name, position) VALUES ($1,$2,$3) RETURNING *`,
    [projectId, name, position]
  );
  return rows[0];
}

export async function listPhases(projectId) {
  const { rows } = await query(
    `SELECT * FROM phases WHERE project_id = $1 ORDER BY position, id`, [projectId]);
  return rows;
}

// ── Milestones ──────────────────────────────────────────────────────────────
export async function createMilestone({ phaseId, name, dueOn = null, pctComplete = 0 }) {
  const { rows } = await query(
    `INSERT INTO milestones (phase_id, name, due_on, pct_complete)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [phaseId, name, dueOn, pctComplete]
  );
  return rows[0];
}

export async function listMilestones(phaseId) {
  const { rows } = await query(
    `SELECT * FROM milestones WHERE phase_id = $1 ORDER BY due_on NULLS LAST, id`, [phaseId]);
  return rows;
}
