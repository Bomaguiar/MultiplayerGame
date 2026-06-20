import { describe, it, expect, vi } from 'vitest';
import { signToken, verifyToken } from '../src/auth.js';
import { requireRole } from '../src/middleware/requireRole.js';

// Build a fake Fastify reply that records code()/send().
function fakeReply() {
  return {
    statusCode: null,
    body: null,
    code(c) { this.statusCode = c; return this; },
    send(b) { this.body = b; return this; },
  };
}

describe('internal token', () => {
  it('round-trips a signed identity', () => {
    const t = signToken({ phone: '351900000000', role: 'worker' });
    expect(verifyToken(t)).toEqual({ phone: '351900000000', role: 'worker' });
  });

  it('rejects a tampered token', () => {
    const t = signToken({ phone: '351900000000', role: 'worker' });
    const tampered = t.slice(0, -2) + (t.endsWith('aa') ? 'bb' : 'aa');
    expect(verifyToken(tampered)).toBeNull();
  });

  it('rejects an expired token', () => {
    const t = signToken({ phone: '351900000000', role: 'founder' }, -1);
    expect(verifyToken(t)).toBeNull();
  });
});

describe('requireRole', () => {
  it('401s when unauthenticated', () => {
    const guard = requireRole('founder');
    const reply = fakeReply();
    const done = vi.fn();
    guard({ user: null }, reply, done);
    expect(reply.statusCode).toBe(401);
    expect(done).not.toHaveBeenCalled();
  });

  it('403s on the wrong role', () => {
    const guard = requireRole('founder');
    const reply = fakeReply();
    const done = vi.fn();
    guard({ user: { role: 'customer' } }, reply, done);
    expect(reply.statusCode).toBe(403);
    expect(done).not.toHaveBeenCalled();
  });

  it('passes the correct role', () => {
    const guard = requireRole('worker', 'founder');
    const reply = fakeReply();
    const done = vi.fn();
    guard({ user: { role: 'worker' } }, reply, done);
    expect(done).toHaveBeenCalledOnce();
    expect(reply.statusCode).toBeNull();
  });

  it('admin always passes', () => {
    const guard = requireRole('founder');
    const reply = fakeReply();
    const done = vi.fn();
    guard({ user: { role: 'admin' } }, reply, done);
    expect(done).toHaveBeenCalledOnce();
  });
});

describe('roleForPhone', () => {
  it('returns the stored role for a phone', async () => {
    vi.resetModules();
    vi.doMock('../src/db.js', () => ({
      query: vi.fn(async () => ({ rows: [{ id: 1, phone: '351911111111', name: 'Pedro', role: 'founder' }] })),
    }));
    const { roleForPhone } = await import('../src/models/user.js');
    expect(await roleForPhone('351911111111')).toBe('founder');
    vi.doUnmock('../src/db.js');
  });
});
