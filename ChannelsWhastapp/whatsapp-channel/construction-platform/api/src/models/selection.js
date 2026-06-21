// Client selections model (T16). The founder proposes a selection (a finish or
// material the client must choose), optionally with a set of options and a
// price impact. The client approves — picking an option and typing their name
// as an e-signature — or declines. Approval is captured with the signer's name
// and a timestamp so the sign-off is auditable.

import { query } from '../db.js';

export const SELECTION_STATUSES = Object.freeze(['pending', 'approved', 'declined']);

export async function createSelection({
  projectId, room = null, name, description = null,
  options = [], price = 0, dueOn = null, proposedBy,
}) {
  if (!name) throw new Error('name required');
  const opts = Array.isArray(options) ? options : [];
  const { rows } = await query(
    `INSERT INTO selections (project_id, room, name, description, options, price, due_on, proposed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [projectId, room, name, description, JSON.stringify(opts), price, dueOn, proposedBy]
  );
  return rows[0];
}

export async function getSelection(id) {
  const { rows } = await query(`SELECT * FROM selections WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function listSelections({ projectId = null, status = null } = {}) {
  const where = [];
  const vals = [];
  let i = 1;
  if (projectId) { where.push(`project_id = $${i++}`); vals.push(projectId); }
  if (status) { where.push(`status = $${i++}`); vals.push(status); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT * FROM selections ${clause}
     ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC`,
    vals
  );
  return rows;
}

/**
 * Client decides a selection. `decision` is 'approved' or 'declined'.
 * Approving requires a typed `signedName` (the e-signature) and records the
 * chosen option, the signer's name, who decided, and when. Only a pending
 * selection can be decided.
 */
export async function decideSelection(id, { decision, chosenOption = null, signedName = null } = {}, byPhone) {
  if (!['approved', 'declined'].includes(decision)) throw new Error(`invalid decision: ${decision}`);
  const sel = await getSelection(id);
  if (!sel) return null;
  if (sel.status !== 'pending') throw new Error('only pending selections can be decided');
  if (decision === 'approved' && !String(signedName ?? '').trim()) {
    throw new Error('signature required to approve');
  }

  const { rows } = await query(
    `UPDATE selections
       SET status = $1, chosen_option = $2, signed_name = $3,
           decided_by = $4, decided_at = now()
     WHERE id = $5 RETURNING *`,
    [decision, chosenOption, decision === 'approved' ? String(signedName).trim() : null, byPhone, id]
  );
  return rows[0] ?? null;
}
