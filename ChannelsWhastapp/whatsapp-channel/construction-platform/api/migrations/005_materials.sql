-- T06: material requests + procurement
CREATE TABLE IF NOT EXISTS material_requests (
    id             BIGSERIAL PRIMARY KEY,
    project_id     BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    requested_by   TEXT NOT NULL,                -- worker phone
    item           TEXT NOT NULL,
    qty            NUMERIC(12,2) NOT NULL DEFAULT 1 CHECK (qty > 0),
    unit           TEXT,
    urgency        TEXT NOT NULL DEFAULT 'normal'
                   CHECK (urgency IN ('low', 'normal', 'high', 'urgent')),
    status         TEXT NOT NULL DEFAULT 'requested'
                   CHECK (status IN ('requested', 'approved', 'denied', 'ordered', 'delivered')),
    decided_by     TEXT,                          -- founder phone
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_materials_project ON material_requests (project_id);
CREATE INDEX IF NOT EXISTS idx_materials_status ON material_requests (status);
