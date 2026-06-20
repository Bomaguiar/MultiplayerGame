-- Extend tasks + material_requests with ClickUp metadata for bidirectional sync
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS clickup_task_id TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS clickup_list_id TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS clickup_url TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignee_name TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'internal';

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_clickup ON tasks (clickup_task_id) WHERE clickup_task_id IS NOT NULL;

ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS clickup_task_id TEXT;
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12,2);
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS total_cost NUMERIC(14,2);
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS supplier TEXT;
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'internal';
