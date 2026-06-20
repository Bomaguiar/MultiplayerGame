import { describe, it, expect, beforeEach, vi } from 'vitest';

const PROJECT = { id: 1, name: 'Vila Sol', client_phone: '3519001', worker_phones: ['3519009'], status: 'active' };

vi.mock('../src/models/project.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getProject: vi.fn(async (id) => (Number(id) === 1 ? PROJECT : null)) };
});

const reqs = new Map();
let seq = 0;
vi.mock('../src/models/material.js', () => ({
  createRequest: vi.fn(async (b) => { const r = { id: ++seq, status: 'requested', urgency: 'normal', ...b }; reqs.set(r.id, r); return r; }),
  getRequest: vi.fn(async (id) => reqs.get(Number(id)) ?? null),
  decideRequest: vi.fn(async (id, decision, by) => { const r = reqs.get(Number(id)); if (!r) return null; r.status = decision === 'approved' ? 'ordered' : 'denied'; r.decided_by = by; return r; }),
  markDelivered: vi.fn(async (id) => { const r = reqs.get(Number(id)); if (r) r.status = 'delivered'; return r ?? null; }),
  listRequests: vi.fn(async ({ status } = {}) => [...reqs.values()].filter((r) => !status || r.status === status)),
}));

const { buildApp } = await import('../src/app.js');
const { signToken } = await import('../src/auth.js');
function hdr(role, phone) { return { 'x-internal-token': signToken({ phone, role }) }; }

let app;
beforeEach(() => { app = buildApp(); reqs.clear(); seq = 0; });

describe('material request routes', () => {
  it('worker raises a request; founder approval moves it to ordered', async () => {
    const create = await app.inject({ method: 'POST', url: '/projects/1/materials', headers: hdr('worker', '3519009'), payload: { item: 'Cement', qty: 20, unit: 'bags', urgency: 'high' } });
    expect(create.statusCode).toBe(201);
    expect(create.json().status).toBe('requested');
    const id = create.json().id;

    const decide = await app.inject({ method: 'PATCH', url: `/materials/${id}/decision`, headers: hdr('founder', '3510000'), payload: { decision: 'approved' } });
    expect(decide.statusCode).toBe(200);
    expect(decide.json().status).toBe('ordered');
  });

  it('filters the procurement list by status', async () => {
    await app.inject({ method: 'POST', url: '/projects/1/materials', headers: hdr('worker', '3519009'), payload: { item: 'Sand' } });
    const id2 = (await app.inject({ method: 'POST', url: '/projects/1/materials', headers: hdr('worker', '3519009'), payload: { item: 'Rebar' } })).json().id;
    await app.inject({ method: 'PATCH', url: `/materials/${id2}/decision`, headers: hdr('founder', '3510000'), payload: { decision: 'approved' } });

    const ordered = await app.inject({ method: 'GET', url: '/projects/1/materials?status=ordered', headers: hdr('founder', '3510000') });
    expect(ordered.json().map((r) => r.item)).toEqual(['Rebar']);
  });

  it('a worker cannot decide a request (403)', async () => {
    const id = (await app.inject({ method: 'POST', url: '/projects/1/materials', headers: hdr('worker', '3519009'), payload: { item: 'Nails' } })).json().id;
    const r = await app.inject({ method: 'PATCH', url: `/materials/${id}/decision`, headers: hdr('worker', '3519009'), payload: { decision: 'approved' } });
    expect(r.statusCode).toBe(403);
  });

  it('an unassigned worker cannot raise a request (404)', async () => {
    const r = await app.inject({ method: 'POST', url: '/projects/1/materials', headers: hdr('worker', '3510007'), payload: { item: 'X' } });
    expect(r.statusCode).toBe(404);
  });
});
