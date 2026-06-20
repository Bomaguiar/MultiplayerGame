// WhatsApp command router.
//
// Parses incoming WhatsApp messages into commands and executes them against
// the domain models. Supports both English and Portuguese command aliases.

import { listProjectsForUser, getProject } from '../models/project.js';
import { listTasks, getTask, setStatus } from '../models/task.js';
import { createLog } from '../models/dailyLog.js';
import { listRequests, createRequest, decideRequest } from '../models/material.js';
import { decideChangeOrder, budgetSummary, listChangeOrders } from '../models/changeOrder.js';

// ── Command definitions ─────────────────────────────────────────────────────

const COMMAND_MAP = [
  { names: ['/status', 'estado'],                         cmd: 'status' },
  { names: ['/tasks', 'tarefas'],                         cmd: 'tasks' },
  { names: ['/task done', 'tarefa feita'],                cmd: 'task_done' },
  { names: ['/log', 'registo'],                           cmd: 'log' },
  { names: ['/materials', 'materiais'],                   cmd: 'materials' },
  { names: ['/request', 'pedir'],                         cmd: 'request' },
  { names: ['/approve', 'aprovar'],                       cmd: 'approve' },
  { names: ['/budget', 'orcamento', 'orçamento'],         cmd: 'budget' },
  { names: ['/help', 'ajuda'],                            cmd: 'help' },
];

/**
 * Parse a raw message string into { cmd, args }.
 * Returns { cmd: 'unknown', args: '' } when no command matches.
 */
export function parseCommand(messageText) {
  if (!messageText || typeof messageText !== 'string') {
    return { cmd: 'unknown', args: '' };
  }

  const text = messageText.trim();
  const lower = text.toLowerCase();

  // Try longest-name-first so "/task done" beats "/task".
  const sorted = COMMAND_MAP
    .flatMap((entry) => entry.names.map((n) => ({ name: n, cmd: entry.cmd })))
    .sort((a, b) => b.name.length - a.name.length);

  for (const { name, cmd } of sorted) {
    if (lower === name || lower.startsWith(name + ' ')) {
      const args = text.slice(name.length).trim();
      return { cmd, args };
    }
  }

  return { cmd: 'unknown', args: '' };
}

// ── Role helpers ────────────────────────────────────────────────────────────

const FOUNDER_ROLES = ['founder', 'admin'];
const BUDGET_ROLES  = ['customer', 'founder', 'admin'];
const LOG_ROLES     = ['worker', 'founder', 'admin'];

// ── Command executors ───────────────────────────────────────────────────────

async function cmdStatus(user, projectId) {
  const project = await getProject(projectId);
  if (!project) return { text: 'Project not found.' };
  const tasks = await listTasks(projectId);
  const done  = tasks.filter((t) => t.status === 'done').length;
  const total = tasks.length;
  const text = [
    `📋 *${project.name}*`,
    `Status: ${project.status ?? 'active'}`,
    `Tasks: ${done}/${total} done`,
    project.budget ? `Budget: €${project.budget}` : null,
  ].filter(Boolean).join('\n');
  return { text, data: { project, tasksDone: done, tasksTotal: total } };
}

async function cmdTasks(user, projectId) {
  const tasks = await listTasks(projectId);
  if (!tasks.length) return { text: 'No tasks found.' };

  // Workers see only their tasks; founders/admins see all.
  const visible = (user.role === 'worker')
    ? tasks.filter((t) => t.assignee_phone === user.phone)
    : tasks;

  if (!visible.length) return { text: 'No tasks assigned to you.' };

  const lines = visible.map((t) =>
    `• [${t.id}] ${t.title} — ${t.status}${t.priority === 'urgent' ? ' 🔴' : ''}`
  );
  return { text: lines.join('\n'), data: visible };
}

async function cmdTaskDone(user, projectId, args) {
  if (!LOG_ROLES.includes(user.role)) {
    return { text: 'Only workers and founders can complete tasks.' };
  }
  const id = parseInt(args, 10);
  if (!id) return { text: 'Usage: /task done <id>' };
  const task = await getTask(id);
  if (!task) return { text: `Task #${id} not found.` };
  if (task.project_id !== projectId) return { text: `Task #${id} not in this project.` };
  if (user.role === 'worker' && task.assignee_phone !== user.phone) {
    return { text: 'This task is not assigned to you.' };
  }
  const updated = await setStatus(id, 'done', user.phone);
  return { text: `✅ Task #${id} "${updated.title}" marked as done.`, data: updated };
}

async function cmdLog(user, projectId, args) {
  if (!LOG_ROLES.includes(user.role)) {
    return { text: 'Only workers and founders can post logs.' };
  }
  if (!args) return { text: 'Usage: /log <note text>' };
  const log = await createLog({ projectId, authorPhone: user.phone, note: args });
  return { text: `📝 Log recorded.`, data: log };
}

async function cmdMaterials(_user, projectId) {
  const reqs = await listRequests({ projectId, status: 'pending' });
  if (!reqs.length) return { text: 'No pending material requests.' };
  const lines = reqs.map((r) =>
    `• [${r.id}] ${r.item} × ${r.qty}${r.urgency === 'urgent' ? ' 🔴' : ''}`
  );
  return { text: lines.join('\n'), data: reqs };
}

async function cmdRequest(user, projectId, args) {
  if (!LOG_ROLES.includes(user.role)) {
    return { text: 'Only workers and founders can request materials.' };
  }
  if (!args) return { text: 'Usage: /request <item> <qty>' };
  // Last token as qty if numeric, else qty = 1.
  const parts = args.split(/\s+/);
  let qty = 1;
  let item = args;
  if (parts.length >= 2) {
    const last = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(last) && last > 0) {
      qty = last;
      item = parts.slice(0, -1).join(' ');
    }
  }
  const req = await createRequest({ projectId, requestedBy: user.phone, item, qty });
  return { text: `📦 Requested: ${item} × ${qty}`, data: req };
}

async function cmdApprove(user, _projectId, args) {
  if (!FOUNDER_ROLES.includes(user.role)) {
    return { text: 'Only founders can approve items.' };
  }
  const id = parseInt(args, 10);
  if (!id) return { text: 'Usage: /approve <id>' };

  // Try material request first, then change order.
  const mr = await decideRequest(id, 'approved', user.phone).catch(() => null);
  if (mr) return { text: `✅ Material request #${id} approved.`, data: mr };

  const co = await decideChangeOrder(id, 'approved', user.phone).catch(() => null);
  if (co) return { text: `✅ Change order #${id} approved.`, data: co };

  return { text: `Item #${id} not found or cannot be approved.` };
}

async function cmdBudget(user, projectId) {
  if (!BUDGET_ROLES.includes(user.role)) {
    return { text: 'Budget info is restricted to customers and founders.' };
  }
  const summary = await budgetSummary(projectId);
  if (!summary) return { text: 'No budget data available.' };
  const text = [
    `💰 *Budget Summary*`,
    `Current budget: €${summary.current_budget}`,
    `Approved changes: €${summary.approved_changes} (${summary.approved_count})`,
    `Pending changes: €${summary.pending_changes} (${summary.pending_count})`,
  ].join('\n');
  return { text, data: summary };
}

function cmdHelp(user) {
  const lines = ['Available commands:'];
  lines.push('/status — project status');
  lines.push('/tasks — list tasks');

  if (LOG_ROLES.includes(user.role)) {
    lines.push('/task done <id> — mark task done');
    lines.push('/log <text> — post a daily log');
    lines.push('/request <item> <qty> — request material');
  }

  lines.push('/materials — pending material requests');

  if (FOUNDER_ROLES.includes(user.role)) {
    lines.push('/approve <id> — approve material/change order');
  }

  if (BUDGET_ROLES.includes(user.role)) {
    lines.push('/budget — budget summary');
  }

  lines.push('/help — show this message');
  return { text: lines.join('\n') };
}

// ── Main executor ───────────────────────────────────────────────────────────

/**
 * Execute a parsed command in the context of a user and project.
 * Returns { text: string, data?: object }.
 */
export async function executeCommand({ cmd, args }, user, projectId) {
  switch (cmd) {
    case 'status':    return cmdStatus(user, projectId);
    case 'tasks':     return cmdTasks(user, projectId);
    case 'task_done': return cmdTaskDone(user, projectId, args);
    case 'log':       return cmdLog(user, projectId, args);
    case 'materials': return cmdMaterials(user, projectId);
    case 'request':   return cmdRequest(user, projectId, args);
    case 'approve':   return cmdApprove(user, projectId, args);
    case 'budget':    return cmdBudget(user, projectId);
    case 'help':      return cmdHelp(user);
    default:
      return { text: 'Unknown command. Send /help or ajuda to see available commands.' };
  }
}
