// Standalone demo server — NO Docker, NO Postgres needed.
// Boots the full API + dashboard against an in-memory Postgres (pg-mem).
//
//   npm run demo:server
//   → http://localhost:4000/app/
//
// Perfect for machines that can't run Docker (e.g. older Macs).
// Data lives in memory and resets on restart.

// This entry is always demo mode. Set it here (not via a shell-specific
// `DEMO_MODE=1 node ...` prefix) so the command works the same on Windows
// cmd.exe / PowerShell as it does on macOS / Linux.
process.env.DEMO_MODE = '1';

import { newDb } from 'pg-mem';
import { setPool } from '../src/db.js';
import { runMigrations } from '../migrations/run.js';
import { buildApp } from '../src/app.js';

// ── Boot in-memory Postgres ─────────────────────────────────────────────────
const mem = newDb();
const { Pool } = mem.adapters.createPg();
setPool(new Pool());
await runMigrations();

console.log('✓ In-memory database ready (all migrations applied)');

// ── Start server with demo mode ─────────────────────────────────────────────
const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || '0.0.0.0';

const app = buildApp({ logger: true, demoMode: true });

try {
  await app.listen({ port: PORT, host: HOST });
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' 🏗️  Construction Platform — Demo Server');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Dashboard:  http://localhost:${PORT}/app/`);
  console.log(`  API:        http://localhost:${PORT}/health`);
  console.log('');
  console.log('  No Docker, no Postgres — everything runs in memory.');
  console.log('  Data resets when you restart. Press Ctrl+C to stop.');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
} catch (err) {
  console.error('Failed to start:', err);
  process.exit(1);
}

process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await app.close();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await app.close();
  process.exit(0);
});
