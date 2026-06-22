// Admin page logic. Uses the demo founder token (DEMO_MODE) to authenticate.
// Manages users via /admin/users and the project via PATCH /projects/:id.

let token = null;
const $ = (id) => document.getElementById(id);
const ROLES = ['worker', 'customer', 'founder', 'admin'];

async function api(method, path, body) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers['x-internal-token'] = token;
  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data };
}

function flash(el, ok, text) {
  el.textContent = text;
  el.className = 'msg ' + (ok ? 'ok' : 'err');
  setTimeout(() => { el.textContent = ''; }, 3000);
}

// ── Users ────────────────────────────────────────────────────────────────────
async function loadUsers() {
  const { data } = await api('GET', '/admin/users');
  const body = $('usersBody');
  body.innerHTML = '';
  (data || []).forEach((u) => {
    const tr = document.createElement('tr');
    const roleOpts = ROLES.map((r) => `<option value="${r}"${r === u.role ? ' selected' : ''}>${r}</option>`).join('');
    tr.innerHTML =
      `<td><input value="${u.name ?? ''}" id="n_${u.phone}" /></td>` +
      `<td><select id="r_${u.phone}">${roleOpts}</select></td>` +
      `<td><input class="mono" value="${u.phone}" id="p_${u.phone}" /></td>` +
      `<td><button class="btn ghost" data-phone="${u.phone}">Guardar</button> <span class="msg" id="m_${u.phone}"></span></td>`;
    tr.querySelector('button').addEventListener('click', () => saveUser(u.phone));
    body.appendChild(tr);
  });
}

async function saveUser(phone) {
  const name = $(`n_${phone}`).value;
  const role = $(`r_${phone}`).value;
  const newPhone = $(`p_${phone}`).value.trim();
  const body = { name, role };
  if (newPhone && newPhone !== phone) body.newPhone = newPhone;
  const { status, data } = await api('PATCH', `/admin/users/${phone}`, body);
  flash($(`m_${phone}`), status === 200, status === 200 ? 'OK' : (data?.error || 'erro'));
  // A phone change re-keys the row; reload so subsequent edits target the new number.
  if (status === 200 && body.newPhone) await loadUsers();
}

async function addUser() {
  const phone = $('newPhone').value.trim();
  const name = $('newName').value.trim();
  const role = $('newRole').value;
  if (!phone) return flash($('addMsg'), false, 'telefone obrigatório');
  const { status, data } = await api('POST', '/admin/users', { phone, name, role });
  if (status === 201) {
    $('newPhone').value = ''; $('newName').value = '';
    flash($('addMsg'), true, 'adicionado');
    await loadUsers();
  } else {
    flash($('addMsg'), false, data?.error || 'erro');
  }
}

// ── Project ──────────────────────────────────────────────────────────────────
let projectId = null;
async function loadProject() {
  const { data } = await api('GET', '/projects');
  const project = (data || [])[0];
  if (!project) { $('projectForm').style.display = 'none'; $('noProject').style.display = 'block'; return; }
  projectId = project.id;
  $('pName').value = project.name ?? '';
  $('pAddress').value = project.address ?? '';
  $('pBudget').value = project.budget ?? 0;
}

async function saveProject() {
  if (!projectId) return;
  const body = { name: $('pName').value, address: $('pAddress').value, budget: Number($('pBudget').value) };
  const { status, data } = await api('PATCH', `/projects/${projectId}`, body);
  flash($('projMsg'), status === 200, status === 200 ? 'Guardado' : (data?.error || 'erro'));
}

window.addUser = addUser;
window.saveProject = saveProject;

// ── Boot: get the founder demo token, then load ──────────────────────────────
(async function init() {
  const { data, status } = await api('POST', '/demo/token', { role: 'founder' });
  if (status !== 200 || !data?.token) {
    document.querySelector('.admin-wrap').innerHTML =
      '<div class="admin-card"><h2>Admin indisponível</h2><p>Esta página de administração usa o login de demonstração (DEMO_MODE). ' +
      'Active DEMO_MODE ou ligue a autenticação real para gerir utilizadores.</p></div>';
    return;
  }
  token = data.token;
  await loadUsers();
  await loadProject();
})();
