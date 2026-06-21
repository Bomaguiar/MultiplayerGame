let token = null;
let me = null;
let projectId = null;

const $ = (id) => document.getElementById(id);

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'x-internal-token': token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data };
}

// ── Role switching ───────────────────────────────────────────────────────────
async function setRole(role) {
  const { data } = await api('POST', '/demo/token', { role });
  token = data.token; me = data;
  document.querySelectorAll('.role-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.role === role));
  $('who').textContent = `${me.name} (${role}) · ${me.phone}`;
  await render();
}

// ── Data load + render ───────────────────────────────────────────────────────
async function render() {
  const { data: projects } = await api('GET', '/projects');
  if (!projects || !projects.length) {
    $('banner').textContent = 'Sem projectos visíveis para este perfil.';
    $('project').innerHTML = ''; clearCards(); return;
  }
  $('banner').textContent = '';
  const p = projects[0];
  projectId = p.id;

  $('project').innerHTML = `
    <div class="eyebrow">Projeto em curso · Pedra &amp; Luz</div>
    <h1>${esc(p.name)}</h1>
    <div class="meta">
      <span>📍 ${esc(p.address || '—')}</span>
      <span class="sep">·</span>
      <span>Estado <b>${esc(p.status)}</b></span>
      <span class="sep">·</span>
      <span>Orçamento <b>€${Number(p.budget).toLocaleString('pt-PT')}</b></span>
    </div>`;

  await Promise.all([loadBudget(), loadMilestones(), loadSelections(), loadLogs(), loadTasks(), loadMaterials(), loadChangeOrders(), loadNotifBadge()]);
}

function clearCards() {
  ['budget', 'milestones', 'selections', 'logs', 'tasks', 'materials', 'changeOrders'].forEach((id) => ($(id).innerHTML = ''));
}

async function loadMilestones() {
  const { data: phases } = await api('GET', `/projects/${projectId}/phases`);
  let html = '<h2>📅 Fases & Marcos</h2>';
  for (const ph of phases || []) {
    const { data: ms } = await api('GET', `/phases/${ph.id}/milestones`);
    html += `<div class="row"><b>${esc(ph.name)}</b></div>`;
    for (const m of ms || []) {
      html += `<div class="row sub"><span>${esc(m.name)}</span>
        <span class="bar"><i style="width:${m.pct_complete}%"></i></span>
        <span class="pct">${m.pct_complete}%</span></div>`;
    }
  }
  $('milestones').innerHTML = html;
}

async function loadSelections() {
  const { data: sels } = await api('GET', `/projects/${projectId}/selections`);
  let html = '<h2>🎨 Selecções <span class="dim">(' + (sels || []).length + ')</span></h2>';
  if (me.role === 'founder') {
    html += `<button class="act" onclick="proposeSelection()">+ Nova selecção</button>`;
  }
  if (!sels || !sels.length) {
    $('selections').innerHTML = html + '<div class="dim">Sem selecções.</div>';
    return;
  }
  for (const s of sels) {
    const canDecide = me.role === 'customer' && s.status === 'pending';
    const opts = (s.options || []).join(' · ');
    const statusClass = s.status === 'approved' ? 'done' : s.status === 'declined' ? 'denied' : 'requested';
    const due = s.due_on ? new Date(s.due_on).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' }) : '';
    let chosen = '';
    if (s.status === 'approved') {
      chosen = `<div class="dim">✔ ${esc(s.chosen_option || '—')} · assinado por ${esc(s.signed_name || '')}</div>`;
    }
    html += `<div class="row mat">
      <span class="grow">
        ${s.room ? `<span class="tag">${esc(s.room)}</span> ` : ''}<b>${esc(s.name)}</b>
        ${opts ? `<div class="dim">${esc(opts)}</div>` : ''}
        ${chosen}
      </span>
      ${Number(s.price) ? `<span class="prio">+€${Number(s.price).toLocaleString('pt-PT')}</span>` : ''}
      ${due ? `<span class="dim">${due}</span>` : ''}
      <span class="status s-${statusClass}">${s.status}</span>
      ${canDecide ? `<button class="act sm ok" onclick="approveSelection(${s.id}, ${JSON.stringify(s.options || []).replace(/"/g, '&quot;')})">aprovar</button>
                     <button class="act sm no" onclick="declineSelection(${s.id})">recusar</button>` : ''}
    </div>`;
  }
  $('selections').innerHTML = html;
}

async function loadLogs() {
  const { data: logs } = await api('GET', `/projects/${projectId}/logs`);
  let html = '<h2>📔 Diário de Obra</h2>';
  if (me.role === 'worker') {
    html += `<button class="act" onclick="postLog()">+ Novo registo</button>`;
  }
  for (const l of logs || []) {
    const photos = (l.photo_refs || []).map(() => '🖼️').join(' ');
    html += `<div class="row log"><div>${esc(l.note)}</div>
      <div class="dim">${esc(l.weather || '')} · ${l.crew_count} pers · ${l.hours}h ${photos}</div></div>`;
  }
  $('logs').innerHTML = html || '<h2>📔 Diário de Obra</h2><div class="dim">Sem registos.</div>';
}

const NEXT = { todo: 'doing', doing: 'done' };
async function loadTasks() {
  const { data: tasks } = await api('GET', `/projects/${projectId}/tasks`);
  let html = '<h2>✅ Tarefas <span class="dim">(' + (tasks || []).length + ')</span></h2>';

  const grouped = {};
  for (const t of tasks || []) {
    const area = (t.tags && t.tags.length) ? t.tags[0] : (t.clickup_list_id ? 'ClickUp' : 'Geral');
    if (!grouped[area]) grouped[area] = [];
    grouped[area].push(t);
  }

  for (const [area, areaTasks] of Object.entries(grouped)) {
    html += `<div class="row area-header"><span class="tag">${esc(area)}</span> <span class="dim">${areaTasks.length} tarefas</span></div>`;
    for (const t of areaTasks) {
      const canAdvance = (me.role === 'worker' || me.role === 'founder') && NEXT[t.status];
      const assignee = t.assignee_name || t.assignee_phone || '';
      const dueStr = t.due_on ? new Date(t.due_on).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' }) : '';
      const clickupLink = t.clickup_url ? `<a href="${esc(t.clickup_url)}" target="_blank" class="cu-link" title="Abrir no ClickUp">↗</a>` : '';
      html += `<div class="row task">
        <span class="status s-${t.status}">${t.status}</span>
        <span class="grow">
          ${esc(t.title)} ${clickupLink}
          ${assignee ? `<span class="dim">${esc(assignee)}</span>` : ''}
        </span>
        ${dueStr ? `<span class="dim">${dueStr}</span>` : ''}
        <span class="prio p-${t.priority}">${t.priority}</span>
        ${canAdvance ? `<button class="act sm" onclick="advance(${t.id},'${NEXT[t.status]}')">→ ${NEXT[t.status]}</button>` : ''}
      </div>`;
    }
  }
  $('tasks').innerHTML = html;
}

async function loadMaterials() {
  const { data: mats } = await api('GET', `/projects/${projectId}/materials`);
  let html = '<h2>🧱 Materiais <span class="dim">(' + (mats || []).length + ')</span></h2>';
  if (me.role === 'worker') {
    html += `<button class="act" onclick="requestMaterial()">+ Pedir material</button>`;
  }
  for (const m of mats || []) {
    const canDecide = me.role === 'founder' && m.status === 'requested';
    html += `<div class="row mat">
      <span class="grow">${esc(m.item)} <b>×${m.qty}</b> ${esc(m.unit || '')}</span>
      <span class="status s-${m.status}">${m.status}</span>
      <span class="prio p-${m.urgency}">${m.urgency}</span>
      ${canDecide ? `<button class="act sm ok" onclick="decide(${m.id},'approved')">aprovar</button>
                     <button class="act sm no" onclick="decide(${m.id},'denied')">negar</button>` : ''}
    </div>`;
  }
  $('materials').innerHTML = html;
}

async function loadBudget() {
  if (me.role === 'worker') { $('budget').innerHTML = ''; return; }
  const { data, status } = await api('GET', `/projects/${projectId}/budget`);
  if (status !== 200 || !data) { $('budget').innerHTML = ''; return; }
  const fmt = (v) => `€${Number(v).toLocaleString('pt-PT')}`;
  $('budget').innerHTML = `
    <h2>💰 Orçamento</h2>
    <div class="budget-grid">
      <div class="budget-item"><span class="budget-val">${fmt(data.current_budget)}</span><span class="dim">Orçamento actual</span></div>
      <div class="budget-item"><span class="budget-val">${fmt(data.approved_changes)}</span><span class="dim">Alterações aprovadas</span></div>
      <div class="budget-item"><span class="budget-val pending">${fmt(data.pending_changes)}</span><span class="dim">${data.pending_count} pendente(s)</span></div>
    </div>`;
}

async function loadChangeOrders() {
  const { data: orders } = await api('GET', `/projects/${projectId}/change-orders`);
  let html = '<h2>📋 Alterações ao Projecto</h2>';
  if (me.role === 'founder') {
    html += `<button class="act" onclick="proposeChange()">+ Nova alteração</button>`;
  }
  for (const co of orders || []) {
    const canDecide = me.role === 'customer' && co.status === 'proposed';
    const costSign = Number(co.cost_delta) >= 0 ? '+' : '';
    html += `<div class="row mat">
      <span class="grow">${esc(co.title)}<br><span class="dim">${esc(co.description || '')}</span></span>
      <span class="prio">${costSign}€${Number(co.cost_delta).toLocaleString('pt-PT')}${co.days_delta ? ` · ${co.days_delta > 0 ? '+' : ''}${co.days_delta}d` : ''}</span>
      <span class="status s-${co.status === 'proposed' ? 'requested' : co.status === 'approved' ? 'done' : 'denied'}">${co.status}</span>
      ${canDecide ? `<button class="act sm ok" onclick="decideCO(${co.id},'approved')">aprovar</button>
                     <button class="act sm no" onclick="decideCO(${co.id},'rejected')">rejeitar</button>` : ''}
    </div>`;
  }
  $('changeOrders').innerHTML = html;
}

// ── Actions ─────────────────────────────────────────────────────────────────
async function advance(id, status) { await api('PATCH', `/tasks/${id}/status`, { status }); await render(); }
async function decide(id, decision) { await api('PATCH', `/materials/${id}/decision`, { decision }); await render(); }
async function postLog() {
  const note = prompt('Registo de hoje:'); if (!note) return;
  await api('POST', `/projects/${projectId}/logs`, { note, crewCount: 3, hours: 8 });
  await render();
}
async function requestMaterial() {
  const item = prompt('Material:'); if (!item) return;
  const qty = Number(prompt('Quantidade:', '1')) || 1;
  await api('POST', `/projects/${projectId}/materials`, { item, qty, urgency: 'normal' });
  await render();
}
async function decideCO(id, decision) { await api('PATCH', `/change-orders/${id}/decision`, { decision }); await render(); }
async function proposeSelection() {
  const name = prompt('Selecção (ex: Bancada da cozinha):'); if (!name) return;
  const room = prompt('Divisão (ex: Cozinha):', '') || null;
  const options = (prompt('Opções separadas por vírgula:', '') || '')
    .split(',').map((o) => o.trim()).filter(Boolean);
  const price = Number(prompt('Impacto no custo (€):', '0')) || 0;
  await api('POST', `/projects/${projectId}/selections`, { name, room, options, price });
  await render();
}
async function approveSelection(id, options) {
  let chosenOption = null;
  if (options && options.length) {
    chosenOption = prompt(`Escolha uma opção:\n${options.map((o, i) => `${i + 1}. ${o}`).join('\n')}`, options[0]);
    if (chosenOption === null) return;
    // accept either the number or the text
    const n = Number(chosenOption);
    if (n >= 1 && n <= options.length) chosenOption = options[n - 1];
  }
  const signedName = prompt('Assine com o seu nome para aprovar:', me.name);
  if (!signedName || !signedName.trim()) return;
  const { status, data } = await api('PATCH', `/selections/${id}/decision`,
    { decision: 'approved', chosenOption, signedName });
  if (status !== 200) alert(data?.error || 'Erro ao aprovar.');
  await render();
}
async function declineSelection(id) {
  if (!confirm('Recusar esta selecção?')) return;
  await api('PATCH', `/selections/${id}/decision`, { decision: 'declined' });
  await render();
}
async function proposeChange() {
  const title = prompt('Título da alteração:'); if (!title) return;
  const desc = prompt('Descrição:', '') || '';
  const costDelta = Number(prompt('Custo adicional (€):', '0')) || 0;
  const daysDelta = Number(prompt('Dias adicionais:', '0')) || 0;
  await api('POST', `/projects/${projectId}/change-orders`, { title, description: desc, costDelta, daysDelta });
  await render();
}
// ── Notifications ──────────────────────────────────────────────────────────
async function loadNotifBadge() {
  const { data, status } = await api('GET', '/notifications/unread/count');
  const badge = $('notifBadge');
  if (status === 200 && data && data.count > 0) {
    badge.textContent = data.count > 99 ? '99+' : data.count;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

async function toggleNotifications() {
  const dd = $('notifDropdown');
  if (dd.style.display === 'none') {
    dd.style.display = 'block';
    await loadNotifList();
  } else {
    dd.style.display = 'none';
  }
}

async function loadNotifList() {
  const { data: notifs, status } = await api('GET', '/notifications?limit=20');
  const list = $('notifList');
  if (status !== 200 || !notifs || !notifs.length) {
    list.innerHTML = '<div class="notif-empty">Sem notificações.</div>';
    return;
  }
  let html = '';
  for (const n of notifs) {
    const isUnread = n.status === 'pending' || n.status === 'sent';
    const ago = timeAgo(n.created_at);
    html += `<div class="notif-item ${isUnread ? 'unread' : ''}" onclick="markNotifRead(${n.id})">
      <div class="notif-title">${esc(n.title)}</div>
      ${n.body ? `<div class="notif-body">${esc(n.body)}</div>` : ''}
      <div class="notif-time">${ago}</div>
    </div>`;
  }
  list.innerHTML = html;
}

async function markNotifRead(id) {
  await api('PATCH', `/notifications/${id}/read`);
  await loadNotifList();
  await loadNotifBadge();
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  const wrapper = $('notifWrapper');
  if (wrapper && !wrapper.contains(e.target)) {
    $('notifDropdown').style.display = 'none';
  }
});

window.advance = advance; window.decide = decide;
window.postLog = postLog; window.requestMaterial = requestMaterial;
window.decideCO = decideCO; window.proposeChange = proposeChange;
window.proposeSelection = proposeSelection; window.approveSelection = approveSelection;
window.declineSelection = declineSelection;
window.toggleNotifications = toggleNotifications; window.markNotifRead = markNotifRead;

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ── Boot ─────────────────────────────────────────────────────────────────────
(async function init() {
  await api('POST', '/demo/seed');
  document.querySelectorAll('.role-btn').forEach((b) =>
    b.addEventListener('click', () => setRole(b.dataset.role)));
  await setRole('founder');
})();
