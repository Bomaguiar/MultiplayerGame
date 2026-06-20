CREATE TABLE IF NOT EXISTS notifications (
    id               BIGSERIAL PRIMARY KEY,
    project_id       BIGINT REFERENCES projects(id) ON DELETE CASCADE,
    recipient_phone  TEXT NOT NULL,
    type             TEXT NOT NULL
                     CHECK (type IN ('task_update', 'material_decision', 'change_order', 'daily_log', 'system')),
    title            TEXT NOT NULL,
    body             TEXT,
    channel          TEXT NOT NULL DEFAULT 'in_app'
                     CHECK (channel IN ('whatsapp', 'email', 'in_app')),
    status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'sent', 'read', 'failed')),
    metadata         JSONB DEFAULT '{}',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications (recipient_phone, status);
CREATE INDEX IF NOT EXISTS idx_notifications_project   ON notifications (project_id);
CREATE INDEX IF NOT EXISTS idx_notifications_type      ON notifications (type);
