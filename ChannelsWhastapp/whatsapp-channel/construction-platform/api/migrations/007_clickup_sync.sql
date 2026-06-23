-- ClickUp sync mapping: links internal entities to ClickUp task IDs
CREATE TABLE IF NOT EXISTS clickup_sync (
    id              BIGSERIAL PRIMARY KEY,
    entity_type     TEXT NOT NULL,
    entity_id       BIGINT NOT NULL,
    clickup_task_id TEXT NOT NULL,
    clickup_list_id TEXT,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_clickup_entity ON clickup_sync (entity_type, entity_id);
