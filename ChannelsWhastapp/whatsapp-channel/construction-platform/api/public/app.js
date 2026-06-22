let token = null;
let me = null;
let projectId = null;
let clientPhone = null;
let logsCache = [];
let galleryState = [];

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
  clientPhone = p.client_phone || null;

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

  await loadLogsData();
  await Promise.all([loadBudget(), loadMilestones(), loadSelections(), loadGallery(), loadLogs(), loadTasks(), loadMaterials(), loadChangeOrders(), loadNotifBadge()]);
}

function clearCards() {
  ['budget', 'milestones', 'selections', 'gallery', 'logs', 'tasks', 'materials', 'changeOrders'].forEach((id) => ($(id).innerHTML = ''));
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

// ── Photos: resolve a stored ref to a displayable src ────────────────────────
// Real integrations store http(s) media URLs; the demo stores WhatsApp-style
// keys, which we map to bundled artwork. Anything unknown gets a captioned
// placeholder so the gallery still renders.
const MEDIA_MAP = {
  'wa-media/fence-1.jpg': 'media/site-exterior.svg',
  'wa-media/gate-1.jpg': 'media/site-gate.svg',
  'wa-media/outlets-1.jpg': 'media/site-interior.svg',
  'wa-media/kitchen-1.jpg': 'media/site-kitchen.svg',
};
function resolveMedia(ref) {
  if (/^https?:\/\//i.test(ref)) return ref;
  if (MEDIA_MAP[ref]) return MEDIA_MAP[ref];
  const label = String(ref).split('/').pop().replace(/\.[a-z0-9]+$/i, '').replace(/[-_]/g, ' ');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
    <rect width="400" height="300" fill="#E4DCCD"/>
    <circle cx="200" cy="120" r="34" fill="none" stroke="#A67C45" stroke-width="6"/>
    <circle cx="200" cy="120" r="14" fill="#A67C45"/>
    <rect x="150" y="92" width="30" height="14" rx="3" fill="#A67C45"/>
    <text x="200" y="205" font-family="sans-serif" font-size="18" fill="#8A8174" text-anchor="middle">${esc(label)}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// Flatten every photo across the project's logs into one ordered gallery.
function galleryPhotos() {
  const photos = [];
  for (const l of logsCache) {
    for (const ref of l.photo_refs || []) {
      photos.push({ src: resolveMedia(ref), note: l.note || '', date: l.logged_at });
    }
  }
  return photos;
}

async function loadLogsData() {
  const { data: logs } = await api('GET', `/projects/${projectId}/logs`);
  logsCache = logs || [];
}

async function loadGallery() {
  const photos = galleryPhotos();
  galleryState = photos;
  let html = `<h2>📸 Galeria <span class="dim">(${photos.length})</span></h2>`;
  if (!photos.length) {
    $('gallery').innerHTML = html + '<div class="dim">Sem fotografias ainda.</div>';
    return;
  }
  html += '<div class="gallery-grid">';
  photos.forEach((p, i) => {
    html += `<div class="gallery-thumb" onclick="openLightbox(${i})">
      <img src="${esc(p.src)}" alt="${esc(p.note)}" loading="lazy" />
      <span class="cap">${esc(fmtDate(p.date))}</span>
    </div>`;
  });
  html += '</div>';
  $('gallery').innerHTML = html;
}

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' });
}

async function loadLogs() {
  let html = '<h2>📔 Diário de Obra</h2>';
  if (me.role === 'worker') {
    html += `<button class="act" onclick="postLog()">+ Novo registo</button>`;
  }
  if (me.role === 'founder') {
    html += `<button class="act" onclick="generateDailySummary()">✨ Gerar resumo para cliente</button>
      <div id="dailySummaryBox"></div>`;
  }
  let offset = 0; // map each log's photos to their index in the flat gallery
  for (const l of logsCache) {
    const refs = l.photo_refs || [];
    let thumbs = '';
    if (refs.length) {
      thumbs = '<div class="log-thumbs">';
      refs.forEach((ref, k) => {
        const gi = offset + k;
        thumbs += `<div class="gallery-thumb" onclick="openLightbox(${gi})">
          <img src="${esc(resolveMedia(ref))}" alt="" loading="lazy" /></div>`;
      });
      thumbs += '</div>';
    }
    offset += refs.length;
    html += `<div class="row log"><div>${esc(l.note)}</div>
      <div class="dim">${esc(l.weather || '')} · ${l.crew_count} pers · ${l.hours}h</div>${thumbs}</div>`;
  }
  if (!logsCache.length) html += '<div class="dim">Sem registos.</div>';
  $('logs').innerHTML = html;
}

// ── Lightbox ─────────────────────────────────────────────────────────────────
let lbIndex = 0;
function openLightbox(i) {
  if (!galleryState.length) return;
  lbIndex = i;
  renderLightbox();
  $('lightbox').classList.add('open');
}
function closeLightbox() { $('lightbox').classList.remove('open'); }
function lbNav(d) {
  lbIndex = (lbIndex + d + galleryState.length) % galleryState.length;
  renderLightbox();
}
function renderLightbox() {
  const p = galleryState[lbIndex];
  if (!p) return;
  $('lbImg').src = p.src;
  $('lbNote').textContent = p.note;
  $('lbDate').textContent = p.date ? new Date(p.date).toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  $('lbCount').textContent = `${lbIndex + 1} / ${galleryState.length}`;
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
  const [{ data, status }, { data: bd }] = await Promise.all([
    api('GET', `/projects/${projectId}/budget`),
    api('GET', `/projects/${projectId}/budget-breakdown`),
  ]);
  if (status !== 200 || !data) { $('budget').innerHTML = ''; return; }
  const fmt = (v) => `€${Number(v || 0).toLocaleString('pt-PT')}`;
  const t = bd?.totals || {};
  const spent = Number(t.total_actual || 0);
  const estimated = Number(t.total_estimated || 0);
  const budgetNum = Number(data.current_budget || 0);
  const remaining = budgetNum - spent;
  const pctUsed = budgetNum > 0 ? Math.min(100, Math.round((spent / budgetNum) * 100)) : 0;
  const barColor = pctUsed > 90 ? 'var(--rust)' : pctUsed > 70 ? 'var(--gold)' : 'var(--green)';

  let html = `<h2>💰 Orçamento</h2>
    <div class="budget-grid">
      <div class="budget-item"><span class="budget-val">${fmt(data.current_budget)}</span><span class="dim">Orçamento total</span></div>
      <div class="budget-item"><span class="budget-val">${fmt(spent)}</span><span class="dim">Gasto até agora</span></div>
      <div class="budget-item"><span class="budget-val ${remaining < 0 ? 'over' : ''}">${fmt(remaining)}</span><span class="dim">Restante</span></div>
      <div class="budget-item"><span class="budget-val pending">${fmt(data.pending_changes)}</span><span class="dim">${data.pending_count} alteração(ões)</span></div>
    </div>
    <div class="budget-bar-wrap">
      <div class="budget-bar-outer"><div class="budget-bar-inner" style="width:${pctUsed}%;background:${barColor}"></div></div>
      <span class="budget-bar-label">${pctUsed}% utilizado</span>
    </div>`;

  if (bd?.categories?.length) {
    html += '<div class="budget-cats">';
    for (const c of bd.categories) {
      const catEst = Number(c.estimated || 0);
      const catAct = Number(c.actual || 0);
      const catPct = catEst > 0 ? Math.min(100, Math.round((catAct / catEst) * 100)) : 0;
      const catBarColor = catAct > catEst ? 'var(--rust)' : catPct > 70 ? 'var(--gold)' : 'var(--green)';
      const overClass = catAct > catEst ? ' over' : '';
      html += `<div class="budget-cat-row">
        <span class="budget-cat-name">${esc(c.category)}</span>
        <span class="budget-cat-nums">${fmt(catAct)} <span class="dim">/ ${fmt(catEst)}</span></span>
        <div class="budget-cat-bar"><div style="width:${catPct}%;background:${catBarColor}"></div></div>
        <span class="budget-cat-pct${overClass}">${catPct}%</span>
      </div>`;
    }
    html += '</div>';
  }

  if (me.role === 'founder') {
    html += `<button class="act" onclick="toggleBudgetItems()" id="budgetItemsToggle">▸ Ver itens detalhados</button>`;
    html += `<div id="budgetItemsDetail" style="display:none"></div>`;
  }

  $('budget').innerHTML = html;
}

async function toggleBudgetItems() {
  const el = $('budgetItemsDetail');
  const btn = $('budgetItemsToggle');
  if (el.style.display === 'none') {
    el.style.display = 'block';
    btn.textContent = '▾ Esconder itens';
    await loadBudgetItems();
  } else {
    el.style.display = 'none';
    btn.textContent = '▸ Ver itens detalhados';
  }
}

async function loadBudgetItems() {
  const { data: items } = await api('GET', `/projects/${projectId}/budget-items`);
  const el = $('budgetItemsDetail');
  if (!items || !items.length) { el.innerHTML = '<div class="dim">Sem itens.</div>'; return; }
  const fmt = (v) => v != null ? `€${Number(v).toLocaleString('pt-PT')}` : '—';
  let html = `<button class="act" onclick="addBudgetItem()">+ Novo item</button>`;
  html += '<table class="budget-table"><thead><tr><th>Categoria</th><th>Descrição</th><th>Estimado</th><th>Real</th><th>Estado</th><th></th></tr></thead><tbody>';
  for (const it of items) {
    const over = it.actual != null && Number(it.actual) > Number(it.estimated);
    const statusClass = it.status === 'completed' ? 'done' : it.status === 'over_budget' ? 'denied' : it.status === 'in_progress' ? 'doing' : 'todo';
    html += `<tr>
      <td><span class="tag">${esc(it.category)}</span></td>
      <td>${esc(it.description)}${it.vendor ? ` <span class="dim">${esc(it.vendor)}</span>` : ''}</td>
      <td>${fmt(it.estimated)}</td>
      <td class="${over ? 'over-val' : ''}">${fmt(it.actual)}</td>
      <td><span class="status s-${statusClass}">${esc(it.status)}</span></td>
      <td><button class="act sm" onclick="editBudgetItem(${it.id})">✎</button></td>
    </tr>`;
  }
  html += '</tbody></table>';
  el.innerHTML = html;
}

async function addBudgetItem() {
  const category = prompt('Categoria (ex: Eléctrica, Interior):'); if (!category) return;
  const description = prompt('Descrição:'); if (!description) return;
  const estimated = Number(prompt('Valor estimado (€):', '0')) || 0;
  await api('POST', `/projects/${projectId}/budget-items`, { category, description, estimated });
  await loadBudgetItems();
  await loadBudget();
}

async function editBudgetItem(id) {
  const actualStr = prompt('Valor real gasto (€):');
  if (actualStr === null) return;
  const actual = Number(actualStr) || 0;
  const status = prompt('Estado (planned / in_progress / completed / over_budget):', 'completed');
  if (!status) return;
  await api('PATCH', `/budget-items/${id}`, { actual, status });
  await loadBudgetItems();
  await loadBudget();
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
  const photo = prompt('URL de uma foto (opcional):', '') || '';
  const photoRefs = photo.trim() ? [photo.trim()] : [];
  await api('POST', `/projects/${projectId}/logs`, { note, crewCount: 3, hours: 8, photoRefs });
  await render();
}
async function requestMaterial() {
  const item = prompt('Material:'); if (!item) return;
  const qty = Number(prompt('Quantidade:', '1')) || 1;
  await api('POST', `/projects/${projectId}/materials`, { item, qty, urgency: 'normal' });
  await render();
}
async function decideCO(id, decision) { await api('PATCH', `/change-orders/${id}/decision`, { decision }); await render(); }
async function generateDailySummary() {
  const box = $('dailySummaryBox');
  box.innerHTML = '<div class="dim">A gerar resumo…</div>';
  const { status, data } = await api('GET', `/projects/${projectId}/daily-summary`);
  if (status !== 200 || !data) { box.innerHTML = '<div class="dim">Não foi possível gerar.</div>'; return; }
  const wa = `https://wa.me/${(clientPhone || '').replace(/\D/g, '')}?text=${encodeURIComponent(data.summary)}`;
  box.innerHTML = `<div class="summary-box">
    <div class="summary-date">${esc(data.date)}</div>
    <div class="summary-text" id="summaryText">${esc(data.summary)}</div>
    <div class="summary-actions">
      <button class="act sm" onclick="copySummary()">📋 Copiar</button>
      ${clientPhone ? `<a class="act sm ok summary-wa" href="${esc(wa)}" target="_blank">📲 Enviar no WhatsApp</a>` : ''}
    </div>
  </div>`;
}
function copySummary() {
  const t = $('summaryText')?.textContent || '';
  navigator.clipboard?.writeText(t);
  const btn = event.target;
  const old = btn.textContent;
  btn.textContent = '✓ Copiado';
  setTimeout(() => { btn.textContent = old; }, 1500);
}
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
window.openLightbox = openLightbox; window.closeLightbox = closeLightbox; window.lbNav = lbNav;
window.toggleBudgetItems = toggleBudgetItems; window.addBudgetItem = addBudgetItem; window.editBudgetItem = editBudgetItem;
window.generateDailySummary = generateDailySummary; window.copySummary = copySummary;

// Keyboard navigation for the lightbox.
document.addEventListener('keydown', (e) => {
  if (!$('lightbox').classList.contains('open')) return;
  if (e.key === 'Escape') closeLightbox();
  else if (e.key === 'ArrowLeft') lbNav(-1);
  else if (e.key === 'ArrowRight') lbNav(1);
});
window.toggleNotifications = toggleNotifications; window.markNotifRead = markNotifRead;

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ── Boot ─────────────────────────────────────────────────────────────────────
(async function init() {
  await api('POST', '/demo/seed');
  document.querySelectorAll('.role-btn').forEach((b) =>
    b.addEventListener('click', () => setRole(b.dataset.role)));
  await setRole('founder');
})();
