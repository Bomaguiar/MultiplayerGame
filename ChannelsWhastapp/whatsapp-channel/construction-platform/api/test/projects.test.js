import { describe, it, expect, beforeEach, vi } from 'vitest';

// Fixtures: project #1 owned by customer 351900..1, worker 351900..9 assigned.
const PROJECT = {
  id: 1, name: 'Vila Sol', address: 'Rua A', client_phone: '3519001',
  worker_phones: ['3519009'], status: 'active', budget: 0,
};

// Mock the DB-touching model functions; keep canAccessProject real.
vi.mock('../src/models/project.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createProject: vi.fn(async (b) => ({ id: 99, ...b })),
    getProject: vi.fn(async (id) => (Number(id) === 1 ? PROJECT : null)),
    listProjectsForUser: vi.fn(async () => [PROJECT]),
    updateProject: vi.fn(async (id) => (Number(id) === 1 ? PROJECT : null)),
    createPhase: vi.fn(async (b) => ({ id: 5, ...b })),
    listPhases: vi.fn(async () => []),
  };
});

const { buildApp } = await import('../src/app.js');
const { signToken } = await import('../src/auth.js');

function hdr(role, phone) {
  return { 'x-internal-token': signToken({ phone, role }) };
}

let app;
beforeEach(() => { app = buildApp(); });

describe('project routes — auth & scoping', () => {
  it('401 without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/projects/1' });
    expect(res.statusCode).toBe(401);
  });

  it('founder can create a project (201)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/projects', headers: hdr('founder', '3510000'),
      payload: { name: 'New', clientPhone: '3519001' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe('New');
  });

  it('customer cannot create a project (403)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/projects', headers: hdr('customer', '3519001'),
      payload: { name: 'New', clientPhone: '3519001' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('customer reads their own project (200)', async () => {
    const res = await app.inject({
      method: 'GET', url: '/projects/1', headers: hdr('customer', '3519001'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Vila Sol');
  });

  it('customer cannot read a project they do not own (404)', async () => {
    const res = await app.inject({
      method: 'GET', url: '/projects/1', headers: hdr('customer', '3519999'),
    });
    expect(res.statusCode).toBe(404);
  });

  it('assigned worker can read the project (200)', async () => {
    const res = await app.inject({
      method: 'GET', url: '/projects/1', headers: hdr('worker', '3519009'),
    });
    expect(res.statusCode).toBe(200);
  });

  it('unassigned worker cannot read the project (404)', async () => {
    const res = await app.inject({
      method: 'GET', url: '/projects/1', headers: hdr('worker', '3510007'),
    });
    expect(res.statusCode).toBe(404);
  });
});
