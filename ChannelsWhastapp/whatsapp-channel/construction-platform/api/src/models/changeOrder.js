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
  const { rows } = await query(
    `SELECT
       p.budget AS current_budget,
       COALESCE(SUM(co.cost_delta) FILTER (WHERE co.status = 'approved'), 0) AS approved_changes,
       COALESCE(SUM(co.cost_delta) FILTER (WHERE co.status = 'proposed'), 0) AS pending_changes,
       COUNT(*) FILTER (WHERE co.status = 'proposed') AS pending_count,
       COUNT(*) FILTER (WHERE co.status = 'approved') AS approved_count,
       COALESCE(SUM(mr.qty * COALESCE(mr.qty, 1)) FILTER (WHERE mr.status IN ('ordered', 'delivered')), 0) AS material_items
     FROM projects p
     LEFT JOIN change_orders co ON co.project_id = p.id
     LEFT JOIN material_requests mr ON mr.project_id = p.id
     WHERE p.id = $1
     GROUP BY p.id, p.budget`,
    [projectId]
  );
  return rows[0] ?? null;
}
