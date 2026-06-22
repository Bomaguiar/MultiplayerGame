import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { newDb } from 'pg-mem';
import { setPool, query } from '../src/db.js';
import { runMigrations } from '../migrations/run.js';
import { createProject } from '../src/models/project.js';
import {
  createBudgetItem, updateBudgetItem, listBudgetItems,
  deleteBudgetItem, budgetBreakdown,
} from '../src/models/budgetItem.js';

beforeAll(async () => {
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  setPool(new Pool());
  await runMigrations();
});

let projectId;
beforeEach(async () => {
  await query('DELETE FROM budget_items');
  await query('DELETE FROM projects');
  const p = await createProject({
    name: 'Test', clientPhone: '3519001', workerPhones: ['3519009'], budget: 50000,
  });
  projectId = p.id;
});

describe('budget items CRUD', () => {
  it('creates and lists items', async () => {
    await createBudgetItem({ projectId, category: 'Eléctrica', description: 'Tomadas', estimated: 1200 });
    await createBudgetItem({ projectId, category: 'Eléctrica', description: 'Cabos', estimated: 800 });
    const items = await listBudgetItems(projectId);
    expect(items).toHaveLength(2);
    expect(items[0].category).toBe('Eléctrica');
  });

  it('updates actual cost and status', async () => {
    const item = await createBudgetItem({ projectId, category: 'Interior', description: 'Pintura', estimated: 5000 });
    const updated = await updateBudgetItem(item.id, { actual: 4800, status: 'completed' });
    expect(Number(updated.actual)).toBe(4800);
    expect(updated.status).toBe('completed');
  });

  it('deletes an item', async () => {
    const item = await createBudgetItem({ projectId, category: 'WC', description: 'Torneira', estimated: 300 });
    const deleted = await deleteBudgetItem(item.id);
    expect(deleted.id).toBe(item.id);
    const list = await listBudgetItems(projectId);
    expect(list).toHaveLength(0);
  });
});

describe('budget breakdown', () => {
  it('groups by category with totals', async () => {
    await createBudgetItem({ projectId, category: 'Exterior', description: 'Pintura', estimated: 3000, actual: 2800, status: 'completed' });
    await createBudgetItem({ projectId, category: 'Exterior', description: 'Vedação', estimated: 2000, actual: null, status: 'planned' });
    await createBudgetItem({ projectId, category: 'Interior', description: 'Chão', estimated: 5000, actual: 5200, status: 'over_budget' });

    const bd = await budgetBreakdown(projectId);
    expect(bd.categories).toHaveLength(2);
    expect(bd.categories[0].category).toBe('Exterior');
    expect(Number(bd.categories[0].estimated)).toBe(5000);
    expect(Number(bd.categories[0].actual)).toBe(2800);
    expect(Number(bd.totals.total_estimated)).toBe(10000);
    expect(Number(bd.totals.total_actual)).toBe(8000);
    expect(Number(bd.totals.total_completed)).toBe(1);
  });
});
