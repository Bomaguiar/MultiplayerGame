import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { newDb } from 'pg-mem';
import { setPool, query } from '../src/db.js';
import { runMigrations } from '../migrations/run.js';
import { createProject } from '../src/models/project.js';
import { createTask, listTasks } from '../src/models/task.js';
import { createUser } from '../src/models/user.js';
import { listLogs } from '../src/models/dailyLog.js';
import { listRequests } from '../src/models/material.js';
import { setModelClient, resetModelClient } from '../src/brain/model.js';
import { resolveIntent, parseMaterial, runAgent } from '../src/brain/agent.js';

beforeAll(async () => {
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  setPool(new Pool());
  await runMigrations();
});

const FOUNDER = { phone: '351900000001', role: 'founder' };
const WORKER = { phone: '351900000009', role: 'worker' };
const CUSTOMER = { phone: '351900000002', role: 'customer' };

let project;
beforeEach(async () => {
  for (const t of ['daily_logs', 'material_requests', 'tasks', 'task_status_history', 'projects', 'users']) {
    await query(`DELETE FROM ${t}`);
  }
  for (const u of [FOUNDER, WORKER, CUSTOMER]) {
    await createUser({ phone: u.phone, name: u.role, role: u.role }).catch(() => {});
  }
  project = await createProject({
    name: 'Santa Rita', clientPhone: CUSTOMER.phone, workerPhones: [WORKER.phone], budget: 85000,
  });
});
afterEach(() => resetModelClient());

// ── Deterministic intent resolution ──────────────────────────────────────────
describe('resolveIntent (offline NLU)', () => {
  it('routes budget questions', () => {
    expect(resolveIntent('como está o orçamento?', 'founder').tool).toBe('get_budget');
    expect(resolveIntent('quanto falta gastar', 'customer').tool).toBe('get_budget');
  });
  it('routes status and tasks', () => {
    expect(resolveIntent('estado da obra', 'worker').tool).toBe('get_status');
    expect(resolveIntent('que tarefas tenho', 'worker').tool).toBe('get_tasks');
  });
  it('routes material requests and extracts qty + urgency', () => {
    const r = resolveIntent('preciso de 10 sacos de cimento urgente', 'worker');
    expect(r.tool).toBe('request_material');
    expect(r.params.qty).toBe(10);
    expect(r.params.urgency).toBe('urgent');
    expect(r.params.item.toLowerCase()).toContain('cimento');
  });
  it('routes task completion with an id', () => {
    const r = resolveIntent('tarefa 12 feita', 'worker');
    expect(r.tool).toBe('complete_task');
    expect(r.params.taskId).toBe(12);
  });
  it('routes approvals for founders only', () => {
    expect(resolveIntent('aprovar 7', 'founder').tool).toBe('approve_item');
    // customers have no approve tool → falls through (null or non-approve)
    const c = resolveIntent('aprovar 7', 'customer');
    expect(c?.tool).not.toBe('approve_item');
  });
  it('treats a descriptive report from a worker as a log', () => {
    const r = resolveIntent('pintámos o portão da garagem hoje, 2 pessoas, 8 horas', 'worker');
    expect(r.tool).toBe('log_work');
    expect(r.params.crewCount).toBe(2);
    expect(r.params.hours).toBe(8);
  });
  it('does not turn a customer question into a log', () => {
    const r = resolveIntent('quando termina a cozinha?', 'customer');
    expect(r?.tool).not.toBe('log_work');
  });
});

describe('parseMaterial', () => {
  it('handles English and defaults', () => {
    const r = parseMaterial('need 5 bags of plaster');
    expect(r.qty).toBe(5);
    expect(r.urgency).toBe('normal');
    expect(r.item.toLowerCase()).toContain('plaster');
  });
});

// ── End-to-end agent with real DB side effects ───────────────────────────────
describe('runAgent — side effects', () => {
  it('worker report creates a daily log (with photos)', async () => {
    const res = await runAgent({
      user: WORKER, projectId: project.id,
      text: 'instalámos 12 tomadas na sala hoje', mediaRefs: ['wa-media/x.jpg'],
    });
    expect(res.tool).toBe('log_work');
    expect(res.action).toBe('log_created');
    const logs = await listLogs(project.id);
    expect(logs).toHaveLength(1);
    expect(logs[0].photo_refs).toEqual(['wa-media/x.jpg']);
  });

  it('worker request creates a material request', async () => {
    const res = await runAgent({
      user: WORKER, projectId: project.id,
      text: 'precisamos de 20 sacos de cimento, urgente',
    });
    expect(res.tool).toBe('request_material');
    const reqs = await listRequests({ projectId: project.id });
    expect(reqs).toHaveLength(1);
    expect(reqs[0].urgency).toBe('urgent');
    expect(Number(reqs[0].qty)).toBe(20);
  });

  it('worker completes a task by id', async () => {
    const t = await createTask({ projectId: project.id, title: 'Pintar portão', assigneePhone: WORKER.phone });
    const res = await runAgent({ user: WORKER, projectId: project.id, text: `tarefa ${t.id} feita` });
    expect(res.action).toBe('task_completed');
    const [updated] = (await listTasks(project.id)).filter((x) => x.id === t.id);
    expect(updated.status).toBe('done');
  });

  it('photo-only message from a worker is logged', async () => {
    const res = await runAgent({ user: WORKER, projectId: project.id, text: '', mediaRefs: ['a.jpg', 'b.jpg'] });
    expect(res.tool).toBe('log_work');
    const logs = await listLogs(project.id);
    expect(logs[0].photo_refs).toEqual(['a.jpg', 'b.jpg']);
  });

  it('answers a budget question for the customer', async () => {
    const res = await runAgent({ user: CUSTOMER, projectId: project.id, text: 'como está o orçamento?' });
    expect(res.tool).toBe('get_budget');
    expect(res.reply).toContain('Orçamento');
  });
});

// ── Role enforcement ─────────────────────────────────────────────────────────
describe('runAgent — role gates', () => {
  it('a customer cannot log work (no log tool → help/no log effect)', async () => {
    const res = await runAgent({ user: CUSTOMER, projectId: project.id, text: 'pintámos tudo hoje com 3 pessoas' });
    expect(res.tool).not.toBe('log_work');
    const logs = await listLogs(project.id);
    expect(logs).toHaveLength(0);
  });

  it('a worker asking about budget does not get budget figures', async () => {
    const res = await runAgent({ user: WORKER, projectId: project.id, text: 'qual é o orçamento?' });
    expect(res.tool).not.toBe('get_budget');
  });
});

// ── Model path ───────────────────────────────────────────────────────────────
describe('runAgent — model tool-choice path', () => {
  it('uses the model JSON choice when a client is installed', async () => {
    setModelClient(async () => '{"tool":"get_status","params":{}}');
    const res = await runAgent({ user: FOUNDER, projectId: project.id, text: 'oi tudo bem como vai isso' });
    expect(res.tool).toBe('get_status');
  });

  it('falls back to deterministic when the model returns junk', async () => {
    setModelClient(async () => 'not json at all');
    const res = await runAgent({ user: WORKER, projectId: project.id, text: 'preciso de 3 baldes de tinta' });
    expect(res.tool).toBe('request_material');
  });

  it('never lets the model pick a tool outside the role', async () => {
    setModelClient(async () => '{"tool":"approve_item","params":{"itemId":1}}');
    const res = await runAgent({ user: WORKER, projectId: project.id, text: 'aprovar 1' });
    // worker has no approve_item; model choice is rejected → deterministic/help
    expect(res.tool).not.toBe('approve_item');
  });
});

// ── Unknown input ────────────────────────────────────────────────────────────
describe('runAgent — graceful fallback', () => {
  it('returns help for an unintelligible short message', async () => {
    const res = await runAgent({ user: CUSTOMER, projectId: project.id, text: 'xpto' });
    expect(res.reply).toMatch(/ajuda|posso ajudar/i);
  });
});
