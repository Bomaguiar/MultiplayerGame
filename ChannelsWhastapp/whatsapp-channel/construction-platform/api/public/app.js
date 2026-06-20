// Demo dashboard. Talks to the REAL API. Switches identity via /demo/token and
// renders the customer / worker / founder view of the seeded project.

let token = null;
let me = null;          // { role, phone, name }
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

  await Promise.all([loadMilestones(), loadLogs(), loadTasks(), loadMaterials()]);
}

function clearCards() {
  ['milestones', 'logs', 'tasks', 'materials'].forEach((id) => ($(id).innerHTML = ''));
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
  let html = '<h2>✅ Tarefas</h2>';
  for (const t of tasks || []) {
    const canAdvance = me.role === 'worker' && t.assignee_phone === me.phone && NEXT[t.status];
    html += `<div class="row task">
      <span class="status s-${t.status}">${t.status}</span>
      <span class="grow">${esc(t.title)}</span>
      <span class="prio p-${t.priority}">${t.priority}</span>
      ${canAdvance ? `<button class="act sm" onclick="advance(${t.id},'${NEXT[t.status]}')">→ ${NEXT[t.status]}</button>` : ''}
    </div>`;
  }
  $('tasks').innerHTML = html;
}

async function loadMaterials() {
  const { data: mats } = await api('GET', `/projects/${projectId}/materials`);
  let html = '<h2>🧱 Materiais</h2>';
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

// ── Actions (real API calls, role-gated server-side) ─────────────────────────
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
window.advance = advance; window.decide = decide;
window.postLog = postLog; window.requestMaterial = requestMaterial;

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ── Boot ─────────────────────────────────────────────────────────────────────
(async function init() {
  await api('POST', '/demo/seed');                 // idempotent
  document.querySelectorAll('.role-btn').forEach((b) =>
    b.addEventListener('click', () => setRole(b.dataset.role)));
  await setRole('founder');
})();
