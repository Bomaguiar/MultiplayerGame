import { describe, it, expect, beforeEach, vi } from 'vitest';

const PROJECT = {
  id: 1, name: 'Vila Sol', client_phone: '3519001',
  worker_phones: ['3519009'], status: 'active',
};

vi.mock('../src/models/project.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getProject: vi.fn(async (id) => (Number(id) === 1 ? PROJECT : null)),
  };
});

const store = [];
vi.mock('../src/models/dailyLog.js', () => ({
  createLog: vi.fn(async (l) => { const row = { id: store.length + 1, ...l }; store.push(row); return row; }),
  listLogs: vi.fn(async () => [...store].reverse()),
}));

const { buildApp } = await import('../src/app.js');
const { signToken } = await import('../src/auth.js');

function hdr(role, phone) { return { 'x-internal-token': signToken({ phone, role }) }; }

let app;
beforeEach(() => { app = buildApp(); store.length = 0; });

describe('daily log routes', () => {
  it('assigned worker creates a log with photo refs (201)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/projects/1/logs', headers: hdr('worker', '3519009'),
      payload: { note: 'Poured slab', crewCount: 4, hours: 8, photoRefs: ['media/a.jpg', 'media/b.jpg'] },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.photoRefs).toEqual(['media/a.jpg', 'media/b.jpg']);
    expect(body.authorPhone).toBe('3519009');
  });

  it('lists logs newest first', async () => {
    await app.inject({ method: 'POST', url: '/projects/1/logs', headers: hdr('worker', '3519009'), payload: { note: 'first' } });
    await app.inject({ method: 'POST', url: '/projects/1/logs', headers: hdr('worker', '3519009'), payload: { note: 'second' } });
    const res = await app.inject({ method: 'GET', url: '/projects/1/logs', headers: hdr('founder', '3510000') });
    expect(res.statusCode).toBe(200);
    const logs = res.json();
    expect(logs[0].note).toBe('second');
    expect(logs[1].note).toBe('first');
  });

  it('customer reading a project they do not own is denied (404)', async () => {
    const res = await app.inject({
      method: 'GET', url: '/projects/1/logs', headers: hdr('customer', '3519999'),
    });
    expect(res.statusCode).toBe(404);
  });

  it('unassigned worker cannot post a log (404)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/projects/1/logs', headers: hdr('worker', '3510007'),
      payload: { note: 'nope' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('customer cannot post a log (403)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/projects/1/logs', headers: hdr('customer', '3519001'),
      payload: { note: 'nope' },
    });
    expect(res.statusCode).toBe(403);
  });
});
