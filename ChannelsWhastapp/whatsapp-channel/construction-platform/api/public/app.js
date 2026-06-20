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
    <h1>${esc(p.name)}</h1>
    <div class="meta">📍 ${esc(p.address || '—')} · estado <b>${esc(p.status)}</b> · orçamento €${Number(p.budget).toLocaleString('pt-PT')}</div>`;

  await Promise.all([loadBudget(), loadMilestones(), loadLogs(), loadTasks(), loadMaterials(), loadChangeOrders()]);
}

function clearCards() {
  ['budget', 'milestones', 'logs', 'tasks', 'materials', 'changeOrders'].forEach((id) => ($(id).innerHTML = ''));
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
async function proposeChange() {
  const title = prompt('Título da alteração:'); if (!title) return;
  const desc = prompt('Descrição:', '') || '';
  const costDelta = Number(prompt('Custo adicional (€):', '0')) || 0;
  const daysDelta = Number(prompt('Dias adicionais:', '0')) || 0;
  await api('POST', `/projects/${projectId}/change-orders`, { title, description: desc, costDelta, daysDelta });
  await render();
}
window.advance = advance; window.decide = decide;
window.postLog = postLog; window.requestMaterial = requestMaterial;
window.decideCO = decideCO; window.proposeChange = proposeChange;

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ── Boot ─────────────────────────────────────────────────────────────────────
(async function init() {
  await api('POST', '/demo/seed');
  document.querySelectorAll('.role-btn').forEach((b) =>
    b.addEventListener('click', () => setRole(b.dataset.role)));
  await setRole('founder');
})();
