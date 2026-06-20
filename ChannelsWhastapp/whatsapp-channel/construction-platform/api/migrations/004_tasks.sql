-- T05: tasks + assignment + status audit trail
CREATE TABLE IF NOT EXISTS tasks (
    id            BIGSERIAL PRIMARY KEY,
    project_id    BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    phase_id      BIGINT REFERENCES phases(id) ON DELETE SET NULL,
    title         TEXT NOT NULL,
    assignee_phone TEXT,
    status        TEXT NOT NULL DEFAULT 'todo'
                  CHECK (status IN ('todo', 'doing', 'blocked', 'done')),
    priority      TEXT NOT NULL DEFAULT 'normal'
                  CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    due_on        DATE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks (project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks (assignee_phone);

CREATE TABLE IF NOT EXISTS task_status_history (
    id          BIGSERIAL PRIMARY KEY,
    task_id     BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    from_status TEXT,
    to_status   TEXT NOT NULL,
    by_phone    TEXT NOT NULL,
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_history_task ON task_status_history (task_id, changed_at);
