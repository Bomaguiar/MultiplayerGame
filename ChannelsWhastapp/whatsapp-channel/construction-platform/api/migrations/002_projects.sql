-- T03: projects, phases, milestones
CREATE TABLE IF NOT EXISTS projects (
    id            BIGSERIAL PRIMARY KEY,
    name          TEXT NOT NULL,
    address       TEXT,
    client_phone  TEXT NOT NULL,                 -- the customer (User.phone)
    worker_phones TEXT[] NOT NULL DEFAULT '{}',  -- assigned workers
    status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'on_hold', 'done', 'cancelled')),
    budget        NUMERIC(14,2) NOT NULL DEFAULT 0,
    starts_on     DATE,
    ends_on       DATE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_projects_client ON projects (client_phone);

CREATE TABLE IF NOT EXISTS phases (
    id         BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_phases_project ON phases (project_id);

CREATE TABLE IF NOT EXISTS milestones (
    id          BIGSERIAL PRIMARY KEY,
    phase_id    BIGINT NOT NULL REFERENCES phases(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    due_on      DATE,
    pct_complete INTEGER NOT NULL DEFAULT 0 CHECK (pct_complete BETWEEN 0 AND 100),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_milestones_phase ON milestones (phase_id);
