// Admin console logic. Uses the demo founder token (DEMO_MODE) to authenticate.
// Manages users via /admin/users and the project via PATCH /projects/:id.

let token = null;
let usersCache = [];
let editingPhone = null;
const $ = (id) => document.getElementById(id);
const ROLES = ['worker', 'customer', 'founder', 'admin'];

async function api(method, path, body) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers['x-internal-token'] = token;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data };
}

// ── Toasts ───────────────────────────────────────────────────────────────────
function toast(text, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `<span class="ti">${kind === 'ok' ? '✓' : kind === 'err' ? '✕' : 'ℹ'}</span><span>${esc(text)}</span>`;
  $('toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, 2600);
}

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ── Avatars ──────────────────────────────────────────────────────────────────
const AVATAR_COLORS = ['#A67C45', '#5E7355', '#8A6634', '#9C5742', '#6A5295', '#3F6088', '#7A5C8E'];
function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}
function avatarColor(seed) {
  let h = 0;
  for (const c of String(seed || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

// ── Users ────────────────────────────────────────────────────────────────────
async function loadUsers() {
  const { data } = await api('GET', '/admin/users');
  usersCache = data || [];
  renderUsers();
  renderStats();
}

function renderStats() {
  const counts = { total: usersCache.length };
  for (const r of ROLES) counts[r] = usersCache.filter((u) => u.role === r).length;
  $('stats').innerHTML = `
    <div class="stat"><div class="n">${counts.total}</div><div class="l">Membros</div></div>
    <div class="stat"><div class="n">${counts.founder + counts.admin}</div><div class="l">Gestão</div></div>
    <div class="stat"><div class="n">${counts.worker}</div><div class="l">Obra</div></div>
    <div class="stat"><div class="n">${counts.customer}</div><div class="l">Clientes</div></div>`;
}

function renderUsers() {
  const q = ($('search').value || '').toLowerCase().trim();
  const rows = usersCache.filter((u) =>
    !q || (u.name || '').toLowerCase().includes(q) || (u.phone || '').includes(q));
  const body = $('usersBody');
  body.innerHTML = '';
  $('usersEmpty').style.display = rows.length ? 'none' : 'block';

  rows.forEach((u) => {
    const tr = document.createElement('tr');
    if (editingPhone === u.phone) {
      tr.innerHTML = editRow(u);
    } else {
      tr.innerHTML = readRow(u);
    }
    body.appendChild(tr);
  });

  // Wire buttons
  body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => { editingPhone = b.dataset.edit; renderUsers(); }));
  body.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => { editingPhone = null; renderUsers(); }));
  body.querySelectorAll('[data-save]').forEach((b) => b.addEventListener('click', () => saveUser(b.dataset.save)));
}

function readRow(u) {
  const color = avatarColor(u.phone || u.name);
  return `
    <td>
      <div class="member">
        <div class="avatar" style="background:${color}">${esc(initials(u.name))}</div>
        <div class="who"><b>${esc(u.name || '—')}</b><span>${esc(u.phone)}</span></div>
      </div>
    </td>
    <td><span class="badge ${esc(u.role)}">${esc(u.role)}</span></td>
    <td><div class="row-actions"><button class="icon-btn" data-edit="${esc(u.phone)}" title="Editar">✎</button></div></td>`;
}

function editRow(u) {
  const color = avatarColor(u.phone || u.name);
  const roleOpts = ROLES.map((r) => `<option value="${r}"${r === u.role ? ' selected' : ''}>${r}</option>`).join('');
  return `
    <td>
      <div class="member">
        <div class="avatar" style="background:${color}">${esc(initials(u.name))}</div>
        <div style="display:flex;flex-direction:column;gap:7px;flex:1">
          <input class="edit-input" id="n_${esc(u.phone)}" value="${esc(u.name || '')}" placeholder="Nome" />
          <input class="edit-input" id="p_${esc(u.phone)}" value="${esc(u.phone)}" placeholder="Telefone" style="font-family:ui-monospace,Menlo,monospace;font-size:12.5px" />
        </div>
      </div>
    </td>
    <td><select class="edit-input" id="r_${esc(u.phone)}">${roleOpts}</select></td>
    <td><div class="row-actions">
      <button class="btn primary sm" data-save="${esc(u.phone)}">Guardar</button>
      <button class="icon-btn" data-cancel="1" title="Cancelar">✕</button>
    </div></td>`;
}

async function saveUser(phone) {
  const name = $(`n_${phone}`).value.trim();
  const role = $(`r_${phone}`).value;
  const newPhone = $(`p_${phone}`).value.trim();
  const body = { name, role };
  if (newPhone && newPhone !== phone) body.newPhone = newPhone;
  const { status, data } = await api('PATCH', `/admin/users/${phone}`, body);
  if (status === 200) {
    editingPhone = null;
    toast('Membro atualizado');
    await loadUsers();
  } else {
    toast(data?.error || 'Erro ao guardar', 'err');
  }
}

// ── Add member modal ─────────────────────────────────────────────────────────
function openAdd() { $('addModal').classList.add('open'); $('newName').focus(); }
function closeAdd() { $('addModal').classList.remove('open'); $('newName').value = ''; $('newPhone').value = ''; }

async function addUser() {
  const phone = $('newPhone').value.trim();
  const name = $('newName').value.trim();
  const role = $('newRole').value;
  if (!phone) return toast('Telefone obrigatório', 'err');
  const { status, data } = await api('POST', '/admin/users', { phone, name, role });
  if (status === 201) {
    closeAdd();
    toast(`${name || phone} adicionado`);
    await loadUsers();
  } else {
    toast(data?.error || 'Erro ao adicionar', 'err');
  }
}

// ── Project ──────────────────────────────────────────────────────────────────
let projectId = null;
async function loadProject() {
  const { data } = await api('GET', '/projects');
  const project = (data || [])[0];
  if (!project) { $('projectForm').style.display = 'none'; $('noProject').style.display = 'block'; return; }
  projectId = project.id;
  $('projTitle').textContent = project.name || 'Detalhes';
  $('pName').value = project.name ?? '';
  $('pAddress').value = project.address ?? '';
  $('pBudget').value = project.budget ?? 0;
}

async function saveProject() {
  if (!projectId) return;
  const body = { name: $('pName').value, address: $('pAddress').value, budget: Number($('pBudget').value) };
  const { status, data } = await api('PATCH', `/projects/${projectId}`, body);
  if (status === 200) { toast('Projeto guardado'); $('projTitle').textContent = body.name; }
  else toast(data?.error || 'Erro ao guardar', 'err');
}

// ── Nav ──────────────────────────────────────────────────────────────────────
function switchView(view) {
  document.querySelectorAll('.side-nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
}

// ── Boot ──────────────────────────────────────────────────────────────────────
(async function init() {
  document.querySelectorAll('.side-nav button').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));
  $('search').addEventListener('input', renderUsers);
  $('addBtn').addEventListener('click', openAdd);
  $('cancelAdd').addEventListener('click', closeAdd);
  $('confirmAdd').addEventListener('click', addUser);
  $('saveProjectBtn').addEventListener('click', saveProject);
  $('addModal').addEventListener('click', (e) => { if (e.target === $('addModal')) closeAdd(); });
  $('newPhone').addEventListener('keydown', (e) => { if (e.key === 'Enter') addUser(); });

  await api('POST', '/demo/seed');
  const { data, status } = await api('POST', '/demo/token', { role: 'founder' });
  if (status !== 200 || !data?.token) {
    document.querySelector('.admin-main').innerHTML =
      '<div class="panel" style="padding:32px"><h2>Admin indisponível</h2>' +
      '<p style="color:var(--muted);margin-top:8px">Esta consola usa o login de demonstração (DEMO_MODE). ' +
      'Active DEMO_MODE ou ligue a autenticação real para gerir utilizadores.</p></div>';
    return;
  }
  token = data.token;
  await loadUsers();
  await loadProject();
})();
