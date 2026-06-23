import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory user store, rebuilt before each test.
let users;
function seed() {
  users = new Map([
    ['3510001', { id: 1, phone: '3510001', name: 'Pedro',  role: 'founder' }],
    ['3519009', { id: 2, phone: '3519009', name: 'Franek', role: 'worker' }],
    ['3519001', { id: 3, phone: '3519001', name: 'Ilya',   role: 'customer' }],
  ]);
}
seed();

vi.mock('../src/models/user.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    findByPhone: vi.fn(async (p) => users.get(p) ?? null),
    listUsers: vi.fn(async () => [...users.values()]),
    createUser: vi.fn(async ({ phone, name, role }) => {
      if (!actual.isRole(role)) throw new Error(`invalid role: ${role}`);
      const u = { id: users.size + 1, phone, name: name ?? null, role };
      users.set(phone, u);
      return u;
    }),
    updateUser: vi.fn(async (phone, { name, role } = {}) => {
      const u = users.get(phone);
      if (!u) return null;
      if (role !== undefined && !actual.isRole(role)) throw new Error(`invalid role: ${role}`);
      if (name !== undefined) u.name = name;
      if (role !== undefined) u.role = role;
      return u;
    }),
  };
});

const { buildApp } = await import('../src/app.js');
const { signToken } = await import('../src/auth.js');
function hdr(role, phone) { return { 'x-internal-token': signToken({ phone, role }) }; }

let app;
beforeEach(() => { app = buildApp(); seed(); });

describe('admin user management (T15)', () => {
  it('founder lists all users', async () => {
    const r = await app.inject({ method: 'GET', url: '/admin/users', headers: hdr('founder', '3510001') });
    expect(r.statusCode).toBe(200);
    expect(r.json().length).toBe(3);
  });

  it('worker cannot access admin (403)', async () => {
    const r = await app.inject({ method: 'GET', url: '/admin/users', headers: hdr('worker', '3519009') });
    expect(r.statusCode).toBe(403);
  });

  it('unauthenticated is 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/admin/users' });
    expect(r.statusCode).toBe(401);
  });

  it('founder renames a user', async () => {
    const r = await app.inject({
      method: 'PATCH', url: '/admin/users/3519009',
      headers: hdr('founder', '3510001'), payload: { name: 'Franek Nowak' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().name).toBe('Franek Nowak');
    expect(r.json().role).toBe('worker'); // unchanged
  });

  it('founder changes a role', async () => {
    const r = await app.inject({
      method: 'PATCH', url: '/admin/users/3519009',
      headers: hdr('founder', '3510001'), payload: { role: 'admin' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().role).toBe('admin');
  });

  it('rejects an invalid role (400)', async () => {
    const r = await app.inject({
      method: 'PATCH', url: '/admin/users/3519009',
      headers: hdr('founder', '3510001'), payload: { role: 'superuser' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('updating an unknown user is 404', async () => {
    const r = await app.inject({
      method: 'PATCH', url: '/admin/users/9999999',
      headers: hdr('founder', '3510001'), payload: { name: 'Ghost' },
    });
    expect(r.statusCode).toBe(404);
  });

  it('founder adds a new user', async () => {
    const r = await app.inject({
      method: 'POST', url: '/admin/users',
      headers: hdr('founder', '3510001'),
      payload: { phone: '3510042', name: 'Bernardo', role: 'worker' },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().phone).toBe('3510042');

    const list = await app.inject({ method: 'GET', url: '/admin/users', headers: hdr('founder', '3510001') });
    expect(list.json().length).toBe(4);
  });

  it('adding a user without phone/role is 400', async () => {
    const r = await app.inject({
      method: 'POST', url: '/admin/users',
      headers: hdr('founder', '3510001'), payload: { name: 'Nameless' },
    });
    expect(r.statusCode).toBe(400);
  });

  // admin role passes the founder gate (requireRole treats admin as superuser)
  it('admin role can manage users', async () => {
    const r = await app.inject({ method: 'GET', url: '/admin/users', headers: hdr('admin', '3510000') });
    expect(r.statusCode).toBe(200);
  });
});
