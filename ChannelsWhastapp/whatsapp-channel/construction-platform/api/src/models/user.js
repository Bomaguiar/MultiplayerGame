// User model. Phone is the identity (matches WhatsApp). Role drives the menu
// and every permission gate.

import { query } from '../db.js';

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
