import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { newDb } from 'pg-mem';
import { setPool, query } from '../src/db.js';
import { runMigrations } from '../migrations/run.js';
import { remember, recall, trim, renderContext } from '../src/brain/memory.js';

// Boot a real in-memory Postgres so memory.js runs its actual SQL (the trim
// DELETE … NOT IN subquery can't be faithfully mocked).
beforeAll(async () => {
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  setPool(new Pool());
  await runMigrations();
});

beforeEach(async () => {
  await query('DELETE FROM conversation_memory');
});

describe('conversation memory (T14)', () => {
  it('stores and recalls the last N turns in chat order', async () => {
    for (let i = 1; i <= 5; i++) {
      await remember({ contactPhone: '351900', role: 'customer', content: `msg ${i}` });
    }
    const turns = await recall({ contactPhone: '351900', role: 'customer', maxTurns: 3 });
    expect(turns.length).toBe(3);
    expect(turns.map((t) => t.content)).toEqual(['msg 3', 'msg 4', 'msg 5']); // oldest→newest
  });

  it('scopes memory so a contact cannot read another contact or role', async () => {
    await remember({ contactPhone: 'A', role: 'customer', content: 'segredo A' });
    await remember({ contactPhone: 'B', role: 'customer', content: 'segredo B' });
    await remember({ contactPhone: 'A', role: 'worker',   content: 'A as worker' });

    const a = await recall({ contactPhone: 'A', role: 'customer' });
    expect(a.map((t) => t.content)).toEqual(['segredo A']);     // not B, not worker-role A
  });

  it('trims memory to the configured budget', async () => {
    for (let i = 1; i <= 20; i++) {
      await remember({ contactPhone: 'C', role: 'customer', content: `turn ${i}` });
    }
    // remember() auto-trims to DEFAULT_MAX_TURNS (10).
    const { rows } = await query(
      `SELECT COUNT(*)::int AS n FROM conversation_memory WHERE contact_phone = 'C'`);
    expect(rows[0].n).toBeLessThanOrEqual(10);

    await trim({ contactPhone: 'C', role: 'customer', maxTurns: 3 });
    const after = await recall({ contactPhone: 'C', role: 'customer', maxTurns: 50 });
    expect(after.length).toBe(3);
  });

  it('honours the character budget on recall', async () => {
    await remember({ contactPhone: 'D', role: 'customer', content: 'x'.repeat(100) });
    await remember({ contactPhone: 'D', role: 'customer', content: 'y'.repeat(100) });
    const turns = await recall({ contactPhone: 'D', role: 'customer', charBudget: 120 });
    expect(turns.length).toBe(1);   // only the newest fits the budget
  });

  it('renders context in prompt form', () => {
    const ctx = renderContext([
      { direction: 'in', content: 'olá' },
      { direction: 'out', content: 'oi' },
    ]);
    expect(ctx).toBe('user: olá\nassistant: oi');
  });
});
