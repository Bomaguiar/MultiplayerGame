// Materials brain (T13). Consolidates pending material requests across ALL
// projects/builders so a founder gets one view: grouped by item (with summed
// quantities), by project, and by urgency — plus a short AI-phrased summary
// that degrades to a plain list when no model is installed.

import { listRequests } from '../models/material.js';
import { callModel } from './model.js';

/**
 * Aggregate pending ('requested') material requests.
 * @param {object} opts - optional { projectId, urgency } filters.
 */
export async function materialsRollup({ projectId = null, urgency = null } = {}) {
  let requests = await listRequests({ projectId, status: 'requested' }).catch(() => []);
  if (urgency) requests = requests.filter((r) => r.urgency === urgency);

  const byItem = new Map();
  const byProject = new Map();
  const byUrgency = new Map();

  for (const r of requests) {
    const qty = Number(r.qty || 0);

    const itemKey = String(r.item || '').toLowerCase().trim();
    const item = byItem.get(itemKey) || { item: r.item, totalQty: 0, unit: r.unit ?? null, count: 0 };
    item.totalQty += qty;
    item.count += 1;
    byItem.set(itemKey, item);

    const pk = r.project_id;
    byProject.set(pk, (byProject.get(pk) || 0) + 1);

    const u = r.urgency || 'normal';
    byUrgency.set(u, (byUrgency.get(u) || 0) + 1);
  }

  return {
    totalRequests: requests.length,
    byItem: [...byItem.values()].sort((a, b) => b.totalQty - a.totalQty),
    byProject: [...byProject.entries()].map(([project_id, count]) => ({ project_id, count })),
    byUrgency: [...byUrgency.entries()].map(([urgency, count]) => ({ urgency, count })),
  };
}

/** Deterministic plain-text summary (also used as the model fallback). */
export function plainMaterialsSummary(rollup) {
  if (!rollup.totalRequests) return 'Sem pedidos de material pendentes.';
  const lines = [`${rollup.totalRequests} pedido(s) de material pendente(s):`];
  for (const i of rollup.byItem) {
    lines.push(`• ${i.item}: ${i.totalQty}${i.unit ? ' ' + i.unit : ''} (${i.count} pedido(s))`);
  }
  return lines.join('\n');
}

/** AI-phrased summary with graceful degradation to the plain list. */
export async function summarizeMaterials(rollup) {
  const fallback = plainMaterialsSummary(rollup);
  const out = await callModel({
    system: 'You are a procurement assistant. Summarize pending material needs in 1-2 short sentences (Portuguese).',
    prompt: `Pedidos de material pendentes: ${JSON.stringify(rollup)}`,
  });
  return out || fallback;
}
