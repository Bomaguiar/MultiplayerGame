import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { newDb } from 'pg-mem';
import { setPool, query } from '../src/db.js';
import { runMigrations } from '../migrations/run.js';
import { createProject } from '../src/models/project.js';
import { createChangeOrder, decideChangeOrder, budgetSummary } from '../src/models/changeOrder.js';
import { createRequest } from '../src/models/material.js';

// Regression: budgetSummary once cross-joined change_orders with
// material_requests, multiplying the change-order sums by the number of
// material rows (and used FILTER, which pg-mem mishandles). These tests lock in
// correct, un-inflated aggregates.
beforeAll(async () => {
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  setPool(new Pool());
  await runMigrations();
});

let project;
beforeEach(async () => {
  for (const t of ['change_orders', 'material_requests', 'projects']) await query(`DELETE FROM ${t}`);
  project = await createProject({ name: 'P', clientPhone: '3519001', workerPhones: ['3519009'], budget: 50000 });
});

describe('budgetSummary', () => {
  it('does not inflate change-order sums when many materials exist', async () => {
    // Two proposed change orders totalling 10000...
    await createChangeOrder({ projectId: project.id, title: 'A', costDelta: 4000, proposedBy: '3519001' });
    await createChangeOrder({ projectId: project.id, title: 'B', costDelta: 6000, proposedBy: '3519001' });
    // ...and several material rows that previously multiplied the sums.
    for (let i = 0; i < 5; i++) {
      await createRequest({ projectId: project.id, requestedBy: '3519009', item: `m${i}`, qty: 1 });
    }
    const s = await budgetSummary(project.id);
    expect(Number(s.current_budget)).toBe(50000);
    expect(Number(s.pending_changes)).toBe(10000);
    expect(Number(s.pending_count)).toBe(2);
    expect(Number(s.approved_changes)).toBe(0);
  });

  it('moves a change order from pending to approved correctly', async () => {
    const co = await createChangeOrder({ projectId: project.id, title: 'A', costDelta: 4000, proposedBy: '3519001' });
    await decideChangeOrder(co.id, 'approved', '3519001');
    const s = await budgetSummary(project.id);
    expect(Number(s.approved_changes)).toBe(4000);
    expect(Number(s.approved_count)).toBe(1);
    expect(Number(s.pending_changes)).toBe(0);
    // approving also bumps the project budget
    expect(Number(s.current_budget)).toBe(54000);
  });

  it('returns null for a missing project', async () => {
    expect(await budgetSummary(999999)).toBeNull();
  });
});
