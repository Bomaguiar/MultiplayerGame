// Minimal migration runner: applies every .sql file in this directory in
// lexical order, tracking applied files in a _migrations table. Idempotent.
//
//   node migrations/run.js

import { readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { query, closePool } from '../src/db.js';

const here = dirname(fileURLToPath(import.meta.url));

export async function runMigrations() {
  await query(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);

  const files = readdirSync(here).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const { rows } = await query('SELECT 1 FROM _migrations WHERE name = $1', [f]);
    if (rows.length) continue;
    const sql = readFileSync(join(here, f), 'utf8');
    await query(sql);
    await query('INSERT INTO _migrations (name) VALUES ($1)', [f]);
    console.log(`applied ${f}`);
  }
}

// Run directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => closePool())
    .then(() => console.log('migrations complete'))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
