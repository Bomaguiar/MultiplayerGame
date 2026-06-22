// WhatsApp simulator for the Pedra & Luz construction agent.
// Talks to the real /agent/message endpoint with a demo token, so every reply
// and side effect is genuine — it drives the same backend the webhook uses.

let token = null;
let me = null;
let photoArmed = false;

const $ = (id) => document.getElementById(id);

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { 'x-internal-token': token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch { /* none */ }
  return { status: res.status, data };
}

const QUICK = {
  founder: ['estado da obra', 'como está o orçamento?', 'aprovar 1', 'resumo para o cliente', 'que materiais faltam?'],
  worker: ['pintámos o portão hoje, 2 pessoas, 8h', 'preciso de 10 sacos de cimento, urgente', 'que tarefas tenho?', 'tarefa 1 feita'],
  customer: ['como está a obra?', 'como está o orçamento?', 'que escolhas tenho?', 'ajuda'],
};

const GREETING = {
  founder: 'Olá Pedro 👋 Sou o assistente de obra. Pergunte-me pelo estado, orçamento, ou peça um resumo para o cliente.',
  worker: 'Olá Franek 👋 Diga-me o que fez hoje (pode enviar fotos), peça materiais ou marque tarefas como feitas.',
  customer: 'Olá Ilya 👋 Posso mostrar-lhe o estado da obra, o orçamento e as suas escolhas. Como posso ajudar?',
};

function now() { return new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }); }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function md(s) { return esc(s).replace(/\*(.+?)\*/g, '<strong>$1</strong>'); }

function addBubble(side, text, { photo = false } = {}) {
  const chat = $('chat');
  const b = document.createElement('div');
  b.className = `bubble ${side}`;
  b.innerHTML = md(text) + (photo ? '<span class="photo-chip">📷 foto anexada</span>' : '') + `<span class="time">${now()}</span>`;
  chat.appendChild(b);
  chat.scrollTop = chat.scrollHeight;
  return b;
}

function typing() {
  const chat = $('chat');
  const b = document.createElement('div');
  b.className = 'bubble them typing';
  b.textContent = 'a escrever…';
  chat.appendChild(b); chat.scrollTop = chat.scrollHeight;
  return b;
}

const TOOL_LABEL = {
  get_status: 'Estado do projeto', get_tasks: 'Listar tarefas', get_budget: 'Consultar orçamento',
  log_work: 'Registar trabalho', request_material: 'Pedir material', list_materials: 'Materiais pendentes',
  complete_task: 'Concluir tarefa', approve_item: 'Aprovar item', list_selections: 'Listar selecções',
  daily_summary: 'Gerar resumo cliente', help: 'Ajuda',
};
const EFFECTS = new Set(['log_created', 'material_requested', 'task_completed', 'material_approved', 'change_order_approved', 'summary_generated']);

function logAction(userText, res) {
  const log = $('actionLog');
  const empty = log.querySelector('.action-empty');
  if (empty) empty.remove();
  const card = document.createElement('div');
  card.className = 'action-card';
  const tool = res.tool ? (TOOL_LABEL[res.tool] || res.tool) : '— não percebido —';
  const isEffect = res.action && EFFECTS.has(res.action);
  card.innerHTML = `
    <div class="ac-tool ${isEffect ? 'effect' : ''}">${isEffect ? '✱ ' : ''}${esc(tool)}${res.action ? ` · ${esc(res.action)}` : ''}</div>
    <div class="ac-quote">“${esc(userText)}”</div>
    ${res.data ? `<div class="ac-msg">${esc(summarizeData(res.action, res.data))}</div>` : ''}`;
  log.prepend(card);
}

function summarizeData(action, data) {
  if (action === 'log_created') return `Registo #${data.id} guardado${data.photo_refs?.length ? ` · ${data.photo_refs.length} foto(s)` : ''}.`;
  if (action === 'material_requested') return `Pedido #${data.id}: ${data.item} ×${Number(data.qty)} (${data.urgency}).`;
  if (action === 'task_completed') return `Tarefa #${data.id} → done.`;
  if (action === 'material_approved') return `Material #${data.id} → ${data.status}.`;
  if (action === 'summary_generated') return `Resumo de ${data.date} pronto a enviar.`;
  if (data.summary?.current_budget != null) return `Orçamento €${Number(data.summary.current_budget).toLocaleString('pt-PT')}.`;
  return 'Dados devolvidos pela plataforma.';
}

async function setRole(role) {
  const { data } = await api('POST', '/demo/token', { role });
  token = data.token; me = data;
  document.querySelectorAll('.role-btn').forEach((b) => b.classList.toggle('active', b.dataset.role === role));
  $('chat').innerHTML = '';
  $('actionLog').innerHTML = '<div class="action-empty">Ainda sem ações. Envie uma mensagem ☝️</div>';
  $('phoneSub').textContent = `${me.name} · ${role}`;
  addBubble('them', GREETING[role] || 'Olá!');
  renderQuick(role);
}

function renderQuick(role) {
  const q = $('quick'); q.innerHTML = '';
  for (const text of QUICK[role] || []) {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.onclick = () => sendMessage(text);
    q.appendChild(btn);
  }
}

async function sendMessage(text) {
  const t = String(text || '').trim();
  const withPhoto = photoArmed;
  if (!t && !withPhoto) return;
  addBubble('me', t || '📷', { photo: withPhoto });
  $('input').value = '';
  disarmPhoto();

  const typ = typing();
  const mediaRefs = withPhoto ? ['wa-media/fence-1.jpg'] : [];
  const { status, data } = await api('POST', '/agent/message', { text: t, mediaRefs });
  typ.remove();

  if (status !== 200 || !data) { addBubble('them', 'Ups, algo correu mal. Tente novamente.'); return; }
  addBubble('them', data.reply || 'Feito.');
  logAction(t || '📷 (foto)', data);
}

function armPhoto() { photoArmed = true; $('attachBtn').classList.add('armed'); $('input').placeholder = '📷 foto pronta — descreva o trabalho…'; }
function disarmPhoto() { photoArmed = false; $('attachBtn').classList.remove('armed'); $('input').placeholder = 'Escreva uma mensagem…'; }

// Detect whether the live Claude model is wired (affects how messy phrasing is handled).
async function detectMode() {
  const { data } = await api('GET', '/health').catch(() => ({ data: null }));
  // Brain mode isn't exposed by /health; show a neutral, honest label.
  const el = $('aiMode');
  el.textContent = 'NLU offline + Claude quando a chave está configurada';
  el.classList.add('offline');
}

$('composer').addEventListener('submit', (e) => { e.preventDefault(); sendMessage($('input').value); });
$('attachBtn').addEventListener('click', () => (photoArmed ? disarmPhoto() : armPhoto()));

(async function init() {
  await api('POST', '/demo/seed');
  document.querySelectorAll('.role-btn').forEach((b) => b.addEventListener('click', () => setRole(b.dataset.role)));
  await detectMode();
  await setRole('founder');
})();
