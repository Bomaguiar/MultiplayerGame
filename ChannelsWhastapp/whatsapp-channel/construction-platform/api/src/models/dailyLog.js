// Daily site log model. Photos are kept as references (storage keys / media
// URLs) — the bytes live in object storage / the WhatsApp media path.

import { query } from '../db.js';

export async function createLog({ projectId, authorPhone, note = '', weather = null, crewCount = 0, hours = 0, photoRefs = [] }) {
  const { rows } = await query(
    `INSERT INTO daily_logs (project_id, author_phone, note, weather, crew_count, hours, photo_refs)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [projectId, authorPhone, note, weather, crewCount, hours, photoRefs]
  );
  return rows[0];
}

/** Logs for a project, newest first. */
export async function listLogs(projectId, limit = 50) {
  const { rows } = await query(
    `SELECT * FROM daily_logs WHERE project_id = $1 ORDER BY logged_at DESC LIMIT $2`,
    [projectId, limit]
  );
  return rows;
}
