import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Fixtures ────────────────────────────────────────────────────────────────

const PROJECT = {
  id: 1, name: 'Vila Sol', status: 'active',
  client_phone: '3519001', worker_phones: ['3519009'],
  budget: 50000,
};

const USERS = {
  '3519001': { id: 1, phone: '3519001', name: 'Client', role: 'customer' },
  '3519009': { id: 2, phone: '3519009', name: 'Worker', role: 'worker' },
  '3510000': { id: 3, phone: '3510000', name: 'Boss',   role: 'founder' },
};

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../src/db.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, checkDb: vi.fn(async () => true), query: vi.fn() };
});

vi.mock('../src/models/user.js', () => ({
  findByPhone: vi.fn(async (phone) => USERS[phone] ?? null),
}));

vi.mock('../src/models/project.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getProject: vi.fn(async (id) => (Number(id) === 1 ? PROJECT : null)),
    listProjectsForUser: vi.fn(async (user) => {
      if (actual.canAccessProject(user, PROJECT)) return [PROJECT];
      return [];
    }),
  };
});

// In-memory task store.
const tasks = new Map();
let taskSeq = 0;
vi.mock('../src/models/task.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createTask: vi.fn(async (b) => {
      const t = { id: ++taskSeq, status: 'todo', priority: 'normal', project_id: b.projectId, assignee_phone: b.assigneePhone ?? null, title: b.title, ...b };
      tasks.set(t.id, t);
      return t;
    }),
    getTask: vi.fn(async (id) => tasks.get(Number(id)) ?? null),
    listTasks: vi.fn(async () => [...tasks.values()]),
    setStatus: vi.fn(async (id, s, by) => {
      if (!actual.TASK_STATUSES.includes(s)) throw new Error(`invalid status: ${s}`);
      const t = tasks.get(Number(id));
      if (!t) return null;
      t.status = s;
      return t;
    }),
  };
});

// In-memory daily log store.
const logs = [];
vi.mock('../src/models/dailyLog.js', () => ({
  createLog: vi.fn(async (b) => { const l = { id: logs.length + 1, ...b }; logs.push(l); return l; }),
  listLogs: vi.fn(async () => logs),
}));

// In-memory material request store.
const materials = new Map();
let matSeq = 0;
vi.mock('../src/models/material.js', () => ({
  createRequest: vi.fn(async (b) => { const m = { id: ++matSeq, status: 'pending', ...b }; materials.set(m.id, m); return m; }),
  getRequest: vi.fn(async (id) => materials.get(Number(id)) ?? null),
  listRequests: vi.fn(async () => [...materials.values()]),
  decideRequest: vi.fn(async (id, decision, byPhone) => {
    const m = materials.get(Number(id));
    if (!m) throw new Error('not found');
    m.status = decision === 'approved' ? 'ordered' : 'denied';
    m.decided_by = byPhone;
    return m;
  }),
}));

vi.mock('../src/models/changeOrder.js', () => ({
  budgetSummary: vi.fn(async () => ({
    current_budget: 50000, approved_changes: 5000, pending_changes: 2000,
    pending_count: 1, approved_count: 2,
  })),
  decideChangeOrder: vi.fn(async () => { throw new Error('not found'); }),
  listChangeOrders: vi.fn(async () => []),
}));

// ── App + helpers ───────────────────────────────────────────────────────────

const { buildApp } = await import('../src/app.js');

const WATCHER_HDR = { 'x-watcher-token': 'dev-watcher-secret' };

function send(app, from, body, headers = {}) {
  return app.inject({
    method: 'POST',
    url: '/whatsapp/incoming',
    headers: { ...WATCHER_HDR, ...headers },
    payload: { from, body, messageId: 'msg-1', timestamp: Date.now() },
  });
}

let app;
beforeEach(() => {
  app = buildApp();
  tasks.clear();
  taskSeq = 0;
  logs.length = 0;
  materials.clear();
  matSeq = 0;
});

// ── parseCommand unit tests ─────────────────────────────────────────────────

describe('parseCommand', () => {
  let parseCommand;

  beforeEach(async () => {
    // Import directly since the mock graph is already set up.
    const mod = await import('../src/whatsapp/router.js');
    parseCommand = mod.parseCommand;
  });

  it('parses /status', () => {
    expect(parseCommand('/status')).toEqual({ cmd: 'status', args: '' });
  });

  it('parses Portuguese estado', () => {
    expect(parseCommand('estado')).toEqual({ cmd: 'status', args: '' });
  });

  it('parses /tasks and tarefas', () => {
    expect(parseCommand('/tasks')).toEqual({ cmd: 'tasks', args: '' });
    expect(parseCommand('tarefas')).toEqual({ cmd: 'tasks', args: '' });
  });

  it('parses /task done <id> and tarefa feita <id>', () => {
    expect(parseCommand('/task done 42')).toEqual({ cmd: 'task_done', args: '42' });
    expect(parseCommand('tarefa feita 7')).toEqual({ cmd: 'task_done', args: '7' });
  });

  it('parses /log <text> and registo <text>', () => {
    expect(parseCommand('/log Concrete poured today')).toEqual({ cmd: 'log', args: 'Concrete poured today' });
    expect(parseCommand('registo Betão lançado')).toEqual({ cmd: 'log', args: 'Betão lançado' });
  });

  it('parses /materials and materiais', () => {
    expect(parseCommand('/materials')).toEqual({ cmd: 'materials', args: '' });
    expect(parseCommand('materiais')).toEqual({ cmd: 'materials', args: '' });
  });

  it('parses /request <item> <qty> and pedir <item> <qty>', () => {
    expect(parseCommand('/request cement bags 10')).toEqual({ cmd: 'request', args: 'cement bags 10' });
    expect(parseCommand('pedir cimento 5')).toEqual({ cmd: 'request', args: 'cimento 5' });
  });

  it('parses /approve <id> and aprovar <id>', () => {
    expect(parseCommand('/approve 3')).toEqual({ cmd: 'approve', args: '3' });
    expect(parseCommand('aprovar 3')).toEqual({ cmd: 'approve', args: '3' });
  });

  it('parses /budget and orcamento', () => {
    expect(parseCommand('/budget')).toEqual({ cmd: 'budget', args: '' });
    expect(parseCommand('orcamento')).toEqual({ cmd: 'budget', args: '' });
  });

  it('parses /help and ajuda', () => {
    expect(parseCommand('/help')).toEqual({ cmd: 'help', args: '' });
    expect(parseCommand('ajuda')).toEqual({ cmd: 'help', args: '' });
  });

  it('returns unknown for unrecognised text', () => {
    expect(parseCommand('hello there')).toEqual({ cmd: 'unknown', args: '' });
  });

  it('is case-insensitive', () => {
    expect(parseCommand('/STATUS')).toEqual({ cmd: 'status', args: '' });
    expect(parseCommand('ESTADO')).toEqual({ cmd: 'status', args: '' });
  });

  it('handles null / empty', () => {
    expect(parseCommand(null)).toEqual({ cmd: 'unknown', args: '' });
    expect(parseCommand('')).toEqual({ cmd: 'unknown', args: '' });
  });
});

// ── Webhook integration tests ───────────────────────────────────────────────

describe('POST /whatsapp/incoming', () => {
  it('rejects requests without watcher token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/whatsapp/incoming',
      headers: {},
      payload: { from: '3519001', body: '/status' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects requests with wrong watcher token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/whatsapp/incoming',
      headers: { 'x-watcher-token': 'wrong-secret' },
      payload: { from: '3519001', body: '/status' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns polite rejection for unknown phone number', async () => {
    const res = await send(app, '9999999', '/status');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.reply).toMatch(/not registered/i);
  });

  it('returns project status for /status', async () => {
    const res = await send(app, '3510000', '/status');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.reply).toContain('Vila Sol');
  });

  it('returns project status for Portuguese estado', async () => {
    const res = await send(app, '3510000', 'estado');
    expect(res.statusCode).toBe(200);
    expect(res.json().reply).toContain('Vila Sol');
  });

  it('returns 400 for missing body fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/whatsapp/incoming',
      headers: WATCHER_HDR,
      payload: { from: '3510000' }, // missing body
    });
    expect(res.statusCode).toBe(400);
  });
});

// ── Command execution tests ─────────────────────────────────────────────────

describe('command execution via webhook', () => {
  it('/tasks lists tasks for the user', async () => {
    // Seed a task.
    const { createTask } = await import('../src/models/task.js');
    await createTask({ projectId: 1, title: 'Pour slab', assigneePhone: '3519009' });

    const res = await send(app, '3519009', '/tasks');
    expect(res.statusCode).toBe(200);
    expect(res.json().reply).toContain('Pour slab');
  });

  it('/task done <id> marks a task done (worker)', async () => {
    const { createTask } = await import('../src/models/task.js');
    const t = await createTask({ projectId: 1, title: 'Frame wall', assigneePhone: '3519009' });

    const res = await send(app, '3519009', `/task done ${t.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().reply).toContain('done');
  });

  it('/log records a daily log (worker)', async () => {
    const res = await send(app, '3519009', '/log Concrete poured section A');
    expect(res.statusCode).toBe(200);
    expect(res.json().reply).toContain('Log recorded');
  });

  it('/request creates a material request', async () => {
    const res = await send(app, '3519009', '/request cement bags 10');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.reply).toContain('cement bags');
    expect(body.reply).toContain('10');
  });

  it('/approve works for founder', async () => {
    const { createRequest } = await import('../src/models/material.js');
    const m = await createRequest({ projectId: 1, requestedBy: '3519009', item: 'nails', qty: 100 });

    const res = await send(app, '3510000', `/approve ${m.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().reply).toContain('approved');
  });

  it('/budget shows budget for founder', async () => {
    const res = await send(app, '3510000', '/budget');
    expect(res.statusCode).toBe(200);
    expect(res.json().reply).toContain('50000');
  });

  it('/help returns command list', async () => {
    const res = await send(app, '3510000', '/help');
    expect(res.statusCode).toBe(200);
    const reply = res.json().reply;
    expect(reply).toContain('/status');
    expect(reply).toContain('/approve');
  });

  it('non-command messages fall through to the AI agent, which offers help', async () => {
    const res = await send(app, '3510000', 'xpto');
    expect(res.statusCode).toBe(200);
    // The agent now handles natural language; an unintelligible message yields
    // a conversational capability menu rather than a terse "/help" hint.
    expect(res.json().reply).toMatch(/posso ajudar|ajuda/i);
  });
});

// ── Role gating tests ───────────────────────────────────────────────────────

describe('role gating', () => {
  it('worker cannot approve (founder-only command)', async () => {
    const res = await send(app, '3519009', '/approve 1');
    expect(res.statusCode).toBe(200);
    expect(res.json().reply).toMatch(/only founders/i);
  });

  it('customer cannot post a log (worker/founder-only command)', async () => {
    const res = await send(app, '3519001', '/log some note');
    expect(res.statusCode).toBe(200);
    expect(res.json().reply).toMatch(/only workers/i);
  });

  it('worker cannot see budget (customer/founder-only)', async () => {
    const res = await send(app, '3519009', '/budget');
    expect(res.statusCode).toBe(200);
    expect(res.json().reply).toMatch(/restricted/i);
  });

  it('customer cannot request materials (worker/founder-only)', async () => {
    const res = await send(app, '3519001', '/request bricks 50');
    expect(res.statusCode).toBe(200);
    expect(res.json().reply).toMatch(/only workers/i);
  });

  it('customer can see budget', async () => {
    const res = await send(app, '3519001', '/budget');
    expect(res.statusCode).toBe(200);
    expect(res.json().reply).toContain('Budget Summary');
  });

  it('/help shows different commands based on role', async () => {
    const workerRes = await send(app, '3519009', '/help');
    const customerRes = await send(app, '3519001', '/help');

    const workerHelp = workerRes.json().reply;
    const customerHelp = customerRes.json().reply;

    // Worker sees /log, customer does not.
    expect(workerHelp).toContain('/log');
    expect(customerHelp).not.toContain('/log');

    // Customer sees /budget, worker does not.
    expect(customerHelp).toContain('/budget');
    expect(workerHelp).not.toContain('/budget');
  });
});
