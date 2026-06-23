import { describe, it, expect, beforeEach, vi } from 'vitest';

const PROJECT = { id: 1, name: 'Vila Sol', client_phone: '3519001', worker_phones: ['3519009'], status: 'active' };

vi.mock('../src/models/project.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getProject: vi.fn(async (id) => (Number(id) === 1 ? PROJECT : null)) };
});

// In-memory task store with audit trail.
const tasks = new Map();
const history = [];
let seq = 0;
vi.mock('../src/models/task.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createTask: vi.fn(async (b) => { const t = { id: ++seq, status: 'todo', priority: 'normal', assignee_phone: b.assigneePhone ?? null, ...b }; tasks.set(t.id, t); return t; }),
    getTask: vi.fn(async (id) => tasks.get(Number(id)) ?? null),
    listTasks: vi.fn(async () => [...tasks.values()]),
    assignTask: vi.fn(async (id, p) => { const t = tasks.get(Number(id)); if (t) t.assignee_phone = p; return t ?? null; }),
    setStatus: vi.fn(async (id, s, by) => { if (!actual.TASK_STATUSES.includes(s)) throw new Error(`invalid status: ${s}`); const t = tasks.get(Number(id)); if (!t) return null; history.push({ task_id: t.id, from_status: t.status, to_status: s, by_phone: by }); t.status = s; return t; }),
    listHistory: vi.fn(async (id) => history.filter((h) => h.task_id === Number(id))),
  };
});

const { buildApp } = await import('../src/app.js');
const { signToken } = await import('../src/auth.js');
function hdr(role, phone) { return { 'x-internal-token': signToken({ phone, role }) }; }

let app;
beforeEach(() => { app = buildApp(); tasks.clear(); history.length = 0; seq = 0; });

describe('task routes', () => {
  it('founder creates + assigns, then transitions through statuses with audit', async () => {
    const create = await app.inject({ method: 'POST', url: '/projects/1/tasks', headers: hdr('founder', '3510000'), payload: { title: 'Frame wall', assigneePhone: '3519009' } });
    expect(create.statusCode).toBe(201);
    const id = create.json().id;

    for (const s of ['doing', 'done']) {
      const r = await app.inject({ method: 'PATCH', url: `/tasks/${id}/status`, headers: hdr('worker', '3519009'), payload: { status: s } });
      expect(r.statusCode).toBe(200);
      expect(r.json().status).toBe(s);
    }
    const hist = await app.inject({ method: 'GET', url: `/tasks/${id}/history`, headers: hdr('founder', '3510000') });
    expect(hist.json().map((h) => h.to_status)).toEqual(['doing', 'done']);
  });

  it('a worker who is not the assignee cannot change the task (403)', async () => {
    const create = await app.inject({ method: 'POST', url: '/projects/1/tasks', headers: hdr('founder', '3510000'), payload: { title: 'X', assigneePhone: '3519009' } });
    const id = create.json().id;
    const r = await app.inject({ method: 'PATCH', url: `/tasks/${id}/status`, headers: hdr('worker', '3510007'), payload: { status: 'done' } });
    expect(r.statusCode).toBe(403);
  });

  it('rejects an invalid status (400)', async () => {
    const create = await app.inject({ method: 'POST', url: '/projects/1/tasks', headers: hdr('founder', '3510000'), payload: { title: 'X', assigneePhone: '3519009' } });
    const id = create.json().id;
    const r = await app.inject({ method: 'PATCH', url: `/tasks/${id}/status`, headers: hdr('founder', '3510000'), payload: { status: 'banana' } });
    expect(r.statusCode).toBe(400);
  });

  it('a worker cannot create a task (403)', async () => {
    const r = await app.inject({ method: 'POST', url: '/projects/1/tasks', headers: hdr('worker', '3519009'), payload: { title: 'X' } });
    expect(r.statusCode).toBe(403);
  });
});
