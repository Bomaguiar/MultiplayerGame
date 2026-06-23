// Material request model. Workers request; founders approve/deny; approved
// items move through ordered → delivered.

import { query } from '../db.js';

export async function createRequest({ projectId, requestedBy, item, qty = 1, unit = null, urgency = 'normal' }) {
  const { rows } = await query(
    `INSERT INTO material_requests (project_id, requested_by, item, qty, unit, urgency)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [projectId, requestedBy, item, qty, unit, urgency]
  );
  return rows[0];
}

export async function getRequest(id) {
  const { rows } = await query(`SELECT * FROM material_requests WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

/** Decide a request: 'approved' (→ becomes orderable) or 'denied'. */
export async function decideRequest(id, decision, byPhone) {
  if (!['approved', 'denied'].includes(decision)) throw new Error(`invalid decision: ${decision}`);
  const next = decision === 'approved' ? 'ordered' : 'denied';
  const { rows } = await query(
    `UPDATE material_requests SET status = $1, decided_by = $2 WHERE id = $3 RETURNING *`,
    [next, byPhone, id]
  );
  return rows[0] ?? null;
}

export async function markDelivered(id) {
  const { rows } = await query(
    `UPDATE material_requests SET status = 'delivered' WHERE id = $1 RETURNING *`, [id]);
  return rows[0] ?? null;
}

/** List requests, optionally filtered by project and/or status. */
export async function listRequests({ projectId = null, status = null } = {}) {
  const where = [];
  const vals = [];
  let i = 1;
  if (projectId) { where.push(`project_id = $${i++}`); vals.push(projectId); }
  if (status) { where.push(`status = $${i++}`); vals.push(status); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT * FROM material_requests ${clause} ORDER BY
       CASE urgency WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
       created_at DESC`,
    vals
  );
  return rows;
}
