import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { newDb } from 'pg-mem';
import { setPool, query } from '../src/db.js';
import { runMigrations } from '../migrations/run.js';
import { createUser } from '../src/models/user.js';

// Full path: real Fastify app + real admin route + real models against an
// in-memory Postgres. Exercises the `newPhone` wiring end to end.
const { buildApp } = await import('../src/app.js');
const { signToken } = await import('../src/auth.js');
const founder = () => ({ 'x-internal-token': signToken({ phone: '3510001', role: 'founder' }) });

let app;
beforeAll(async () => {
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  setPool(new Pool());
  await runMigrations();
  app = buildApp();
});

beforeEach(async () => {
  for (const t of ['tasks', 'projects', 'users']) await query(`DELETE FROM ${t}`);
  await createUser({ phone: '3510001', name: 'Pedro', role: 'founder' });
  await createUser({ phone: '3519009', name: 'Franek', role: 'worker' });
});

describe('PATCH /admin/users/:phone with newPhone', () => {
  it('changes a phone and cascades to the project', async () => {
    await query(
      `INSERT INTO projects (name, client_phone, budget) VALUES ('Casa', '3519009', 0)`);

    const r = await app.inject({
      method: 'PATCH', url: '/admin/users/3519009',
      headers: founder(), payload: { name: 'Franek N.', newPhone: '3519999' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().phone).toBe('3519999');
    expect(r.json().name).toBe('Franek N.');

    const { rows: [proj] } = await query('SELECT client_phone FROM projects');
    expect(proj.client_phone).toBe('3519999');
  });

  it('rejects a phone already in use (400)', async () => {
    const r = await app.inject({
      method: 'PATCH', url: '/admin/users/3519009',
      headers: founder(), payload: { newPhone: '3510001' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/in use/);
  });

  it('still renames without touching phone', async () => {
    const r = await app.inject({
      method: 'PATCH', url: '/admin/users/3519009',
      headers: founder(), payload: { name: 'Only Name' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().phone).toBe('3519009');
    expect(r.json().name).toBe('Only Name');
  });
});
