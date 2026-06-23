CREATE TABLE IF NOT EXISTS budget_items (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id),
  category    TEXT NOT NULL,
  description TEXT NOT NULL,
  estimated   NUMERIC(12,2) NOT NULL DEFAULT 0,
  actual      NUMERIC(12,2),
  status      TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','in_progress','completed','over_budget')),
  vendor      TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_budget_items_project ON budget_items(project_id);
