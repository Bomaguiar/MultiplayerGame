import { describe, it, expect, afterAll, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { closePool } from '../src/db.js';

// Stub the DB probe so the test needs no live Postgres.
vi.mock('../src/db.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, checkDb: vi.fn(async () => true) };
});

describe('GET /health', () => {
  afterAll(async () => {
    await closePool();
  });

  it('returns 200 with status ok and a boolean db flag', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.db).toBe('boolean');
    expect(body.db).toBe(true);
    expect(typeof body.ts).toBe('string');

    await app.close();
  });
});
