// Conversation memory (T14). Short-term, per-contact context so follow-up
// messages resolve ("and the kitchen one too"). Strictly scoped by contact
// phone AND role — one contact can never read another's (or another role's)
// context — and trimmed to a configured budget so it never grows unbounded.

import { query } from '../db.js';

// Defaults: keep the last N turns within a character budget (a cheap proxy for
// a token budget). Override per call.
export const DEFAULT_MAX_TURNS = 10;
export const DEFAULT_CHAR_BUDGET = 4000;

/** Record one interaction turn for a contact. */
export async function remember({ contactPhone, role, projectId = null, direction = 'in', content }) {
  const { rows } = await query(
    `INSERT INTO conversation_memory (contact_phone, role, project_id, direction, content)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [contactPhone, role, projectId, direction, content]
  );
  // Opportunistically trim so storage stays bounded.
  await trim({ contactPhone, role, maxTurns: DEFAULT_MAX_TURNS }).catch(() => {});
  return rows[0];
}

/**
 * Recall the most recent turns for a contact, oldest→newest (chat order).
 * Scoped by contact_phone AND role; optionally by project. Honours both a turn
 * cap and a character budget — whichever is hit first.
 */
export async function recall({ contactPhone, role, projectId = null, maxTurns = DEFAULT_MAX_TURNS, charBudget = DEFAULT_CHAR_BUDGET } = {}) {
  const where = ['contact_phone = $1', 'role = $2'];
  const vals = [contactPhone, role];
  let i = 3;
  if (projectId != null) { where.push(`project_id = $${i++}`); vals.push(projectId); }
  vals.push(maxTurns);

  const { rows } = await query(
    `SELECT * FROM conversation_memory
     WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC, id DESC
     LIMIT $${i}`,
    vals
  );

  // rows are newest→oldest; apply the char budget from newest backwards, then
  // return in chat order (oldest→newest).
  const kept = [];
  let used = 0;
  for (const r of rows) {
    used += String(r.content || '').length;
    if (kept.length && used > charBudget) break;
    kept.push(r);
  }
  return kept.reverse();
}

/** Trim a contact's memory to the most recent `maxTurns` rows. */
export async function trim({ contactPhone, role, maxTurns = DEFAULT_MAX_TURNS }) {
  await query(
    `DELETE FROM conversation_memory
     WHERE contact_phone = $1 AND role = $2
       AND id NOT IN (
         SELECT id FROM conversation_memory
         WHERE contact_phone = $1 AND role = $2
         ORDER BY created_at DESC, id DESC
         LIMIT $3
       )`,
    [contactPhone, role, maxTurns]
  );
}

/** Render recalled turns into a compact context string for a prompt. */
export function renderContext(turns) {
  return turns
    .map((t) => `${t.direction === 'out' ? 'assistant' : 'user'}: ${t.content}`)
    .join('\n');
}
