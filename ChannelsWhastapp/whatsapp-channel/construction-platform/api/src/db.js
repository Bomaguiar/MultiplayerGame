// Postgres connection layer.
//
// The pool is created lazily so the process can boot (and tests can run) even
// when no database is reachable yet — health degrades gracefully instead of
// crashing. T02+ will build real models on top of `query()`.

import pg from 'pg';

const { Pool } = pg;

let pool = null;

/** Build the pool config from the environment. */
function poolConfig() {
  // Prefer a single connection string; fall back to discrete vars.
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }
  return {
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    database: process.env.PGDATABASE || 'construction',
  };
}

/** Lazily create and return the shared pool. */
export function getPool() {
  if (!pool) {
    pool = new Pool({ ...poolConfig(), connectionTimeoutMillis: 2000 });
    // Don't let an idle-client error crash the process.
    pool.on('error', () => {});
  }
  return pool;
}

/** Run a parameterized query. Throws on failure (callers decide how to handle). */
export async function query(text, params) {
  return getPool().query(text, params);
}

/**
 * Cheap connectivity probe for the health check.
 * Returns true if the DB answered, false otherwise — never throws.
 */
export async function checkDb() {
  try {
    await getPool().query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/** Close the pool (used in tests and graceful shutdown). */
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
