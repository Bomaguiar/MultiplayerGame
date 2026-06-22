// Notification model. Persistent DB-backed notifications for all channels.

import { query } from '../db.js';

export const NOTIFICATION_TYPES = Object.freeze([
  'task_update', 'material_decision', 'change_order', 'daily_log', 'system',
]);

export const NOTIFICATION_CHANNELS = Object.freeze(['whatsapp', 'email', 'in_app']);

export const NOTIFICATION_STATUSES = Object.freeze(['pending', 'sent', 'read', 'failed']);

export async function createNotification({ projectId = null, recipientPhone, type, title, body = null, channel = 'in_app', metadata = {} }) {
  const { rows } = await query(
    `INSERT INTO notifications (project_id, recipient_phone, type, title, body, channel, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [projectId, recipientPhone, type, title, body, channel, JSON.stringify(metadata)],
  );
  return rows[0];
}

export async function listNotifications({ recipientPhone, projectId = null, status = null, type = null, limit = 50 } = {}) {
  const where = ['recipient_phone = $1'];
  const vals = [recipientPhone];
  let i = 2;
  if (projectId) { where.push(`project_id = $${i++}`); vals.push(projectId); }
  if (status)    { where.push(`status = $${i++}`);     vals.push(status); }
  if (type)      { where.push(`type = $${i++}`);       vals.push(type); }
  vals.push(limit);
  const { rows } = await query(
    `SELECT * FROM notifications WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC LIMIT $${i}`,
    vals,
  );
  return rows;
}

/** Pending outbound messages for a channel (default whatsapp), oldest first —
 *  the delivery bridge drains this. Not scoped to one recipient. */
export async function listOutbox({ channel = 'whatsapp', limit = 50 } = {}) {
  const { rows } = await query(
    `SELECT * FROM notifications WHERE channel = $1 AND status = 'pending'
     ORDER BY created_at ASC LIMIT $2`,
    [channel, limit],
  );
  return rows;
}

export async function markRead(id) {
  const { rows } = await query(
    `UPDATE notifications SET status = 'read' WHERE id = $1 RETURNING *`,
    [id],
  );
  return rows[0] ?? null;
}

export async function markSent(id) {
  const { rows } = await query(
    `UPDATE notifications SET status = 'sent', sent_at = now() WHERE id = $1 RETURNING *`,
    [id],
  );
  return rows[0] ?? null;
}

export async function countUnread(recipientPhone) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS count FROM notifications
     WHERE recipient_phone = $1 AND status IN ('pending', 'sent')`,
    [recipientPhone],
  );
  return rows[0].count;
}
