import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { newDb } from 'pg-mem';
import { setPool, query } from '../src/db.js';
import { runMigrations } from '../migrations/run.js';
import { createUser } from '../src/models/user.js';
import { createProject } from '../src/models/project.js';

// Full path: real app + real selection routes/models against in-memory Postgres.
const { buildApp } = await import('../src/app.js');
const { signToken } = await import('../src/auth.js');

const FOUNDER = { phone: '3510001', role: 'founder' };
const CUSTOMER = { phone: '3519001', role: 'customer' };
const STRANGER = { phone: '3519999', role: 'customer' };
const hdr = (a) => ({ 'x-internal-token': signToken(a) });

let app, projectId;
beforeAll(async () => {
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  setPool(new Pool());
  await runMigrations();
  app = buildApp();
});

beforeEach(async () => {
  await query('DELETE FROM selections');
  await query('DELETE FROM projects');
  await query('DELETE FROM users');
  await createUser({ phone: FOUNDER.phone, name: 'Pedro', role: 'founder' });
  await createUser({ phone: CUSTOMER.phone, name: 'Ilya', role: 'customer' });
  const p = await createProject({
    name: 'Casa', address: 'Rua A', clientPhone: CUSTOMER.phone,
    workerPhones: [], budget: 100000,
  });
  projectId = p.id;
});

async function propose(body) {
  return app.inject({
    method: 'POST', url: `/projects/${projectId}/selections`,
    headers: hdr(FOUNDER), payload: body,
  });
}

describe('client selections & approvals (T16)', () => {
  it('founder proposes a selection (201)', async () => {
    const r = await propose({ room: 'Cozinha', name: 'Bancada', options: ['Granito', 'Quartzo'], price: 3200 });
    expect(r.statusCode).toBe(201);
    expect(r.json().status).toBe('pending');
    expect(r.json().options).toEqual(['Granito', 'Quartzo']);
  });

  it('proposing without a name is 400', async () => {
    const r = await propose({ room: 'Cozinha' });
    expect(r.statusCode).toBe(400);
  });

  it('a customer cannot propose (403)', async () => {
    const r = await app.inject({
      method: 'POST', url: `/projects/${projectId}/selections`,
      headers: hdr(CUSTOMER), payload: { name: 'X' },
    });
    expect(r.statusCode).toBe(403);
  });

  it('the client approves with an e-signature, recording choice + signer', async () => {
    const sel = (await propose({ name: 'Bancada', options: ['Granito', 'Quartzo'], price: 3200 })).json();
    const r = await app.inject({
      method: 'PATCH', url: `/selections/${sel.id}/decision`,
      headers: hdr(CUSTOMER),
      payload: { decision: 'approved', chosenOption: 'Quartzo', signedName: 'Ilya Bourim' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe('approved');
    expect(r.json().chosen_option).toBe('Quartzo');
    expect(r.json().signed_name).toBe('Ilya Bourim');
    expect(r.json().decided_at).toBeTruthy();
  });

  it('approving without a signature is 400', async () => {
    const sel = (await propose({ name: 'Bancada' })).json();
    const r = await app.inject({
      method: 'PATCH', url: `/selections/${sel.id}/decision`,
      headers: hdr(CUSTOMER), payload: { decision: 'approved', chosenOption: 'Granito' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/signature/i);
  });

  it('the client can decline without a signature', async () => {
    const sel = (await propose({ name: 'Bancada' })).json();
    const r = await app.inject({
      method: 'PATCH', url: `/selections/${sel.id}/decision`,
      headers: hdr(CUSTOMER), payload: { decision: 'declined' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe('declined');
  });

  it('a decided selection cannot be decided again (400)', async () => {
    const sel = (await propose({ name: 'Bancada' })).json();
    await app.inject({
      method: 'PATCH', url: `/selections/${sel.id}/decision`,
      headers: hdr(CUSTOMER), payload: { decision: 'declined' },
    });
    const again = await app.inject({
      method: 'PATCH', url: `/selections/${sel.id}/decision`,
      headers: hdr(CUSTOMER), payload: { decision: 'approved', signedName: 'Ilya' },
    });
    expect(again.statusCode).toBe(400);
  });

  it('a stranger cannot see or decide another project selections (404)', async () => {
    const sel = (await propose({ name: 'Bancada' })).json();
    const list = await app.inject({
      method: 'GET', url: `/projects/${projectId}/selections`, headers: hdr(STRANGER),
    });
    expect(list.statusCode).toBe(404);
    const dec = await app.inject({
      method: 'PATCH', url: `/selections/${sel.id}/decision`,
      headers: hdr(STRANGER), payload: { decision: 'declined' },
    });
    expect(dec.statusCode).toBe(404);
  });

  it('lists selections for the client with pending first', async () => {
    await propose({ name: 'A' });
    const b = (await propose({ name: 'B' })).json();
    await app.inject({
      method: 'PATCH', url: `/selections/${b.id}/decision`,
      headers: hdr(CUSTOMER), payload: { decision: 'declined' },
    });
    const list = await app.inject({
      method: 'GET', url: `/projects/${projectId}/selections`, headers: hdr(CUSTOMER),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().length).toBe(2);
    expect(list.json()[0].status).toBe('pending'); // pending sorts first
  });
});
