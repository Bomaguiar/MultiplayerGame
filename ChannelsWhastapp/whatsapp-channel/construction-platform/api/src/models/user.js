// User model. Phone is the identity (matches WhatsApp). Role drives the menu
// and every permission gate.

import { query, withTransaction } from '../db.js';

export const ROLES = Object.freeze(['customer', 'worker', 'founder', 'admin']);

export function isRole(r) {
  return ROLES.includes(r);
}

/** Create (or upsert) a user by phone. */
export async function createUser({ phone, name, role }) {
  if (!isRole(role)) throw new Error(`invalid role: ${role}`);
  const { rows } = await query(
    `INSERT INTO users (phone, name, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role
     RETURNING id, phone, name, role`,
    [phone, name ?? null, role]
  );
  return rows[0];
}

/** Look up a user (and their role) by phone. Returns null if not found. */
export async function findByPhone(phone) {
  const { rows } = await query(
    `SELECT id, phone, name, role FROM users WHERE phone = $1`,
    [phone]
  );
  return rows[0] ?? null;
}

/** Convenience: resolve just the role for a phone, or null. */
export async function roleForPhone(phone) {
  const u = await findByPhone(phone);
  return u ? u.role : null;
}

/** All users holding a given role. Used to resolve notification recipients. */
export async function usersByRole(role) {
  const { rows } = await query(
    `SELECT id, phone, name, role FROM users WHERE role = $1 ORDER BY id`,
    [role]
  );
  return rows;
}

/** Every user, ordered founder → admin → worker → customer, then by name. */
export async function listUsers() {
  const { rows } = await query(
    `SELECT id, phone, name, role, created_at FROM users
     ORDER BY CASE role WHEN 'founder' THEN 0 WHEN 'admin' THEN 1 WHEN 'worker' THEN 2 ELSE 3 END,
              name NULLS LAST, id`
  );
  return rows;
}

/**
 * Update a user's name and/or role by phone (phone is identity, never changed).
 * Returns the updated row, or null if no such user.
 */
export async function updateUser(phone, { name, role } = {}) {
  if (role !== undefined && !isRole(role)) throw new Error(`invalid role: ${role}`);
  const sets = [];
  const vals = [];
  let i = 1;
  if (name !== undefined) { sets.push(`name = $${i++}`); vals.push(name); }
  if (role !== undefined) { sets.push(`role = $${i++}`); vals.push(role); }
  if (!sets.length) return findByPhone(phone);
  vals.push(phone);
  const { rows } = await query(
    `UPDATE users SET ${sets.join(', ')} WHERE phone = $${i}
     RETURNING id, phone, name, role`,
    vals
  );
  return rows[0] ?? null;
}

/**
 * Change a user's phone number — the one piece of "identity" that used to be
 * immutable. Because phone is denormalized (stored as a plain string) across
 * many tables, we cascade the rename through all of them in a single
 * transaction so history, tasks, logs, materials and notifications keep
 * pointing at the same person.
 *
 * Returns the updated user row, or null if `oldPhone` doesn't exist. Throws if
 * `newPhone` is blank or already belongs to someone else.
 */
export async function changeUserPhone(oldPhone, newPhone) {
  const next = String(newPhone ?? '').trim();
  if (!next) throw new Error('newPhone is required');

  const existing = await findByPhone(oldPhone);
  if (!existing) return null;
  if (next === oldPhone) return existing;

  const clash = await findByPhone(next);
  if (clash) throw new Error('phone already in use');

  return withTransaction(async (q) => {
    // 1:1 string columns that reference a user's phone.
    const renames = [
      ['users',             'phone'],
      ['projects',          'client_phone'],
      ['material_requests', 'requested_by'],
      ['material_requests', 'decided_by'],
      ['daily_logs',        'author_phone'],
      ['notifications',     'recipient_phone'],
      ['customer_requests', 'customer_phone'],
      ['tasks',             'assignee_phone'],
      ['task_status_history', 'by_phone'],
      ['conversation_memory', 'contact_phone'],
    ];
    for (const [table, col] of renames) {
      await q(`UPDATE ${table} SET ${col} = $1 WHERE ${col} = $2`, [next, oldPhone]);
    }

    // worker_phones is a TEXT[] — rewrite any array that contains the old phone.
    const { rows: projs } = await q('SELECT id, worker_phones FROM projects', []);
    for (const pr of projs) {
      const arr = pr.worker_phones || [];
      if (arr.includes(oldPhone)) {
        const updated = arr.map((p) => (p === oldPhone ? next : p));
        await q('UPDATE projects SET worker_phones = $1 WHERE id = $2', [updated, pr.id]);
      }
    }

    const { rows } = await q(
      'SELECT id, phone, name, role FROM users WHERE phone = $1', [next]);
    return rows[0] ?? null;
  });
}
