import { describe, it, expect, beforeEach, vi } from 'vitest';
import { plainSummary, projectMetrics } from '../src/brain/dashboard.js';
import { resetModelClient, setModelClient } from '../src/brain/model.js';

const PROJECT = { id: 1, name: 'Vila Sol', status: 'active', client_phone: '3519001', worker_phones: ['3519009'], budget: 50000 };
const EMPTY   = { id: 2, name: 'Quinta Nova', status: 'active', client_phone: '3519002', worker_phones: [], budget: 0 };

vi.mock('../src/models/project.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getProject: vi.fn(async (id) => ({ 1: PROJECT, 2: EMPTY }[Number(id)] ?? null)),
    listProjectsForUser: vi.fn(async (user) => (user.role === 'founder' || user.role === 'admin') ? [PROJECT, EMPTY] : []),
  };
});

vi.mock('../src/models/task.js', () => ({
  TASK_STATUSES: ['todo', 'doing', 'blocked', 'done'],
  listTasks: vi.fn(async (pid) => pid === 1 ? [
    { id: 1, status: 'done', due_on: '2026-01-01' },
    { id: 2, status: 'todo', due_on: '2020-01-01' },          // overdue
    { id: 3, status: 'blocked', due_on: null },
    { id: 4, status: 'doing', due_on: '2030-01-01' },
  ] : []),
}));

vi.mock('../src/models/changeOrder.js', () => ({
  listChangeOrders: vi.fn(async (pid) => (pid?.projectId ?? pid) === 1 ? [
    { id: 1, status: 'proposed', cost_delta: 1000 },
    { id: 2, status: 'approved', cost_delta: 2500 },
  ] : []),
}));

vi.mock('../src/models/material.js', () => ({
  listRequests: vi.fn(async ({ projectId } = {}) => projectId === 1 ? [
    { id: 1, status: 'requested', item: 'cimento', qty: 5 },
  ] : []),
}));

vi.mock('../src/models/dailyLog.js', () => ({
  listLogs: vi.fn(async (pid) => pid === 1 ? [{ id: 1, logged_at: '2026-06-19T10:00:00Z' }] : []),
}));

const { buildApp } = await import('../src/app.js');
const { signToken } = await import('../src/auth.js');
function hdr(role, phone) { return { 'x-internal-token': signToken({ phone, role }) }; }

let app;
beforeEach(() => { app = buildApp(); resetModelClient(); });

describe('dashboard metrics', () => {
  it('aggregates the right per-project metrics', async () => {
    const m = await projectMetrics(PROJECT);
    expect(m.tasksTotal).toBe(4);
    expect(m.tasksDone).toBe(1);
    expect(m.pctComplete).toBe(25);
    expect(m.overdueTasks).toBe(1);
    expect(m.blockedTasks).toBe(1);
    expect(m.pendingApprovals).toBe(2);     // 1 change order + 1 material
    expect(m.budgetVariance).toBe(2500);     // approved CO only
    expect(m.hasData).toBe(true);
  });

  it('degrades gracefully for a project with no data', async () => {
    const m = await projectMetrics(EMPTY);
    expect(m.pctComplete).toBe(0);
    expect(m.hasData).toBe(false);
    expect(plainSummary(m)).toContain('sem atividade');
  });
});

describe('dashboard routes', () => {
  it('founder gets a rollup across projects', async () => {
    const r = await app.inject({ method: 'GET', url: '/dashboard', headers: hdr('founder', '3510000') });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.projects.length).toBe(2);
    expect(body.totals.projectCount).toBe(2);
    expect(body.totals.overdueTasks).toBe(1);
    expect(body.projects[0].summary).toBeTruthy();
  });

  it('per-project dashboard is founder-only (customer 403)', async () => {
    const r = await app.inject({ method: 'GET', url: '/projects/1/dashboard', headers: hdr('customer', '3519001') });
    expect(r.statusCode).toBe(403);
  });

  it('uses the model client for phrasing when installed', async () => {
    setModelClient(async () => 'Tudo sob controlo.');
    const r = await app.inject({ method: 'GET', url: '/projects/1/dashboard', headers: hdr('founder', '3510000') });
    expect(r.statusCode).toBe(200);
    expect(r.json().summary).toBe('Tudo sob controlo.');
  });
});
