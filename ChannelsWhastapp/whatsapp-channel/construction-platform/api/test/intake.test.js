import { describe, it, expect, beforeEach, vi } from 'vitest';
import { keywordClassify, classifyRequest } from '../src/brain/classifier.js';
import { routeRole } from '../src/brain/triage.js';
import { setModelClient, resetModelClient } from '../src/brain/model.js';
import { setTranscriber, resetTranscriber } from '../src/intake/transcriber.js';

const PROJECT = { id: 1, name: 'Vila Sol', client_phone: '3519001', worker_phones: ['3519009'], status: 'active', budget: 50000 };

// In-memory customer_requests store.
const reqs = new Map();
let seq = 0;
vi.mock('../src/models/customerRequest.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createCustomerRequest: vi.fn(async (b) => {
      const r = { id: ++seq, status: 'new', category: null, urgency: null, project_id: b.projectId ?? null, customer_phone: b.customerPhone, channel: b.channel, raw_text: b.rawText, media_ref: b.mediaRef ?? null };
      reqs.set(r.id, r);
      return r;
    }),
    listCustomerRequests: vi.fn(async ({ customerPhone } = {}) =>
      [...reqs.values()].filter((r) => !customerPhone || r.customer_phone === customerPhone)),
    setTriage: vi.fn(async (id, { category, urgency }) => {
      const r = reqs.get(Number(id));
      if (!r) return null;
      r.category = category; r.urgency = urgency; r.status = 'triaged';
      return r;
    }),
  };
});

vi.mock('../src/models/project.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getProject: vi.fn(async (id) => Number(id) === 1 ? PROJECT : null) };
});

vi.mock('../src/models/user.js', () => ({
  usersByRole: vi.fn(async (role) => role === 'founder' ? [{ phone: '3510000', role: 'founder' }] : []),
}));

const notifications = [];
vi.mock('../src/models/notification.js', () => ({
  createNotification: vi.fn(async (n) => { const x = { id: notifications.length + 1, ...n }; notifications.push(x); return x; }),
}));

const { buildApp } = await import('../src/app.js');
const { signToken } = await import('../src/auth.js');
function hdr(role, phone) { return { 'x-internal-token': signToken({ phone, role }) }; }

let app;
beforeEach(() => { app = buildApp(); reqs.clear(); seq = 0; notifications.length = 0; resetModelClient(); resetTranscriber(); });

describe('keyword classifier (fallback)', () => {
  it('classifies an issue as high urgency', () => {
    const r = keywordClassify('Há uma fuga de água na cozinha');
    expect(r.category).toBe('issue');
    expect(['high', 'urgent']).toContain(r.urgency);
  });
  it('classifies a change request', () => {
    expect(keywordClassify('Quero mudar a cor da parede').category).toBe('change_request');
  });
  it('classifies a scheduling question', () => {
    expect(keywordClassify('Quando é a próxima visita?').category).toBe('scheduling');
  });
  it('flags urgent keywords', () => {
    expect(keywordClassify('isto é urgente!').urgency).toBe('urgent');
  });
  it('routes issue->worker, complaint->founder', () => {
    expect(routeRole('issue')).toBe('worker');
    expect(routeRole('complaint')).toBe('founder');
    expect(routeRole('unknown')).toBe('founder');
  });
});

describe('classifyRequest uses model when available', () => {
  it('parses model JSON', async () => {
    setModelClient(async () => '{"category":"complaint","urgency":"urgent"}');
    expect(await classifyRequest('whatever')).toEqual({ category: 'complaint', urgency: 'urgent' });
  });
  it('falls back to keywords when model disabled', async () => {
    resetModelClient();
    expect((await classifyRequest('quero adicionar uma janela')).category).toBe('change_request');
  });
});

describe('intake routes', () => {
  it('text request creates a CustomerRequest (status new) and acks', async () => {
    const r = await app.inject({
      method: 'POST', url: '/requests', headers: hdr('customer', '3519001'),
      payload: { projectId: 1, text: 'Quando começam o telhado?' },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.ack).toBeTruthy();
    expect(body.triage.category).toBe('scheduling');
    // The created record started as 'new'.
    const created = [...reqs.values()][0];
    expect(created.customer_phone).toBe('3519001');
  });

  it('voice request is transcribed and stored with channel=voice', async () => {
    setTranscriber(async ({ mediaRef }) => `transcrição de ${mediaRef}: há um problema`);
    const r = await app.inject({
      method: 'POST', url: '/requests', headers: hdr('customer', '3519001'),
      payload: { projectId: 1, channel: 'voice', mediaRef: 'media-abc' },
    });
    expect(r.statusCode).toBe(201);
    const created = [...reqs.values()][0];
    expect(created.channel).toBe('voice');
    expect(created.raw_text).toContain('media-abc');
  });

  it('voice without mediaRef is rejected', async () => {
    const r = await app.inject({
      method: 'POST', url: '/requests', headers: hdr('customer', '3519001'),
      payload: { projectId: 1, channel: 'voice' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('triage notifies the responsible role', async () => {
    await app.inject({
      method: 'POST', url: '/requests', headers: hdr('customer', '3519001'),
      payload: { projectId: 1, text: 'Estou muito insatisfeito com o trabalho' },
    });
    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications[0].recipientPhone).toBe('3510000');   // founder
  });

  it('worker cannot submit a customer request (403)', async () => {
    const r = await app.inject({
      method: 'POST', url: '/requests', headers: hdr('worker', '3519009'),
      payload: { text: 'hi' },
    });
    expect(r.statusCode).toBe(403);
  });
});
