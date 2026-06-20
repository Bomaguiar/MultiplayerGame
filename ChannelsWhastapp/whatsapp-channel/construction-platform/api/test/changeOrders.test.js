import { describe, it, expect, beforeEach, vi } from 'vitest';

const PROJECT = { id: 1, name: 'Vila Sol', client_phone: '3519001', worker_phones: ['3519009'], status: 'active', budget: 85000 };

vi.mock('../src/models/project.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getProject: vi.fn(async (id) => (Number(id) === 1 ? { ...PROJECT } : null)),
  };
});

const orders = new Map();
let seq = 0;
vi.mock('../src/models/changeOrder.js', () => ({
  CO_STATUSES: ['proposed', 'approved', 'rejected', 'cancelled'],
  createChangeOrder: vi.fn(async (b) => {
    const co = { id: ++seq, status: 'proposed', project_id: b.projectId, cost_delta: b.costDelta ?? 0, days_delta: b.daysDelta ?? 0, ...b };
    orders.set(co.id, co);
    return co;
  }),
  getChangeOrder: vi.fn(async (id) => orders.get(Number(id)) ?? null),
  listChangeOrders: vi.fn(async ({ status } = {}) =>
    [...orders.values()].filter((o) => !status || o.status === status)
  ),
  decideChangeOrder: vi.fn(async (id, decision, by) => {
    const co = orders.get(Number(id));
    if (!co) return null;
    if (!['approved', 'rejected'].includes(decision)) throw new Error(`invalid decision: ${decision}`);
    if (co.status !== 'proposed') throw new Error('only proposed orders can be decided');
    co.status = decision;
    co.decided_by = by;
    return co;
  }),
  cancelChangeOrder: vi.fn(async (id) => {
    const co = orders.get(Number(id));
    if (!co || co.status !== 'proposed') return null;
    co.status = 'cancelled';
    return co;
  }),
  budgetSummary: vi.fn(async () => ({
    current_budget: 85000, approved_changes: 0, pending_changes: 4500,
    pending_count: 1, approved_count: 0, material_items: 0,
  })),
}));

vi.mock('../src/models/clickupSync.js', () => ({
  saveMapping: vi.fn(async (b) => ({ id: 1, ...b, synced_at: new Date().toISOString() })),
  getMapping: vi.fn(async () => null),
  listMappings: vi.fn(async () => []),
  deleteMapping: vi.fn(async () => null),
}));

const { buildApp } = await import('../src/app.js');
const { signToken } = await import('../src/auth.js');
function hdr(role, phone) { return { 'x-internal-token': signToken({ phone, role }) }; }

let app;
beforeEach(() => { app = buildApp(); orders.clear(); seq = 0; });

describe('change order routes', () => {
  it('founder proposes a change order', async () => {
    const r = await app.inject({
      method: 'POST', url: '/projects/1/change-orders',
      headers: hdr('founder', '3510000'),
      payload: { title: 'Upgrade floor', costDelta: 4500, daysDelta: 3 },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().status).toBe('proposed');
  });

  it('customer approves a change order', async () => {
    const create = await app.inject({
      method: 'POST', url: '/projects/1/change-orders',
      headers: hdr('founder', '3510000'),
      payload: { title: 'New windows', costDelta: 2000 },
    });
    const id = create.json().id;

    const decide = await app.inject({
      method: 'PATCH', url: `/change-orders/${id}/decision`,
      headers: hdr('customer', '3519001'),
      payload: { decision: 'approved' },
    });
    expect(decide.statusCode).toBe(200);
    expect(decide.json().status).toBe('approved');
  });

  it('customer rejects a change order', async () => {
    const create = await app.inject({
      method: 'POST', url: '/projects/1/change-orders',
      headers: hdr('founder', '3510000'),
      payload: { title: 'Gold faucets', costDelta: 8000 },
    });
    const id = create.json().id;

    const decide = await app.inject({
      method: 'PATCH', url: `/change-orders/${id}/decision`,
      headers: hdr('customer', '3519001'),
      payload: { decision: 'rejected' },
    });
    expect(decide.statusCode).toBe(200);
    expect(decide.json().status).toBe('rejected');
  });

  it('worker cannot propose a change order (403)', async () => {
    const r = await app.inject({
      method: 'POST', url: '/projects/1/change-orders',
      headers: hdr('worker', '3519009'),
      payload: { title: 'X' },
    });
    expect(r.statusCode).toBe(403);
  });

  it('founder cannot decide a change order (403)', async () => {
    const create = await app.inject({
      method: 'POST', url: '/projects/1/change-orders',
      headers: hdr('founder', '3510000'),
      payload: { title: 'Test', costDelta: 100 },
    });
    const id = create.json().id;

    const decide = await app.inject({
      method: 'PATCH', url: `/change-orders/${id}/decision`,
      headers: hdr('founder', '3510000'),
      payload: { decision: 'approved' },
    });
    expect(decide.statusCode).toBe(403);
  });

  it('founder can cancel a proposed change order', async () => {
    const create = await app.inject({
      method: 'POST', url: '/projects/1/change-orders',
      headers: hdr('founder', '3510000'),
      payload: { title: 'Maybe later', costDelta: 500 },
    });
    const id = create.json().id;

    const cancel = await app.inject({
      method: 'PATCH', url: `/change-orders/${id}/cancel`,
      headers: hdr('founder', '3510000'),
    });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().status).toBe('cancelled');
  });

  it('budget summary is accessible to customer and founder', async () => {
    const r = await app.inject({
      method: 'GET', url: '/projects/1/budget',
      headers: hdr('customer', '3519001'),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().current_budget).toBe(85000);

    const r2 = await app.inject({
      method: 'GET', url: '/projects/1/budget',
      headers: hdr('worker', '3519009'),
    });
    expect(r2.statusCode).toBe(403);
  });
});

describe('clickup sync routes', () => {
  it('founder can save and query a ClickUp mapping', async () => {
    const save = await app.inject({
      method: 'POST', url: '/clickup/sync',
      headers: hdr('founder', '3510000'),
      payload: { entityType: 'task', entityId: 42, clickupTaskId: 'abc123', clickupListId: 'list1' },
    });
    expect(save.statusCode).toBe(201);

    const get = await app.inject({
      method: 'GET', url: '/clickup/sync/task/42',
      headers: hdr('founder', '3510000'),
    });
    expect(get.statusCode).toBe(200);
  });

  it('worker cannot access clickup sync (403)', async () => {
    const r = await app.inject({
      method: 'POST', url: '/clickup/sync',
      headers: hdr('worker', '3519009'),
      payload: { entityType: 'task', entityId: 1, clickupTaskId: 'x' },
    });
    expect(r.statusCode).toBe(403);
  });
});
