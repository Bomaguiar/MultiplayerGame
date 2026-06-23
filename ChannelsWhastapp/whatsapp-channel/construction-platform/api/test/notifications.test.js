import { describe, it, expect, beforeEach, vi } from 'vitest';

const PROJECT = { id: 1, name: 'Vila Sol', client_phone: '3519001', worker_phones: ['3519009'], status: 'active', budget: 85000 };

vi.mock('../src/models/project.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getProject: vi.fn(async (id) => (Number(id) === 1 ? { ...PROJECT } : null)),
  };
});

// In-memory notification store
const notifications = new Map();
let seq = 0;

vi.mock('../src/models/notification.js', () => ({
  NOTIFICATION_TYPES: ['task_update', 'material_decision', 'change_order', 'daily_log', 'system'],
  NOTIFICATION_CHANNELS: ['whatsapp', 'email', 'in_app'],
  NOTIFICATION_STATUSES: ['pending', 'sent', 'read', 'failed'],
  createNotification: vi.fn(async (b) => {
    const n = {
      id: ++seq,
      project_id: b.projectId ?? null,
      recipient_phone: b.recipientPhone,
      type: b.type,
      title: b.title,
      body: b.body ?? null,
      channel: b.channel ?? 'in_app',
      status: 'pending',
      metadata: b.metadata ?? {},
      created_at: new Date().toISOString(),
      sent_at: null,
    };
    notifications.set(n.id, n);
    return n;
  }),
  listNotifications: vi.fn(async ({ recipientPhone, projectId, status, type, limit } = {}) => {
    return [...notifications.values()]
      .filter((n) => n.recipient_phone === recipientPhone)
      .filter((n) => !projectId || n.project_id === projectId)
      .filter((n) => !status || n.status === status)
      .filter((n) => !type || n.type === type)
      .slice(0, limit || 50);
  }),
  markRead: vi.fn(async (id) => {
    const n = notifications.get(Number(id));
    if (!n) return null;
    n.status = 'read';
    return n;
  }),
  markSent: vi.fn(async (id) => {
    const n = notifications.get(Number(id));
    if (!n) return null;
    n.status = 'sent';
    n.sent_at = new Date().toISOString();
    return n;
  }),
  countUnread: vi.fn(async (recipientPhone) => {
    return [...notifications.values()]
      .filter((n) => n.recipient_phone === recipientPhone && ['pending', 'sent'].includes(n.status))
      .length;
  }),
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
beforeEach(() => { app = buildApp(); notifications.clear(); seq = 0; });

describe('notification routes', () => {
  it('lists notifications for current user', async () => {
    // Seed two notifications for different users
    const { createNotification } = await import('../src/models/notification.js');
    await createNotification({ recipientPhone: '3519001', type: 'system', title: 'Hello customer' });
    await createNotification({ recipientPhone: '3510000', type: 'system', title: 'Hello founder' });

    const r = await app.inject({
      method: 'GET', url: '/notifications',
      headers: hdr('customer', '3519001'),
    });
    expect(r.statusCode).toBe(200);
    const data = r.json();
    expect(data).toHaveLength(1);
    expect(data[0].title).toBe('Hello customer');
  });

  it('filters notifications by status', async () => {
    const { createNotification, markRead } = await import('../src/models/notification.js');
    const n1 = await createNotification({ recipientPhone: '3510000', type: 'system', title: 'Unread' });
    const n2 = await createNotification({ recipientPhone: '3510000', type: 'system', title: 'Read one' });
    await markRead(n2.id);

    const r = await app.inject({
      method: 'GET', url: '/notifications?status=read',
      headers: hdr('founder', '3510000'),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toHaveLength(1);
    expect(r.json()[0].title).toBe('Read one');
  });

  it('filters notifications by type', async () => {
    const { createNotification } = await import('../src/models/notification.js');
    await createNotification({ recipientPhone: '3510000', type: 'task_update', title: 'Task A' });
    await createNotification({ recipientPhone: '3510000', type: 'change_order', title: 'CO B' });

    const r = await app.inject({
      method: 'GET', url: '/notifications?type=task_update',
      headers: hdr('founder', '3510000'),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toHaveLength(1);
    expect(r.json()[0].type).toBe('task_update');
  });

  it('returns unread count', async () => {
    const { createNotification, markRead } = await import('../src/models/notification.js');
    await createNotification({ recipientPhone: '3519001', type: 'system', title: 'A' });
    await createNotification({ recipientPhone: '3519001', type: 'system', title: 'B' });
    const n3 = await createNotification({ recipientPhone: '3519001', type: 'system', title: 'C' });
    await markRead(n3.id);

    const r = await app.inject({
      method: 'GET', url: '/notifications/unread/count',
      headers: hdr('customer', '3519001'),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().count).toBe(2);
  });

  it('marks a notification as read', async () => {
    const { createNotification } = await import('../src/models/notification.js');
    const n = await createNotification({ recipientPhone: '3519001', type: 'system', title: 'To read' });

    const r = await app.inject({
      method: 'PATCH', url: `/notifications/${n.id}/read`,
      headers: hdr('customer', '3519001'),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe('read');
  });

  it('returns 404 for non-existent notification', async () => {
    const r = await app.inject({
      method: 'PATCH', url: '/notifications/999/read',
      headers: hdr('customer', '3519001'),
    });
    expect(r.statusCode).toBe(404);
  });

  it('forbids marking another user notification as read', async () => {
    const { createNotification } = await import('../src/models/notification.js');
    const n = await createNotification({ recipientPhone: '3510000', type: 'system', title: 'Not yours' });

    const r = await app.inject({
      method: 'PATCH', url: `/notifications/${n.id}/read`,
      headers: hdr('customer', '3519001'),
    });
    expect(r.statusCode).toBe(403);
  });

  it('unauthenticated request returns 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/notifications' });
    expect(r.statusCode).toBe(401);
  });

  it('all roles can access their notifications', async () => {
    const { createNotification } = await import('../src/models/notification.js');
    await createNotification({ recipientPhone: '3519009', type: 'task_update', title: 'Worker notif' });

    const r = await app.inject({
      method: 'GET', url: '/notifications',
      headers: hdr('worker', '3519009'),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toHaveLength(1);
  });
});
