// Customer request model (T11). A request can arrive as text or as a
// transcribed voice note. Triage fields (category/urgency) are filled later by
// the brain (T12).

import { query } from '../db.js';

export const REQUEST_CHANNELS   = Object.freeze(['text', 'voice']);
export const REQUEST_STATUSES   = Object.freeze(['new', 'triaged', 'resolved', 'closed']);
export const REQUEST_CATEGORIES = Object.freeze(['issue', 'question', 'change_request', 'scheduling', 'complaint']);

export async function createCustomerRequest({ projectId = null, customerPhone, channel = 'text', rawText, mediaRef = null }) {
  const { rows } = await query(
    `INSERT INTO customer_requests (project_id, customer_phone, channel, raw_text, media_ref)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [projectId, customerPhone, channel, rawText, mediaRef]
  );
  return rows[0];
}

export async function getCustomerRequest(id) {
  const { rows } = await query(`SELECT * FROM customer_requests WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function listCustomerRequests({ projectId = null, customerPhone = null, status = null, limit = 50 } = {}) {
  const where = [];
  const vals = [];
  let i = 1;
  if (projectId)     { where.push(`project_id = $${i++}`);     vals.push(projectId); }
  if (customerPhone) { where.push(`customer_phone = $${i++}`); vals.push(customerPhone); }
  if (status)        { where.push(`status = $${i++}`);         vals.push(status); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  vals.push(limit);
  const { rows } = await query(
    `SELECT * FROM customer_requests ${clause} ORDER BY created_at DESC LIMIT $${i}`, vals);
  return rows;
}

/** Record triage results (category + urgency) and mark the request triaged. */
export async function setTriage(id, { category, urgency }) {
  const { rows } = await query(
    `UPDATE customer_requests
     SET category = $1, urgency = $2, status = 'triaged', triaged_at = now()
     WHERE id = $3 RETURNING *`,
    [category, urgency, id]
  );
  return rows[0] ?? null;
}
