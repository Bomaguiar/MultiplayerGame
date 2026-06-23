import { describe, it, expect, beforeEach, vi } from 'vitest';
import { materialsRollup, plainMaterialsSummary, summarizeMaterials } from '../src/brain/materialsRollup.js';
import { setModelClient, resetModelClient } from '../src/brain/model.js';

// Pending material requests across multiple projects.
const ALL = [
  { id: 1, project_id: 1, item: 'Cimento', qty: 10, unit: 'sacos', urgency: 'high',   status: 'requested' },
  { id: 2, project_id: 2, item: 'cimento', qty: 5,  unit: 'sacos', urgency: 'normal', status: 'requested' },
  { id: 3, project_id: 1, item: 'Tinta',   qty: 3,  unit: 'latas', urgency: 'urgent', status: 'requested' },
  { id: 4, project_id: 1, item: 'Madeira', qty: 2,  unit: null,    urgency: 'normal', status: 'ordered' },   // not pending
];

vi.mock('../src/models/material.js', () => ({
  listRequests: vi.fn(async ({ projectId = null, status = null } = {}) =>
    ALL.filter((r) => (!projectId || r.project_id === projectId) && (!status || r.status === status))),
}));

const { buildApp } = await import('../src/app.js');
const { signToken } = await import('../src/auth.js');
function hdr(role, phone) { return { 'x-internal-token': signToken({ phone, role }) }; }

let app;
beforeEach(() => { app = buildApp(); resetModelClient(); });

describe('materials rollup aggregation', () => {
  it('groups pending requests by item with summed quantities (case-insensitive)', async () => {
    const r = await materialsRollup();
    expect(r.totalRequests).toBe(3);                       // 'ordered' excluded
    const cimento = r.byItem.find((i) => i.item.toLowerCase() === 'cimento');
    expect(cimento.totalQty).toBe(15);                     // 10 + 5 merged
    expect(cimento.count).toBe(2);
    expect(r.byItem[0].totalQty).toBe(15);                 // sorted desc
  });

  it('filters by project and urgency', async () => {
    const byProject = await materialsRollup({ projectId: 1 });
    expect(byProject.totalRequests).toBe(2);
    const byUrgency = await materialsRollup({ urgency: 'urgent' });
    expect(byUrgency.totalRequests).toBe(1);
    expect(byUrgency.byItem[0].item).toBe('Tinta');
  });

  it('plain summary degrades when no model is available', async () => {
    const r = await materialsRollup();
    const summary = await summarizeMaterials(r);
    expect(summary).toBe(plainMaterialsSummary(r));
    expect(summary).toContain('Cimento');
  });

  it('uses the model summary when available', async () => {
    setModelClient(async () => 'Precisa de cimento e tinta com urgência.');
    const summary = await summarizeMaterials(await materialsRollup());
    expect(summary).toBe('Precisa de cimento e tinta com urgência.');
  });
});

describe('materials rollup route', () => {
  it('founder-only access (worker 403)', async () => {
    const r = await app.inject({ method: 'GET', url: '/materials/rollup', headers: hdr('worker', '3519009') });
    expect(r.statusCode).toBe(403);
  });

  it('founder gets the aggregated view with a summary', async () => {
    const r = await app.inject({ method: 'GET', url: '/materials/rollup', headers: hdr('founder', '3510000') });
    expect(r.statusCode).toBe(200);
    expect(r.json().totalRequests).toBe(3);
    expect(r.json().summary).toBeTruthy();
  });
});
