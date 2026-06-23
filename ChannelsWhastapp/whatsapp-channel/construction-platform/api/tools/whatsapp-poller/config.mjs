// Centralized env parsing + validation for the WhatsApp poller.
//
// Everything the poller needs is read once here, with sane defaults, so the
// rest of the code can depend on a single validated config object.

import { fileURLToPath } from 'node:url';

function bool(v, dflt = false) {
  if (v === undefined || v === null || v === '') return dflt;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function num(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

// Allowlist: comma-separated bare numbers. We normalize to digits-only so that
// "+351 900 000 009" and "351900000009" compare equal.
function parseAllowlist(v) {
  if (!v) return [];
  return String(v)
    .split(',')
    .map((s) => s.replace(/\D/g, ''))
    .filter(Boolean);
}

export function normalizeNumber(n) {
  return String(n || '').replace(/\D/g, '');
}

export function loadConfig(argv = process.argv.slice(2)) {
  const dryRun = bool(process.env.DRY_RUN) || argv.includes('--dry-run');

  const cfg = {
    // Platform API
    apiUrl: (process.env.API_URL || 'http://localhost:4000').replace(/\/+$/, ''),
    watcherSecret: process.env.WATCHER_SECRET || 'dev-watcher-secret',

    // Loop
    intervalMs: num(process.env.POLL_INTERVAL_MS, 5000),
    outboxLimit: num(process.env.OUTBOX_LIMIT, 50),

    // Bridge selection + state
    bridge: process.env.BRIDGE || 'mock',
    // fileURLToPath (not .pathname) so Windows gets a real path, not "/C:/...".
    statePath: process.env.STATE_PATH
      || fileURLToPath(new URL('./.poller-state.json', import.meta.url)),

    // Safety
    allowed: parseAllowlist(process.env.ALLOWED_NUMBERS),
    dryRun,

    // Adapter-specific (read inside adapters, surfaced here for the banner)
    bridgeDbPath: process.env.BRIDGE_DB_PATH || 'E:\\whatsapp-mcp\\whatsapp-bridge\\store\\messages.db',
    bridgeApiUrl: (process.env.BRIDGE_API_URL || 'http://localhost:8080/api').replace(/\/+$/, ''),
    mockInbox: process.env.MOCK_INBOX || null,
  };

  // Validation
  const errors = [];
  if (!/^https?:\/\//.test(cfg.apiUrl)) errors.push(`API_URL is not a valid URL: ${cfg.apiUrl}`);
  if (!['mock', 'whatsappMcp'].includes(cfg.bridge)) {
    errors.push(`BRIDGE must be 'mock' or 'whatsappMcp', got: ${cfg.bridge}`);
  }
  if (errors.length) {
    const err = new Error('Invalid configuration:\n  - ' + errors.join('\n  - '));
    err.isConfigError = true;
    throw err;
  }

  return cfg;
}

export function isAllowed(cfg, bareNumber) {
  if (cfg.allowed.length === 0) return true; // empty = allow all (caller WARNs)
  return cfg.allowed.includes(normalizeNumber(bareNumber));
}
