import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { newDb } from 'pg-mem';
import { setPool, query } from '../src/db.js';
import { runMigrations } from '../migrations/run.js';
import { createUser, findByPhone, changeUserPhone } from '../src/models/user.js';

// Real in-memory Postgres so the cascading UPDATEs run their actual SQL across
// every table that denormalizes a user's phone.
beforeAll(async () => {
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  setPool(new Pool());
  await runMigrations();
});

const OLD = '351900000001';
const NEW = '351911111111';

beforeEach(async () => {
  for (const t of ['task_status_history', 'tasks', 'daily_logs', 'material_requests',
    'notifications', 'milestones', 'phases', 'projects', 'users']) {
    await query(`DELETE FROM ${t}`);
  }
  await createUser({ phone: OLD, name: 'Pedro', role: 'founder' });
  await createUser({ phone: '351900000009', name: 'Franek', role: 'worker' });
});

describe('changeUserPhone — cascading rename', () => {
  it('moves the user and rewrites every reference', async () => {
    // A project where OLD is the client AND a worker, plus a task, a log,
    // a material and a notification all keyed by OLD.
    const { rows: [p] } = await query(
      `INSERT INTO projects (name, client_phone, worker_phones, budget)
       VALUES ('Vila Sol', $1, ARRAY[$1, '351900000009'], 85000) RETURNING id`, [OLD]);
    await query(
      `INSERT INTO tasks (project_id, title, assignee_phone) VALUES ($1, 'Rebar', $2)`,
      [p.id, OLD]);
    await query(
      `INSERT INTO daily_logs (project_id, author_phone, note) VALUES ($1, $2, 'dig')`,
      [p.id, OLD]);
    await query(
      `INSERT INTO material_requests (project_id, requested_by, item, qty) VALUES ($1, $2, 'Cement', 10)`,
      [p.id, OLD]);
    await query(
      `INSERT INTO notifications (recipient_phone, type, title) VALUES ($1, 'system', 'hi')`,
      [OLD]);

    const moved = await changeUserPhone(OLD, NEW);
    expect(moved.phone).toBe(NEW);
    expect(moved.name).toBe('Pedro');

    expect(await findByPhone(OLD)).toBeNull();
    expect((await findByPhone(NEW)).role).toBe('founder');

    const { rows: [proj] } = await query('SELECT * FROM projects WHERE id = $1', [p.id]);
    expect(proj.client_phone).toBe(NEW);
    expect(proj.worker_phones).toEqual([NEW, '351900000009']);

    const { rows: [task] } = await query('SELECT assignee_phone FROM tasks');
    expect(task.assignee_phone).toBe(NEW);
    const { rows: [log] } = await query('SELECT author_phone FROM daily_logs');
    expect(log.author_phone).toBe(NEW);
    const { rows: [mat] } = await query('SELECT requested_by FROM material_requests');
    expect(mat.requested_by).toBe(NEW);
    const { rows: [notif] } = await query('SELECT recipient_phone FROM notifications');
    expect(notif.recipient_phone).toBe(NEW);
  });

  it('returns null for an unknown phone', async () => {
    expect(await changeUserPhone('000', NEW)).toBeNull();
  });

  it('rejects a blank new phone', async () => {
    await expect(changeUserPhone(OLD, '   ')).rejects.toThrow(/required/);
  });

  it('rejects a phone already in use', async () => {
    await expect(changeUserPhone(OLD, '351900000009')).rejects.toThrow(/in use/);
  });

  it('is a no-op when the phone is unchanged', async () => {
    const same = await changeUserPhone(OLD, OLD);
    expect(same.phone).toBe(OLD);
  });
});
