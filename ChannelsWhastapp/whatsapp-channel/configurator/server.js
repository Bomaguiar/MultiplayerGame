import express from 'express';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import bodyParser from 'body-parser';

const app = express();
const PORT = 3000;

// Config file path
const configPath = join(homedir(), '.claude', 'whatsapp-assistant.json');

app.use(bodyParser.json());
app.use(express.static('public'));

// Default config template
const defaultConfig = {
  allow: [],
  permissions: {
    admin: {
      level: "admin",
      canRunCommands: true,
      canUseConnectors: true,
      canViewMenu: ["terminal", "clickup", "calendar", "email", "ai", "system"]
    },
    user: {
      level: "user",
      canRunCommands: false,
      canUseConnectors: true,
      canViewMenu: ["calendar", "email", "ai"]
    },
    guest: {
      level: "guest",
      canRunCommands: false,
      canUseConnectors: false,
      canViewMenu: ["ai"]
    }
  },
  contacts: {},
  activeChats: {},
  pendingConfirm: {},
  processedIds: [],
  primed: false
};

// Load config
function loadConfig() {
  try {
    if (existsSync(configPath)) {
      return JSON.parse(readFileSync(configPath, 'utf-8'));
    }
  } catch (e) {
    console.error('Error reading config:', e.message);
  }
  return defaultConfig;
}

// Save config
function saveConfig(config) {
  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('Error saving config:', e.message);
    return false;
  }
}

// GET config
app.get('/api/config', (req, res) => {
  const config = loadConfig();
  res.json(config);
});

// POST config update
app.post('/api/config', (req, res) => {
  const current = loadConfig();
  const { allow, permissions, contacts } = req.body;

  // Validate and merge
  if (Array.isArray(allow)) {
    current.allow = allow.filter(p => p.trim());
  }
  if (permissions && typeof permissions === 'object') {
    current.permissions = permissions;
  }
  if (contacts && typeof contacts === 'object') {
    current.contacts = contacts;
  }

  if (saveConfig(current)) {
    res.json({ success: true, message: 'Config saved. Watcher will reload on next tick.' });
  } else {
    res.status(500).json({ success: false, message: 'Failed to save config' });
  }
});

// GET permission levels (for UI)
app.get('/api/menu-items', (req, res) => {
  res.json([
    { id: 'terminal', label: '💻 Terminal', description: 'Run shell commands' },
    { id: 'clickup', label: '📋 ClickUp', description: 'Tasks & projects' },
    { id: 'calendar', label: '📅 Calendar', description: 'Events & scheduling' },
    { id: 'email', label: '📧 Email', description: 'Gmail & messaging' },
    { id: 'ai', label: '🧠 AI & Chat', description: 'Questions & conversation' },
    { id: 'system', label: '⚙️ System', description: 'Help & memory' }
  ]);
});

app.listen(PORT, () => {
  console.log(`Configurator running on http://localhost:${PORT}`);
  console.log(`Config file: ${configPath}`);
});
