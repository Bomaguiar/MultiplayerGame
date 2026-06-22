// Proactive outbound alerts.
//
// The agent doesn't only answer — it reaches out. This scans a project for
// conditions worth a nudge (overdue tasks, pending approvals, an unsent daily
// client update) and enqueues them as `whatsapp`-channel notifications. A
// delivery bridge drains them from the outbox (see routes/whatsapp.js) and
// sends them; nothing here talks to WhatsApp directly, so it's fully testable.
//
// Deduped: an alert with the same (recipient, key) that is already pending is
// not re-queued, so repeated scans (e.g. an hourly cron) don't spam anyone.

import { listTasks } from '../models/task.js';
import { listRequests } from '../models/material.js';
import { listChangeOrders } from '../models/changeOrder.js';
import { listSelections } from '../models/selection.js';
import { usersByRole } from '../models/user.js';
import { createNotification, listNotifications } from '../models/notification.js';
import { dailyClientUpdate } from './dailySummary.js';

const today = () => new Date().toISOString().slice(0, 10);

// Normalize an ISO string or a pg Date object to a YYYY-MM-DD key for comparison.
function dayKey(ts) {
  if (!ts) return '';
  if (ts instanceof Date) return ts.toISOString().slice(0, 10);
  const s = String(ts);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s.slice(0, 10) : d.toISOString().slice(0, 10);
}
const isOverdue = (due, status) => { const k = dayKey(due); return k && k < today() && status !== 'done'; };

/** Phones of everyone who manages projects (founders + admins). */
async function managerPhones() {
  const [founders, admins] = await Promise.all([
    usersByRole('founder').catch(() => []),
    usersByRole('admin').catch(() => []),
  ]);
  return [...new Set([...founders, ...admins].map((u) => u.phone))];
}

/**
 * Scan a project and return the alerts that *should* exist right now.
 * Each: { recipientPhone, type, title, body, key }. Pure (no writes).
 */
export async function scanProject(project, { includeDailySummary = false } = {}) {
  const [tasks, materials, changeOrders, selections, managers] = await Promise.all([
    listTasks(project.id).catch(() => []),
    listRequests({ projectId: project.id }).catch(() => []),
    listChangeOrders({ projectId: project.id }).catch(() => []),
    listSelections({ projectId: project.id }).catch(() => []),
    managerPhones(),
  ]);
  const alerts = [];
  const eur = (n) => `€${Number(n || 0).toLocaleString('pt-PT')}`;

  // 1. Overdue tasks → digest to each manager and to assignees.
  const overdue = tasks.filter((t) => isOverdue(t.due_on, t.status));
  if (overdue.length) {
    const lines = overdue.slice(0, 8).map((t) => `• ${t.title}`).join('\n');
    const body = `⚠️ ${overdue.length} tarefa(s) atrasada(s) em ${project.name}:\n${lines}`;
    for (const phone of managers) {
      alerts.push({ recipientPhone: phone, type: 'task_update', title: `Tarefas atrasadas — ${project.name}`, body, key: `overdue:${today()}` });
    }
    for (const phone of new Set(overdue.map((t) => t.assignee_phone).filter(Boolean))) {
      const mine = overdue.filter((t) => t.assignee_phone === phone);
      alerts.push({
        recipientPhone: phone, type: 'task_update',
        title: `Tem ${mine.length} tarefa(s) atrasada(s)`,
        body: `⚠️ Tarefas atrasadas:\n${mine.slice(0, 8).map((t) => `• ${t.title}`).join('\n')}`,
        key: `overdue_mine:${today()}`,
      });
    }
  }

  // 2. Pending material requests → managers.
  const pendingMats = materials.filter((m) => m.status === 'requested');
  if (pendingMats.length) {
    const lines = pendingMats.slice(0, 8).map((m) => `• ${m.item} ×${Number(m.qty)}${m.urgency === 'urgent' ? ' 🔴' : ''} — responda "aprovar ${m.id}"`).join('\n');
    const body = `📦 ${pendingMats.length} pedido(s) de material a aguardar aprovação em ${project.name}:\n${lines}`;
    for (const phone of managers) {
      alerts.push({ recipientPhone: phone, type: 'material_decision', title: `Materiais a aprovar — ${project.name}`, body, key: `mat_pending:${today()}` });
    }
  }

  // 3. Proposed change orders & pending selections → the client.
  const proposedCO = changeOrders.filter((c) => c.status === 'proposed');
  const pendingSel = selections.filter((s) => s.status === 'pending');
  if (proposedCO.length || pendingSel.length) {
    const parts = [];
    if (proposedCO.length) parts.push(`📋 ${proposedCO.length} alteração(ões): ${proposedCO.map((c) => `${c.title} (${eur(c.cost_delta)})`).join('; ')}`);
    if (pendingSel.length) parts.push(`🎨 ${pendingSel.length} selecção(ões) a decidir: ${pendingSel.map((s) => s.name).join('; ')}`);
    alerts.push({
      recipientPhone: project.client_phone, type: 'change_order',
      title: `Decisões pendentes — ${project.name}`,
      body: `Olá! Há decisões à sua espera em ${project.name}:\n${parts.join('\n')}`,
      key: `client_pending:${today()}`,
    });
  }

  // 4. Optional daily client update (the "auto-send at 6pm" content).
  if (includeDailySummary) {
    const upd = await dailyClientUpdate(project).catch(() => null);
    if (upd && upd.metrics?.entries) {
      alerts.push({
        recipientPhone: project.client_phone, type: 'daily_log',
        title: `Atualização do dia — ${project.name}`,
        body: upd.summary, key: `daily:${upd.date}`,
      });
    }
  }

  return alerts;
}

/**
 * Enqueue the project's due alerts as pending whatsapp notifications, skipping
 * any that already have a pending notification with the same key for the same
 * recipient. Returns the notifications actually created.
 */
export async function enqueueAlerts(project, opts = {}) {
  const alerts = await scanProject(project, opts);
  const created = [];
  for (const a of alerts) {
    // Dedupe against any recent notification (pending OR already sent) with the
    // same key. Keys are date-stamped, so this yields one nudge per condition
    // per day — no re-send storm when a fast poll loop drains the outbox.
    const existing = await listNotifications({ recipientPhone: a.recipientPhone, projectId: project.id, limit: 100 }).catch(() => []);
    const dup = existing.some((n) => n.metadata && n.metadata.key === a.key);
    if (dup) continue;
    const n = await createNotification({
      projectId: project.id, recipientPhone: a.recipientPhone, type: a.type,
      title: a.title, body: a.body, channel: 'whatsapp', metadata: { key: a.key, proactive: true },
    }).catch(() => null);
    if (n) created.push(n);
  }
  return created;
}
