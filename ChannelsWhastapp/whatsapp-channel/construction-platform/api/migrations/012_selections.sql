-- T16: client selections & approvals (design-led: client picks finishes/
-- materials and signs off). Approval captures a typed e-signature with the
-- decider's name + timestamp (ESIGN/UETA-style attribution) so the sign-off is
-- auditable.
CREATE TABLE IF NOT EXISTS selections (
    id            BIGSERIAL PRIMARY KEY,
    project_id    BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    room          TEXT,                            -- area, e.g. "Cozinha"
    name          TEXT NOT NULL,                   -- e.g. "Bancada"
    description   TEXT,
    options       JSONB NOT NULL DEFAULT '[]',     -- proposed choices (strings)
    price         NUMERIC(12,2) NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'declined')),
    chosen_option TEXT,                            -- the option the client picked
    proposed_by   TEXT NOT NULL,                   -- founder phone
    decided_by    TEXT,                            -- client phone
    signed_name   TEXT,                            -- typed e-signature
    decided_at    TIMESTAMPTZ,
    due_on        DATE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_selections_project ON selections (project_id, status);
