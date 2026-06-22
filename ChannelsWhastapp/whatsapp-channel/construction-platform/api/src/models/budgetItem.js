import { query } from '../db.js';

export const ITEM_STATUSES = Object.freeze(['planned', 'in_progress', 'completed', 'over_budget']);

export async function createBudgetItem({ projectId, category, description, estimated = 0, actual = null, status = 'planned', vendor = null, notes = null }) {
  const { rows } = await query(
    `INSERT INTO budget_items (project_id, category, description, estimated, actual, status, vendor, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [projectId, category, description, estimated, actual, status, vendor, notes]
  );
  return rows[0];
}

export async function updateBudgetItem(id, fields) {
  const allowed = ['category', 'description', 'estimated', 'actual', 'status', 'vendor', 'notes'];
  const sets = [];
  const vals = [];
  let i = 1;
  for (const k of allowed) {
    if (k in fields) {
      sets.push(`${k} = $${i++}`);
      vals.push(fields[k]);
    }
  }
  if (!sets.length) return null;
  vals.push(id);
  const { rows } = await query(
    `UPDATE budget_items SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals
  );
  return rows[0] ?? null;
}

export async function listBudgetItems(projectId) {
  const { rows } = await query(
    `SELECT * FROM budget_items WHERE project_id = $1 ORDER BY category, id`, [projectId]
  );
  return rows;
}

export async function getBudgetItem(id) {
  const { rows } = await query(`SELECT * FROM budget_items WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function deleteBudgetItem(id) {
  const { rows } = await query(`DELETE FROM budget_items WHERE id = $1 RETURNING *`, [id]);
  return rows[0] ?? null;
}

export async function budgetBreakdown(projectId) {
  const { rows } = await query(
    `SELECT
       category,
       SUM(estimated) AS estimated,
       SUM(CASE WHEN actual IS NOT NULL THEN actual ELSE 0 END) AS actual,
       COUNT(*) AS items,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
     FROM budget_items
     WHERE project_id = $1
     GROUP BY category
     ORDER BY category`,
    [projectId]
  );
  const totals = await query(
    `SELECT
       COALESCE(SUM(estimated), 0) AS total_estimated,
       COALESCE(SUM(CASE WHEN actual IS NOT NULL THEN actual ELSE 0 END), 0) AS total_actual,
       COUNT(*) AS total_items,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS total_completed
     FROM budget_items WHERE project_id = $1`,
    [projectId]
  );
  return { categories: rows, totals: totals.rows[0] };
}
