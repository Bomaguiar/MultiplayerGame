// End-to-end demo of the construction platform API.
//
// Boots the REAL Fastify app against an in-memory Postgres (pg-mem), runs the
// real migrations, then drives a realistic construction scenario over HTTP and
// prints a readable transcript. No external services. Run:
//
//   node demo/demo.mjs
//
import { newDb } from 'pg-mem';
import { setPool } from '../src/db.js';
import { runMigrations } from '../migrations/run.js';
import { buildApp } from '../src/app.js';
import { signToken } from '../src/auth.js';

// ── Spin up in-memory Postgres and point the app at it ───────────────────────
const mem = newDb();
const { Pool } = mem.adapters.createPg();
setPool(new Pool());
await runMigrations();

const app = buildApp();

// ── Actors (identity = phone, role from a watcher-signed token) ──────────────
const FOUNDER  = { role: 'founder',  phone: '351900000001', name: 'Pedro (founder)' };
const WORKER   = { role: 'worker',   phone: '351900000009', name: 'João (worker)' };
const CUSTOMER = { role: 'customer', phone: '351900000002', name: 'Maria (customer)' };
const OUTSIDER = { role: 'customer', phone: '351900009999', name: 'Stranger' };

function tok(a) { return { 'x-internal-token': signToken({ phone: a.phone, role: a.role }) }; }

let step = 0;
async function call(actor, method, url, payload) {
  const res = await app.inject({ method, url, headers: tok(actor), payload });
  let body; try { body = res.json(); } catch { body = res.body; }
  const tag = `${method} ${url}`;
  console.log(`\n${String(++step).padStart(2, '0')}. ${actor.name}`);
  console.log(`    → ${tag}  ⇒  HTTP ${res.statusCode}`);
  console.log(`    ${JSON.stringify(body)}`);
  return { status: res.statusCode, body };
}

console.log('═══════════════════════════════════════════════════════════════');
console.log(' CONSTRUCTION WHATSAPP PLATFORM — END-TO-END DEMO');
console.log(' (real API · real migrations · in-memory Postgres)');
console.log('═══════════════════════════════════════════════════════════════');

// Health
const h = await app.inject({ method: 'GET', url: '/health' });
console.log(`\n00. Health  ⇒  HTTP ${h.statusCode}  ${h.body}`);

// 1) Founder creates a project for customer Maria, worker João assigned
const proj = await call(FOUNDER, 'POST', '/projects', {
  name: 'Vila Sol', address: 'Rua das Oliveiras 12',
  clientPhone: CUSTOMER.phone, workerPhones: [WORKER.phone], budget: 85000,
});
const pid = proj.body.id;

// 2) Founder adds a phase and a milestone
const phase = await call(FOUNDER, 'POST', `/projects/${pid}/phases`, { name: 'Foundations', position: 1 });
await call(FOUNDER, 'POST', `/phases/${phase.body.id}/milestones`, { name: 'Slab poured', dueOn: '2026-07-15', pctComplete: 0 });

// 3) Worker posts a daily log with photos (refs from the WhatsApp media path)
await call(WORKER, 'POST', `/projects/${pid}/logs`, {
  note: 'Excavation done, formwork started.', weather: 'sunny', crewCount: 4, hours: 8,
  photoRefs: ['wa-media/3EB0-1.jpg', 'wa-media/3EB0-2.jpg'],
});

// 4) Customer reads HER project + logs (transparency)
await call(CUSTOMER, 'GET', `/projects/${pid}`);
await call(CUSTOMER, 'GET', `/projects/${pid}/logs`);

// 5) A stranger tries to read it → denied (privacy)
await call(OUTSIDER, 'GET', `/projects/${pid}`);

// 6) Founder creates a task assigned to the worker
const task = await call(FOUNDER, 'POST', `/projects/${pid}/tasks`, {
  title: 'Tie rebar grid', assigneePhone: WORKER.phone, priority: 'high', dueOn: '2026-07-10',
});
const tid = task.body.id;

// 7) Worker moves it through the workflow (audited)
await call(WORKER, 'PATCH', `/tasks/${tid}/status`, { status: 'doing' });
await call(WORKER, 'PATCH', `/tasks/${tid}/status`, { status: 'done' });
await call(FOUNDER, 'GET', `/tasks/${tid}/history`);

// 8) Worker raises a material request; founder approves → ordered
const mat = await call(WORKER, 'POST', `/projects/${pid}/materials`, {
  item: 'Cement', qty: 20, unit: 'bags', urgency: 'high',
});
await call(FOUNDER, 'PATCH', `/materials/${mat.body.id}/decision`, { decision: 'approved' });

// 9) Founder pulls the procurement list (ordered items)
await call(FOUNDER, 'GET', `/projects/${pid}/materials?status=ordered`);

// 10) Worker who is NOT the assignee can't touch the task → 403
await call({ role: 'worker', phone: '351900008888', name: 'Other worker' },
  'PATCH', `/tasks/${tid}/status`, { status: 'todo' });

console.log('\n═══════════════════════════════════════════════════════════════');
console.log(' DEMO COMPLETE — every role-gate and workflow exercised live.');
console.log('═══════════════════════════════════════════════════════════════');

await app.close();
process.exit(0);
