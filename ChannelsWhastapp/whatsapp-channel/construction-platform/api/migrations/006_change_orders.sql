-- T07: change orders — scope/cost changes requiring customer approval
CREATE TABLE IF NOT EXISTS change_orders (
    id            BIGSERIAL PRIMARY KEY,
    project_id    BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    description   TEXT,
    cost_delta    NUMERIC(14,2) NOT NULL DEFAULT 0,
    days_delta    INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'proposed'
                  CHECK (status IN ('proposed', 'approved', 'rejected', 'cancelled')),
    proposed_by   TEXT NOT NULL,
    decided_by    TEXT,
    decided_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_co_project ON change_orders (project_id);
CREATE INDEX IF NOT EXISTS idx_co_status  ON change_orders (status);
