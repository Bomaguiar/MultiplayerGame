-- T14: per-contact conversation memory for the brain. Scoped by contact phone
-- AND role so context never leaks across people or roles.
CREATE TABLE IF NOT EXISTS conversation_memory (
    id            BIGSERIAL PRIMARY KEY,
    contact_phone TEXT NOT NULL,
    role          TEXT NOT NULL,
    project_id    BIGINT REFERENCES projects(id) ON DELETE CASCADE,
    direction     TEXT NOT NULL DEFAULT 'in'
                  CHECK (direction IN ('in', 'out')),
    content       TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_contact ON conversation_memory (contact_phone, role, created_at DESC);
