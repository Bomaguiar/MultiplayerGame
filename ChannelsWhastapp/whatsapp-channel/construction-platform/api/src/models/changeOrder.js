import { query } from '../db.js';

export const CO_STATUSES = Object.freeze(['proposed', 'approved', 'rejected', 'cancelled']);

export async function createChangeOrder({ projectId, title, description = null, costDelta = 0, daysDelta = 0, proposedBy }) {
  const { rows } = await query(
    `INSERT INTO change_orders (project_id, title, description, cost_delta, days_delta, proposed_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [projectId, title, description, costDelta, daysDelta, proposedBy]
  );
  return rows[0];
}

export async function getChangeOrder(id) {
  const { rows } = await query(`SELECT * FROM change_orders WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function listChangeOrders({ projectId = null, status = null } = {}) {
  const where = [];
  const vals = [];
  let i = 1;
  if (projectId) { where.push(`project_id = $${i++}`); vals.push(projectId); }
  if (status) { where.push(`status = $${i++}`); vals.push(status); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT * FROM change_orders ${clause} ORDER BY created_at DESC`, vals
  );
  return rows;
}

export async function decideChangeOrder(id, decision, byPhone) {
  if (!['approved', 'rejected'].includes(decision)) throw new Error(`invalid decision: ${decision}`);
  const co = await getChangeOrder(id);
  if (!co) return null;
  if (co.status !== 'proposed') throw new Error('only proposed orders can be decided');

  const { rows } = await query(
    `UPDATE change_orders SET status = $1, decided_by = $2, decided_at = now()
     WHERE id = $3 RETURNING *`,
    [decision, byPhone, id]
  );

  if (decision === 'approved' && rows[0]) {
    await query(
      `UPDATE projects SET budget = budget + $1 WHERE id = $2`,
      [co.cost_delta, co.project_id]
    );
  }

  return rows[0];
}

export async function cancelChangeOrder(id) {
  const { rows } = await query(
    `UPDATE change_orders SET status = 'cancelled' WHERE id = $1 AND status = 'proposed' RETURNING *`,
    [id]
  );
  return rows[0] ?? null;
}

export async function budgetSummary(projectId) {
  // Computed with separate aggregates (no cross-join, no FILTER) so the numbers
  // are correct on real Postgres AND on the pg-mem demo. Joining change_orders
  // and material_requests in one query would multiply rows and inflate the sums.
  const proj = await query(`SELECT budget FROM projects WHERE id = $1`, [projectId]);
  if (!proj.rows.length) return null;

  const co = await query(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'approved' THEN cost_delta ELSE 0 END), 0) AS approved_changes,
       COALESCE(SUM(CASE WHEN status = 'proposed' THEN cost_delta ELSE 0 END), 0) AS pending_changes,
       COALESCE(SUM(CASE WHEN status = 'proposed' THEN 1 ELSE 0 END), 0) AS pending_count,
       COALESCE(SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END), 0) AS approved_count
     FROM change_orders WHERE project_id = $1`,
    [projectId]
  );

  const mat = await query(
    `SELECT COALESCE(SUM(CASE WHEN status IN ('ordered', 'delivered') THEN 1 ELSE 0 END), 0) AS material_items
     FROM material_requests WHERE project_id = $1`,
    [projectId]
  );

  return {
    current_budget: proj.rows[0].budget,
    ...co.rows[0],
    ...mat.rows[0],
  };
}
