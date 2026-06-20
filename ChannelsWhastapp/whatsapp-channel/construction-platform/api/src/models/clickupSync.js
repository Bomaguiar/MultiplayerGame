import { query } from '../db.js';

export async function saveMapping({ entityType, entityId, clickupTaskId, clickupListId = null }) {
  const { rows } = await query(
    `INSERT INTO clickup_sync (entity_type, entity_id, clickup_task_id, clickup_list_id)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (entity_type, entity_id)
     DO UPDATE SET clickup_task_id = $3, clickup_list_id = $4, synced_at = now()
     RETURNING *`,
    [entityType, entityId, clickupTaskId, clickupListId]
  );
  return rows[0];
}

export async function getMapping(entityType, entityId) {
  const { rows } = await query(
    `SELECT * FROM clickup_sync WHERE entity_type = $1 AND entity_id = $2`,
    [entityType, entityId]
  );
  return rows[0] ?? null;
}

export async function listMappings(entityType) {
  const { rows } = await query(
    `SELECT * FROM clickup_sync WHERE entity_type = $1 ORDER BY synced_at DESC`,
    [entityType]
  );
  return rows;
}

export async function deleteMapping(entityType, entityId) {
  const { rows } = await query(
    `DELETE FROM clickup_sync WHERE entity_type = $1 AND entity_id = $2 RETURNING *`,
    [entityType, entityId]
  );
  return rows[0] ?? null;
}
