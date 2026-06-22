// Tool registry for the construction AI agent.
//
// Each tool is a small, role-gated capability that maps a structured intent to
// an action against the existing domain models. The agent (brain/agent.js)
// chooses a tool + params — either via Claude tool-use or the deterministic
// resolver — then calls execute(). Keeping tools declarative here lets both the
// model path and the offline path share exactly the same capability surface, so
// the bot behaves identically with or without an API key.

import { getProject } from '../models/project.js';
import { listTasks, getTask, setStatus } from '../models/task.js';
import { createLog } from '../models/dailyLog.js';
import { listRequests, createRequest, decideRequest } from '../models/material.js';
import { budgetSummary, decideChangeOrder } from '../models/changeOrder.js';
import { budgetBreakdown } from '../models/budgetItem.js';
import { listSelections } from '../models/selection.js';
import { dailyClientUpdate } from './dailySummary.js';

const eur = (n) => `€${Number(n || 0).toLocaleString('pt-PT')}`;

// Role groups.
const ALL = ['customer', 'worker', 'founder', 'admin'];
const FIELD = ['worker', 'founder', 'admin'];
const MONEY = ['customer', 'founder', 'admin'];
const BOSS = ['founder', 'admin'];

/**
 * The tool surface. `ctx` = { user, projectId }. Each execute returns
 * { text, data?, action? } — `action` names the side effect for the UI/audit.
 */
export const TOOLS = {
  get_status: {
    roles: ALL,
    description: 'Get the overall status of the project: progress, task counts, budget headline.',
    params: {},
    async execute(ctx) {
      const project = await getProject(ctx.projectId);
      if (!project) return { text: 'Projeto não encontrado.' };
      const tasks = await listTasks(ctx.projectId);
      const done = tasks.filter((t) => t.status === 'done').length;
      const lines = [
        `📋 *${project.name}*`,
        `Estado: ${project.status ?? 'ativo'}`,
        `Tarefas: ${done}/${tasks.length} concluídas`,
      ];
      if (MONEY.includes(ctx.user.role) && project.budget) lines.push(`Orçamento: ${eur(project.budget)}`);
      return { text: lines.join('\n'), data: { project, tasksDone: done, tasksTotal: tasks.length } };
    },
  },

  get_tasks: {
    roles: ALL,
    description: 'List the project tasks. Workers see only the tasks assigned to them.',
    params: {},
    async execute(ctx) {
      const tasks = await listTasks(ctx.projectId);
      const visible = ctx.user.role === 'worker'
        ? tasks.filter((t) => t.assignee_phone === ctx.user.phone)
        : tasks;
      if (!visible.length) return { text: 'Sem tarefas para mostrar.' };
      const icon = { todo: '⬜', doing: '🔨', blocked: '⛔', done: '✅' };
      const lines = visible.slice(0, 12).map(
        (t) => `${icon[t.status] || '•'} [${t.id}] ${t.title}${t.priority === 'urgent' ? ' 🔴' : ''}`
      );
      if (visible.length > 12) lines.push(`…e mais ${visible.length - 12}.`);
      return { text: lines.join('\n'), data: visible };
    },
  },

  get_budget: {
    roles: MONEY,
    description: 'Get the budget: total, spent so far (actuals), remaining, and pending change orders.',
    params: {},
    async execute(ctx) {
      const [summary, bd] = await Promise.all([
        budgetSummary(ctx.projectId),
        budgetBreakdown(ctx.projectId).catch(() => null),
      ]);
      if (!summary) return { text: 'Sem dados de orçamento.' };
      const spent = Number(bd?.totals?.total_actual || 0);
      const remaining = Number(summary.current_budget || 0) - spent;
      const lines = [
        '💰 *Orçamento*',
        `Total: ${eur(summary.current_budget)}`,
        `Gasto: ${eur(spent)}`,
        `Restante: ${eur(remaining)}`,
      ];
      if (Number(summary.pending_changes)) {
        lines.push(`Alterações pendentes: ${eur(summary.pending_changes)} (${summary.pending_count})`);
      }
      return { text: lines.join('\n'), data: { summary, spent, remaining } };
    },
  },

  log_work: {
    roles: FIELD,
    description: 'Record a daily site log from the worker\'s description of what was done today. '
      + 'Attach any photos sent with the message. Extract crew size and hours if mentioned.',
    params: { note: 'string (what was done)', crewCount: 'number, optional', hours: 'number, optional' },
    async execute(ctx, p) {
      const note = String(p.note || '').trim();
      if (!note) return { text: 'O que foi feito hoje? Envie uma breve descrição.' };
      const log = await createLog({
        projectId: ctx.projectId,
        authorPhone: ctx.user.phone,
        note,
        crewCount: Number(p.crewCount) || 0,
        hours: Number(p.hours) || 0,
        photoRefs: Array.isArray(ctx.mediaRefs) ? ctx.mediaRefs : [],
      });
      const extra = log.photo_refs?.length ? ` (${log.photo_refs.length} foto/s)` : '';
      return { text: `📝 Registo guardado${extra}. Obrigado!`, data: log, action: 'log_created' };
    },
  },

  request_material: {
    roles: FIELD,
    description: 'Create a material request. Extract item name, quantity, and urgency from the message.',
    params: { item: 'string', qty: 'number, default 1', urgency: 'low|normal|high|urgent, default normal' },
    async execute(ctx, p) {
      const item = String(p.item || '').trim();
      if (!item) return { text: 'Que material precisa? Ex: "preciso de 10 sacos de cimento, urgente".' };
      const req = await createRequest({
        projectId: ctx.projectId,
        requestedBy: ctx.user.phone,
        item,
        qty: Number(p.qty) > 0 ? Number(p.qty) : 1,
        urgency: ['low', 'normal', 'high', 'urgent'].includes(p.urgency) ? p.urgency : 'normal',
      });
      const flag = req.urgency === 'urgent' ? ' 🔴 urgente' : '';
      return { text: `📦 Pedido registado: ${req.item} ×${Number(req.qty)}${flag}. O gestor vai aprovar.`, data: req, action: 'material_requested' };
    },
  },

  list_materials: {
    roles: ALL,
    description: 'List pending (not yet approved) material requests for the project.',
    params: {},
    async execute(ctx) {
      const reqs = await listRequests({ projectId: ctx.projectId, status: 'requested' });
      if (!reqs.length) return { text: 'Sem pedidos de material pendentes.' };
      const lines = reqs.slice(0, 12).map(
        (r) => `• [${r.id}] ${r.item} ×${Number(r.qty)}${r.urgency === 'urgent' ? ' 🔴' : ''}`
      );
      return { text: `📦 *Pedidos pendentes*\n${lines.join('\n')}`, data: reqs };
    },
  },

  complete_task: {
    roles: FIELD,
    description: 'Mark a task as done. Identify it by its numeric id, or by matching words in its title.',
    params: { taskId: 'number, optional', title: 'string, optional (used to find the task)' },
    async execute(ctx, p) {
      const tasks = await listTasks(ctx.projectId);
      let task = null;
      if (p.taskId) task = tasks.find((t) => String(t.id) === String(p.taskId));
      if (!task && p.title) {
        const q = String(p.title).toLowerCase();
        task = tasks.find((t) => t.title.toLowerCase().includes(q))
          || tasks.find((t) => q.includes(t.title.toLowerCase().slice(0, 12)));
      }
      if (!task) return { text: 'Não encontrei essa tarefa. Indique o número, ex: "tarefa 12 feita".' };
      if (ctx.user.role === 'worker' && task.assignee_phone && task.assignee_phone !== ctx.user.phone) {
        return { text: `A tarefa #${task.id} não está atribuída a si.` };
      }
      const updated = await setStatus(task.id, 'done', ctx.user.phone);
      return { text: `✅ Tarefa #${task.id} "${updated.title}" marcada como concluída.`, data: updated, action: 'task_completed' };
    },
  },

  approve_item: {
    roles: BOSS,
    description: 'Approve a pending material request or change order by its numeric id.',
    params: { itemId: 'number' },
    async execute(ctx, p) {
      const id = parseInt(p.itemId, 10);
      if (!id) return { text: 'Qual o número do item a aprovar? Ex: "aprovar 7".' };
      const mr = await decideRequest(id, 'approved', ctx.user.phone).catch(() => null);
      if (mr) return { text: `✅ Pedido de material #${id} aprovado (a encomendar).`, data: mr, action: 'material_approved' };
      const co = await decideChangeOrder(id, 'approved', ctx.user.phone).catch(() => null);
      if (co) return { text: `✅ Alteração #${id} aprovada.`, data: co, action: 'change_order_approved' };
      return { text: `Não encontrei o item #${id} ou não pode ser aprovado.` };
    },
  },

  list_selections: {
    roles: ALL,
    description: 'List the client material/finish selections and their status (pending/approved/declined).',
    params: {},
    async execute(ctx) {
      const sels = await listSelections({ projectId: ctx.projectId });
      if (!sels.length) return { text: 'Sem selecções registadas.' };
      const icon = { pending: '⏳', approved: '✅', declined: '❌' };
      const lines = sels.slice(0, 12).map((s) => {
        const opts = (s.options || []).join(' / ');
        return `${icon[s.status] || '•'} [${s.id}] ${s.room ? s.room + ' — ' : ''}${s.name}${opts ? ` (${opts})` : ''}`;
      });
      return { text: `🎨 *Selecções*\n${lines.join('\n')}`, data: sels };
    },
  },

  daily_summary: {
    roles: BOSS,
    description: 'Generate the AI client update for the latest day of site logs, ready to send on WhatsApp.',
    params: {},
    async execute(ctx) {
      const project = await getProject(ctx.projectId);
      const res = await dailyClientUpdate(project);
      return { text: `✨ *Resumo para o cliente (${res.date})*\n\n${res.summary}`, data: res, action: 'summary_generated' };
    },
  },

  help: {
    roles: ALL,
    description: 'Explain what the assistant can do for this user.',
    params: {},
    async execute(ctx) {
      const r = ctx.user.role;
      const lines = ['Olá! Posso ajudar com:'];
      lines.push('• "estado da obra" — ponto de situação');
      lines.push('• "que tarefas tenho" — tarefas');
      if (FIELD.includes(r)) {
        lines.push('• "pintámos o portão, 2 pessoas, 8h" — registar trabalho (+fotos)');
        lines.push('• "preciso de 10 sacos de cimento, urgente" — pedir material');
        lines.push('• "tarefa 12 feita" — concluir tarefa');
      }
      if (MONEY.includes(r)) lines.push('• "como está o orçamento?" — orçamento');
      if (BOSS.includes(r)) {
        lines.push('• "aprovar 7" — aprovar pedido/alteração');
        lines.push('• "resumo para o cliente" — gerar atualização');
      }
      return { text: lines.join('\n') };
    },
  },
};

/** Tools available to a given role, as a name→tool map. */
export function toolsForRole(role) {
  const out = {};
  for (const [name, tool] of Object.entries(TOOLS)) {
    if (tool.roles.includes(role)) out[name] = tool;
  }
  return out;
}

/** Run a chosen tool with role enforcement. Returns the tool result or null. */
export async function runTool(name, ctx, params = {}) {
  const tool = TOOLS[name];
  if (!tool) return null;
  if (!tool.roles.includes(ctx.user.role)) {
    return { text: 'Não tem permissão para esta ação.', denied: true };
  }
  return tool.execute(ctx, params);
}
