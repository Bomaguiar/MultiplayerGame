// Founder dashboard rollup. Aggregates per-project health metrics from the
// domain models (no heavy SQL, so it runs identically on real Postgres and the
// in-memory pg-mem demo) and phrases a one-line summary via the model interface
// — degrading to a deterministic sentence when no model is installed.

import { listTasks } from '../models/task.js';
import { listChangeOrders } from '../models/changeOrder.js';
import { listRequests } from '../models/material.js';
import { listLogs } from '../models/dailyLog.js';
import { callModel } from './model.js';

const today = () => new Date().toISOString().slice(0, 10);

/** Compute health metrics for a single project. Never throws on empty data. */
export async function projectMetrics(project) {
  const [tasks, changeOrders, materials, logs] = await Promise.all([
    listTasks(project.id).catch(() => []),
    listChangeOrders({ projectId: project.id }).catch(() => []),
    listRequests({ projectId: project.id }).catch(() => []),
    listLogs(project.id, 1).catch(() => []),
  ]);

  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done').length;
  const pctComplete = total ? Math.round((done / total) * 100) : 0;

  const t = today();
  const overdueTasks = tasks.filter(
    (x) => x.due_on && String(x.due_on).slice(0, 10) < t && x.status !== 'done'
  ).length;
  const blockedTasks = tasks.filter((x) => x.status === 'blocked').length;

  const pendingChangeOrders = changeOrders.filter((c) => c.status === 'proposed');
  const pendingMaterials = materials.filter((m) => m.status === 'requested');
  const pendingApprovals = pendingChangeOrders.length + pendingMaterials.length;

  // Budget variance = sum of approved change-order cost deltas (what moved the
  // budget away from its original baseline). Positive = over the baseline.
  const budgetVariance = changeOrders
    .filter((c) => c.status === 'approved')
    .reduce((sum, c) => sum + Number(c.cost_delta || 0), 0);

  const lastActivity = logs[0]?.logged_at ?? null;

  return {
    projectId: project.id,
    name: project.name,
    status: project.status ?? 'active',
    pctComplete,
    tasksDone: done,
    tasksTotal: total,
    overdueTasks,
    blockedTasks,
    pendingApprovals,
    pendingChangeOrders: pendingChangeOrders.length,
    pendingMaterials: pendingMaterials.length,
    budget: Number(project.budget || 0),
    budgetVariance,
    lastActivity,
    hasData: total > 0 || changeOrders.length > 0 || materials.length > 0 || logs.length > 0,
  };
}

/** Deterministic one-liner used as the fallback (and the model prompt source). */
export function plainSummary(m) {
  if (!m.hasData) return `${m.name}: sem atividade registada ainda.`;
  const parts = [`${m.name}: ${m.pctComplete}% concluído`];
  if (m.overdueTasks) parts.push(`${m.overdueTasks} tarefa(s) atrasada(s)`);
  if (m.pendingApprovals) parts.push(`${m.pendingApprovals} aprovação(ões) pendente(s)`);
  if (m.budgetVariance) {
    const sign = m.budgetVariance > 0 ? '+' : '';
    parts.push(`orçamento ${sign}€${m.budgetVariance.toLocaleString('pt-PT')}`);
  }
  return parts.join(', ') + '.';
}

/** AI-phrased summary with graceful degradation to plainSummary(). */
export async function summarizeProject(m) {
  const fallback = plainSummary(m);
  const out = await callModel({
    system: 'You are a concise construction project manager. Reply with ONE short sentence in Portuguese.',
    prompt: `Resume a saúde deste projeto numa frase: ${JSON.stringify(m)}`,
  });
  return out || fallback;
}

/** Roll up every project the founder can see into metrics + summaries. */
export async function dashboardRollup(projects) {
  const out = [];
  for (const p of projects) {
    const metrics = await projectMetrics(p);
    out.push({ ...metrics, summary: await summarizeProject(metrics) });
  }
  return out;
}
