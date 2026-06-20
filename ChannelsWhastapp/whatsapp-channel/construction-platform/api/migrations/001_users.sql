-- T02: users + roles
CREATE TABLE IF NOT EXISTS users (
    id         BIGSERIAL PRIMARY KEY,
    phone      TEXT NOT NULL UNIQUE,
    name       TEXT,
    role       TEXT NOT NULL CHECK (role IN ('customer', 'worker', 'founder', 'admin')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
