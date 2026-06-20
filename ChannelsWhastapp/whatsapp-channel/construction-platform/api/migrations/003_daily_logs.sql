-- T04: daily site logs + photo references
CREATE TABLE IF NOT EXISTS daily_logs (
    id            BIGSERIAL PRIMARY KEY,
    project_id    BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    author_phone  TEXT NOT NULL,
    note          TEXT NOT NULL DEFAULT '',
    weather       TEXT,
    crew_count    INTEGER NOT NULL DEFAULT 0 CHECK (crew_count >= 0),
    hours         NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (hours >= 0),
    photo_refs    TEXT[] NOT NULL DEFAULT '{}',  -- storage keys / media URLs
    logged_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_logs_project_time ON daily_logs (project_id, logged_at DESC);
