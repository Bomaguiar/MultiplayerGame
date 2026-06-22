// Construction AI agent.
//
// Turns a free-form WhatsApp message (text + any photo refs) into an action.
// Two interchangeable understanding paths, same tool surface (agentTools.js):
//
//   • deterministic — a bilingual (PT/EN) intent resolver that needs no model,
//     so the bot is fully functional and testable offline.
//   • model — when a Claude client is wired (ANTHROPIC_API_KEY), it picks the
//     tool and extracts parameters via structured JSON, handling messier phrasing.
//
// The model only *chooses + extracts*; the tools render the structured replies,
// so behaviour stays reliable and auditable with or without the key.

import { callModel } from './model.js';
import { toolsForRole, runTool } from './agentTools.js';
import { remember, recall, renderContext } from './memory.js';

// ── Small extractors ─────────────────────────────────────────────────────────
const numAfter = (text, re) => { const m = text.match(re); return m ? Number(m[1].replace(',', '.')) : null; };
const firstNumber = (text) => numAfter(text, /\b(\d+(?:[.,]\d+)?)\b/);
const extractHours = (text) => numAfter(text, /(\d+(?:[.,]\d+)?)\s*(?:h\b|horas?|hrs?)/i);
const extractCrew = (text) => numAfter(text, /(\d+)\s*(?:pessoas?|trabalhadores?|homens|operários|guys|workers|people|crew)/i);
function extractUrgency(text) {
  if (/\b(urgent\w*|asap|imediat\w*|já\b|para ontem)/i.test(text)) return 'urgent';
  if (/\b(alta prioridade|high priority|importante)/i.test(text)) return 'high';
  if (/\b(quando puder\w*|sem pressa|low priority|baixa)/i.test(text)) return 'low';
  return 'normal';
}
function extractTaskId(text) {
  const hash = text.match(/#\s*(\d+)/);
  if (hash) return Number(hash[1]);
  const t = text.match(/\b(?:tarefa|task)\s*(?:n[ºo.]?\s*)?(\d+)/i);
  return t ? Number(t[1]) : null;
}

const REPORT_VERBS = /\b(pint\w+|instal\w+|fizemos|fiz|fez|terminei|terminámos|termin\w+|acab\w+|mont\w+|repar\w+|limp\w+|começ\w+|avanç\w+|coloc\w+|escav\w+|betonei|today|hoje|painted|install\w+|finish\w+|started|fixed|cleaned|did|pour\w+|demolish\w+)\b/i;

/** Deterministic intent resolver: message + role → { tool, params } or null. */
export function resolveIntent(rawText, role) {
  const text = String(rawText || '').trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  const tools = toolsForRole(role);
  const has = (name) => name in tools;
  const isQuestion = /\?\s*$/.test(text) || /^(qual|quanto|quando|como|o que|what|how much|how|when|porque)\b/i.test(lower);

  // 1. Help.
  if (/\b(ajuda|help|o que (podes|consegues|sabes)|what can you|comandos?|menu)\b/i.test(lower)) {
    if (has('help')) return { tool: 'help', params: {} };
  }
  // 2. Approve.
  if (/\b(aprov\w+|approve|autoriz\w+|ok para|confirmo o)\b/i.test(lower) && has('approve_item')) {
    const id = firstNumber(text);
    if (id) return { tool: 'approve_item', params: { itemId: id } };
  }
  // 3. Complete task.
  if (/\b(feita|feito|conclu\w+|terminei|terminada|acabei|done|completed|finished|pronto|prontas?)\b/i.test(lower)
      && (/\b(tarefa|task|#)\b/i.test(lower) || extractTaskId(text)) && has('complete_task')) {
    return { tool: 'complete_task', params: { taskId: extractTaskId(text), title: text } };
  }
  // 4. Request material.
  if (/\b(preciso|precisamos|pedir|pedido de|falta\w*|encomend\w+|comprar|need|require|request|order)\b/i.test(lower)
      && has('request_material')) {
    return { tool: 'request_material', params: parseMaterial(text) };
  }
  // 5. Budget.
  if (/\b(orçament\w+|orcament\w+|budget|custo\w*|gast\w+|quanto (falta|resta|sobra|custa|gast)|quanto (já )?gast)\b/i.test(lower)
      && has('get_budget')) {
    return { tool: 'get_budget', params: {} };
  }
  // 6. Materials list.
  if (/\b(materia\w+ pendent\w+|pedidos? de materia\w+|pending material|que materia\w+|lista de materia\w+)\b/i.test(lower)
      && has('list_materials')) {
    return { tool: 'list_materials', params: {} };
  }
  // 7. Selections.
  if (/\b(selec\w+|escolhas?|acabament\w+|selection)\b/i.test(lower) && has('list_selections')) {
    return { tool: 'list_selections', params: {} };
  }
  // 8. Daily summary.
  if (/\b(resumo|sumário|sumario|summary|atualiza\w+ (para|do) cliente|update (para|do) cliente)\b/i.test(lower)
      && has('daily_summary')) {
    return { tool: 'daily_summary', params: {} };
  }
  // 9. Tasks.
  if (/\b(tarefas?|tasks?|o que (tenho|falta) (para|por) fazer|to.?do|trabalho de hoje)\b/i.test(lower)
      && has('get_tasks')) {
    return { tool: 'get_tasks', params: {} };
  }
  // 10. Status.
  if (/\b(estado|status|situação|situacao|ponto de situação|como (vai|está) a obra|how('?s| is)|progress\w*)\b/i.test(lower)
      && has('get_status')) {
    return { tool: 'get_status', params: {} };
  }
  // 11. Log work — fallback for field roles when it reads like a report.
  if (has('log_work') && !isQuestion && (REPORT_VERBS.test(lower) || lower.split(/\s+/).length >= 4)) {
    return { tool: 'log_work', params: { note: text, crewCount: extractCrew(text), hours: extractHours(text) } };
  }
  return null;
}

/** Parse a material request message into { item, qty, urgency }. */
export function parseMaterial(text) {
  const urgency = extractUrgency(text);
  const qty = firstNumber(text) || 1;
  let item = text
    .replace(/\b(preciso de|precisamos de|preciso|precisamos|pedir|pedido de|falta(m)?|encomendar|comprar|i need|we need|need|require|request|order|por favor|please)\b/gi, ' ')
    .replace(/\b(urgent\w*|asap|imediat\w*|já\b|para ontem|alta prioridade|high priority|sem pressa|quando puder\w*)\b/gi, ' ')
    .replace(/#?\s*\d+(?:[.,]\d+)?/, ' ') // drop the qty token (first number only)
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '') // trim stray punctuation
    .trim();
  if (!item) item = text.trim();
  return { item, qty, urgency };
}

// ── Model path (optional) ────────────────────────────────────────────────────
function toolCatalogue(role) {
  return Object.entries(toolsForRole(role))
    .map(([name, t]) => `- ${name}: ${t.description}${Object.keys(t.params).length ? ` params: ${JSON.stringify(t.params)}` : ''}`)
    .join('\n');
}

/** Ask the model to choose a tool + params. Returns {tool,params} or null. */
export async function chooseToolViaModel(text, role, context = '') {
  const out = await callModel({
    system: 'És o cérebro de um assistente de obra no WhatsApp. Escolhe UMA ferramenta para responder à '
      + 'mensagem do utilizador e extrai os parâmetros. Responde APENAS com JSON: {"tool":"<nome>","params":{...}}. '
      + 'Se nenhuma ferramenta servir, responde {"tool":null}. Não inventes ferramentas fora da lista.',
    prompt: `Ferramentas disponíveis:\n${toolCatalogue(role)}\n\n`
      + (context ? `Contexto recente:\n${context}\n\n` : '')
      + `Mensagem do utilizador: "${text}"\n\nJSON:`,
  });
  if (!out) return null;
  try {
    const json = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
    if (!json || !json.tool || !(json.tool in toolsForRole(role))) return null;
    return { tool: json.tool, params: json.params || {} };
  } catch {
    return null;
  }
}

// ── Main entry ───────────────────────────────────────────────────────────────
/**
 * Run the agent for one inbound message.
 * @returns {Promise<{reply:string, tool:string|null, action?:string, data?:object}>}
 */
export async function runAgent({ user, projectId, text, mediaRefs = [] }) {
  const ctx = { user, projectId, mediaRefs };

  // Photo-only message from a field user → treat as a log with whatever caption.
  const trimmed = String(text || '').trim();
  if (!trimmed && mediaRefs.length && toolsForRole(user.role).log_work) {
    const r = await runTool('log_work', ctx, { note: 'Fotos da obra.' });
    return pack('log_work', r);
  }

  // Prefer the model for understanding; fall back to the deterministic resolver.
  let choice = null;
  const turns = await recall({ contactPhone: user.phone, role: user.role, projectId, maxTurns: 4 }).catch(() => []);
  const context = renderContext(turns);
  if (trimmed) {
    choice = await chooseToolViaModel(trimmed, user.role, context).catch(() => null);
    if (!choice) choice = resolveIntent(trimmed, user.role);
  }

  const logTurns = async (reply) => {
    await remember({ contactPhone: user.phone, role: user.role, projectId, direction: 'in', content: trimmed }).catch(() => {});
    if (reply) await remember({ contactPhone: user.phone, role: user.role, projectId, direction: 'out', content: reply }).catch(() => {});
  };

  if (!choice) {
    const fallbackTool = toolsForRole(user.role).help ? 'help' : null;
    const r = fallbackTool
      ? await runTool('help', ctx, {})
      : { text: 'Desculpe, não percebi. Escreva "ajuda" para ver o que posso fazer.' };
    await logTurns(r?.text);
    return pack(fallbackTool, r);
  }

  const result = await runTool(choice.tool, ctx, choice.params);
  await logTurns(result?.text);
  return pack(choice.tool, result);
}

function pack(tool, result) {
  return {
    reply: result?.text || 'Feito.',
    tool: result?.denied ? null : tool,
    ...(result?.action ? { action: result.action } : {}),
    ...(result?.data ? { data: result.data } : {}),
  };
}
