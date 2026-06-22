import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { newDb } from 'pg-mem';
import { setPool, query } from '../src/db.js';
import { runMigrations } from '../migrations/run.js';
import { createProject } from '../src/models/project.js';
import { createUser } from '../src/models/user.js';
import { createTask } from '../src/models/task.js';
import { createRequest } from '../src/models/material.js';
import { createChangeOrder } from '../src/models/changeOrder.js';
import { listOutbox, markSent, listNotifications } from '../src/models/notification.js';
import { scanProject, enqueueAlerts } from '../src/brain/proactive.js';

beforeAll(async () => {
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  setPool(new Pool());
  await runMigrations();
});

const FOUNDER = '351900000001';
const WORKER = '351900000009';
const CUSTOMER = '351900000002';

let project;
beforeEach(async () => {
  for (const t of ['notifications', 'tasks', 'material_requests', 'change_orders', 'selections', 'projects', 'users']) {
    await query(`DELETE FROM ${t}`);
  }
  await createUser({ phone: FOUNDER, name: 'Pedro', role: 'founder' });
  await createUser({ phone: WORKER, name: 'Franek', role: 'worker' });
  await createUser({ phone: CUSTOMER, name: 'Ilya', role: 'customer' });
  project = await createProject({ name: 'Santa Rita', clientPhone: CUSTOMER, workerPhones: [WORKER], budget: 85000 });
});

describe('scanProject', () => {
  it('flags overdue tasks to managers and assignees', async () => {
    await createTask({ projectId: project.id, title: 'Pintar', assigneePhone: WORKER, dueOn: '2020-01-01' });
    const alerts = await scanProject(project);
    expect(alerts.some((a) => a.recipientPhone === FOUNDER && /atrasad/i.test(a.title))).toBe(true);
    expect(alerts.some((a) => a.recipientPhone === WORKER && /atrasad/i.test(a.title))).toBe(true);
  });

  it('flags pending material requests to managers with approve hints', async () => {
    await createRequest({ projectId: project.id, requestedBy: WORKER, item: 'Cimento', qty: 5 });
    const alerts = await scanProject(project);
    const mgr = alerts.find((a) => a.recipientPhone === FOUNDER && a.type === 'material_decision');
    expect(mgr).toBeTruthy();
    expect(mgr.body).toMatch(/aprovar \d+/);
  });

  it('flags proposed change orders to the client', async () => {
    await createChangeOrder({ projectId: project.id, title: 'Extra', costDelta: 1000, proposedBy: FOUNDER });
    const alerts = await scanProject(project);
    expect(alerts.some((a) => a.recipientPhone === CUSTOMER && a.type === 'change_order')).toBe(true);
  });

  it('returns nothing when the project is calm', async () => {
    const alerts = await scanProject(project);
    expect(alerts).toHaveLength(0);
  });
});

describe('enqueueAlerts + outbox', () => {
  it('creates pending whatsapp notifications and dedupes on re-run', async () => {
    await createRequest({ projectId: project.id, requestedBy: WORKER, item: 'Cimento', qty: 5 });
    const first = await enqueueAlerts(project);
    expect(first.length).toBeGreaterThan(0);
    expect(first[0].channel).toBe('whatsapp');
    expect(first[0].status).toBe('pending');

    // Re-running the same scan must NOT duplicate the still-pending alert.
    const second = await enqueueAlerts(project);
    expect(second).toHaveLength(0);
  });

  it('appears in the outbox and can be marked sent', async () => {
    await createRequest({ projectId: project.id, requestedBy: WORKER, item: 'Cimento', qty: 5 });
    await enqueueAlerts(project);
    const out = await listOutbox();
    expect(out.length).toBeGreaterThan(0);
    const msg = out[0];
    await markSent(msg.id);
    const after = await listOutbox();
    expect(after.find((m) => m.id === msg.id)).toBeUndefined();
  });

  it('does not re-queue the same day even after the alert was sent', async () => {
    await createRequest({ projectId: project.id, requestedBy: WORKER, item: 'Cimento', qty: 5 });
    const first = await enqueueAlerts(project);
    for (const n of first) await markSent(n.id);
    // Keys are date-stamped, so a same-day re-run is deduped against the sent
    // notification — one nudge per condition per day, no re-send storm.
    const again = await enqueueAlerts(project);
    expect(again).toHaveLength(0);
  });
});
