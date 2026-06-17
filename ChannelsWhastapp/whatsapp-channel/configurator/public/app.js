let config = {};
let menuItems = [];
let selectedContact = null;

// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    const tabId = btn.dataset.tab;
    document.getElementById(tabId).classList.add('active');
  });
});

// Load initial data
async function loadData() {
  try {
    const [configRes, menuRes] = await Promise.all([
      fetch('/api/config'),
      fetch('/api/menu-items')
    ]);
    config = await configRes.json();
    menuItems = await menuRes.json();

    render();
  } catch (e) {
    showStatus('Error loading data: ' + e.message, 'error');
  }
}

function render() {
  renderPhoneList();
  renderPermissions();
  renderContactsList();
  renderMenuUI();
}

// ─── Whitelist Management ───
function renderPhoneList() {
  const list = document.getElementById('phoneList');
  list.innerHTML = config.allow.map(phone => `
    <div class="phone-item">
      <div class="phone-item-info">
        <div class="phone-item-number">+${phone}</div>
        <span class="phone-item-badge">${config.contacts[phone]?.name || 'No name'}</span>
      </div>
      <button class="btn btn-remove" onclick="removePhone('${phone}')">Remove</button>
    </div>
  `).join('');
}

function addPhone() {
  const input = document.getElementById('newPhone');
  const phone = input.value.trim();
  if (!phone) {
    showStatus('Please enter a phone number', 'error');
    return;
  }
  if (config.allow.includes(phone)) {
    showStatus('Phone already in whitelist', 'error');
    return;
  }
  config.allow.push(phone);
  if (!config.contacts[phone]) {
    config.contacts[phone] = { phone, name: '', permission: 'user' };
  }
  input.value = '';
  renderPhoneList();
  renderContactsList();
  renderMenuUI();
}

function removePhone(phone) {
  config.allow = config.allow.filter(p => p !== phone);
  delete config.contacts[phone];
  renderPhoneList();
  renderContactsList();
  renderMenuUI();
}

// ─── Permissions Management ───
async function renderPermissions() {
  const grid = document.getElementById('permissionsGrid');
  grid.innerHTML = Object.entries(config.permissions).map(([level, perm]) => `
    <div class="permission-card">
      <div class="permission-level-name">${level.toUpperCase()}</div>
      <div class="permission-field">
        <input type="checkbox" id="cmd_${level}" ${perm.canRunCommands ? 'checked' : ''}
               onchange="config.permissions['${level}'].canRunCommands = this.checked">
        <label for="cmd_${level}">Run Terminal Commands</label>
      </div>
      <div class="permission-field">
        <input type="checkbox" id="conn_${level}" ${perm.canUseConnectors ? 'checked' : ''}
               onchange="config.permissions['${level}'].canUseConnectors = this.checked">
        <label for="conn_${level}">Use Connectors (Cal, Mail, CU)</label>
      </div>
      <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #ddd;">
        <label style="font-weight: 500; font-size: 12px; color: #666;">Menu Access:</label>
        ${menuItems.map(item => `
          <div class="permission-field">
            <input type="checkbox" id="menu_${level}_${item.id}"
                   ${perm.canViewMenu.includes(item.id) ? 'checked' : ''}
                   onchange="toggleMenuAccess('${level}', '${item.id}')">
            <label for="menu_${level}_${item.id}" style="font-size: 12px;">${item.label}</label>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function toggleMenuAccess(level, menuId) {
  const perm = config.permissions[level];
  if (perm.canViewMenu.includes(menuId)) {
    perm.canViewMenu = perm.canViewMenu.filter(m => m !== menuId);
  } else {
    perm.canViewMenu.push(menuId);
  }
}

// ─── Contacts Management ───
function renderContactsList() {
  const list = document.getElementById('contactsList');
  const select = document.getElementById('contactPhone');

  // Update phone select
  select.innerHTML = '<option value="">Select phone from whitelist...</option>' +
    config.allow.map(phone => `<option value="${phone}">${phone}</option>`).join('');

  // Render contacts
  list.innerHTML = Object.entries(config.contacts).map(([phone, contact]) => {
    const perm = config.permissions[contact.permission];
    return `
      <div class="contact-item">
        <div class="contact-item-info">
          <div class="contact-item-name">${contact.name || '(no name)'}</div>
          <div class="contact-item-meta">
            ${phone} • ${contact.permission}
            ${contact.customMenu ? '• custom menu' : ''}
          </div>
        </div>
        <button class="btn btn-remove" onclick="editContact('${phone}')">Edit</button>
      </div>
    `;
  }).join('');
}

function addContact() {
  const name = document.getElementById('contactName').value.trim();
  const phone = document.getElementById('contactPhone').value;
  const permission = document.getElementById('contactPermission').value;

  if (!name) {
    showStatus('Please enter a name', 'error');
    return;
  }
  if (!phone) {
    showStatus('Please select a phone', 'error');
    return;
  }

  config.contacts[phone] = { name, phone, permission, customMenu: null };
  document.getElementById('contactName').value = '';
  document.getElementById('contactPhone').value = '';
  renderContactsList();
  renderMenuUI();
}

function editContact(phone) {
  const contact = config.contacts[phone];
  document.getElementById('contactName').value = contact.name;
  document.getElementById('contactPhone').value = phone;
  document.getElementById('contactPermission').value = contact.permission;
  showStatus(`Editing ${contact.name}. Change fields and click "+ Add Contact" to update.`, '');
}

// ─── Custom Menus ───
function renderMenuUI() {
  const select = document.getElementById('menuContact');
  select.innerHTML = '<option value="">Select contact...</option>' +
    Object.entries(config.contacts).map(([phone, contact]) =>
      `<option value="${phone}">${contact.name || phone}</option>`
    ).join('');
}

document.getElementById('menuContact')?.addEventListener('change', (e) => {
  selectedContact = e.target.value;
  renderMenuCheckboxes();
});

function renderMenuCheckboxes() {
  const container = document.getElementById('menuCheckboxes');
  if (!selectedContact) {
    container.innerHTML = '';
    return;
  }

  const contact = config.contacts[selectedContact];
  const customMenu = contact.customMenu || config.permissions[contact.permission].canViewMenu;

  container.innerHTML = menuItems.map(item => `
    <div class="menu-checkbox">
      <input type="checkbox" id="menu_${item.id}"
             ${customMenu.includes(item.id) ? 'checked' : ''}>
      <label for="menu_${item.id}">${item.label}</label>
    </div>
  `).join('');
}

function saveContactMenu() {
  if (!selectedContact) {
    showStatus('Please select a contact', 'error');
    return;
  }

  const checked = Array.from(document.querySelectorAll('#menuCheckboxes input:checked'))
    .map(cb => cb.id.replace('menu_', ''));

  config.contacts[selectedContact].customMenu = checked.length > 0 ? checked : null;
  showStatus(`Menu saved for ${config.contacts[selectedContact].name}`, 'success');
  setTimeout(() => showStatus('', ''), 2000);
}

// ─── Save All ───
async function saveAll() {
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        allow: config.allow,
        permissions: config.permissions,
        contacts: config.contacts
      })
    });

    const result = await res.json();
    if (result.success) {
      showStatus('✓ Config saved! Watcher will reload on next tick.', 'success');
      setTimeout(() => showStatus('', ''), 3000);
    } else {
      showStatus('✗ ' + result.message, 'error');
    }
  } catch (e) {
    showStatus('Error saving: ' + e.message, 'error');
  }
}

function showStatus(msg, type) {
  const status = document.getElementById('status');
  status.textContent = msg;
  status.className = 'status ' + (msg ? type : 'hidden');
}

// Initialize
loadData();
