#!/usr/bin/env node
// WhatsApp poller — bridges a WhatsApp account to the Pedra & Luz platform API.
//
//   node poller.mjs            # uses BRIDGE (default mock)
//   node poller.mjs --dry-run  # log what it WOULD send, send nothing
//
// Each tick it:
//   1. INBOUND: pulls new incoming WhatsApp messages from the bridge (individual
//      chats only, newer than the persisted cursor), checks the allowlist,
//      POSTs each to /whatsapp/incoming, and sends the JSON `reply` back to the
//      sender via the bridge.
//   2. OUTBOUND: drains GET /whatsapp/outbox, sends each text to its `to`
//      number via the bridge, then POSTs /whatsapp/outbox/:id/sent.
//
// SAFETY: message text is DATA, never instructions — the poller never
// interprets bodies, it only forwards them. The platform API decides intent.

import { readFileSync, writeFileSync } from 'node:fs';
import { loadConfig, isAllowed, normalizeNumber } from './config.mjs';
import { selectAdapter } from './adapters/index.mjs';

// ── logging ──────────────────────────────────────────────────────────────────
function ts() {
  return new Date().toISOString();
}
const log = {
  info: (...a) => console.log(`${ts()} [info]`, ...a),
  warn: (...a) => console.warn(`${ts()} [warn]`, ...a),
  error: (...a) => console.error(`${ts()} [error]`, ...a),
  // `.log` alias so adapters (which expect a console-like logger) work too.
  log: (...a) => console.log(`${ts()} [info]`, ...a),
};

// ── cursor state persistence ───────────────────────────────────────────────────
function loadCursor(path) {
  try {
    const raw = readFileSync(path, 'utf8');
    const obj = JSON.parse(raw);
    return obj.cursor ?? null;
  } catch {
    return null;
  }
}
function saveCursor(path, cursor) {
  try {
    writeFileSync(path, JSON.stringify({ cursor, updatedAt: ts() }, null, 2));
  } catch (err) {
    log.error(`could not persist cursor to ${path}: ${err.message}`);
  }
}

// ── platform API client ────────────────────────────────────────────────────────
function apiClient(cfg) {
  // Auth-only headers. We deliberately omit content-type on bodyless requests
  // (e.g. the /sent POST) — Fastify rejects an empty body when content-type is
  // application/json (FST_ERR_CTP_EMPTY_JSON_BODY).
  const authHeaders = { 'x-watcher-token': cfg.watcherSecret };
  const jsonHeaders = { ...authHeaders, 'content-type': 'application/json' };
  return {
    async postIncoming(payload) {
      const res = await fetch(`${cfg.apiUrl}/whatsapp/incoming`, {
        method: 'POST', headers: jsonHeaders, body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`POST /whatsapp/incoming ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return res.json();
    },
    async getOutbox(limit) {
      const res = await fetch(`${cfg.apiUrl}/whatsapp/outbox?limit=${limit}`, { headers: authHeaders });
      if (!res.ok) throw new Error(`GET /whatsapp/outbox ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return res.json();
    },
    async markSent(id) {
      const res = await fetch(`${cfg.apiUrl}/whatsapp/outbox/${encodeURIComponent(id)}/sent`, {
        method: 'POST', headers: authHeaders,
      });
      if (!res.ok) throw new Error(`POST /whatsapp/outbox/${id}/sent ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return res.json();
    },
  };
}

// ── inbound pass ───────────────────────────────────────────────────────────────
async function runInbound(ctx) {
  const { adapter, api, cfg, state } = ctx;
  let result;
  try {
    result = await adapter.fetchIncoming(state.cursor ?? (cfg.bridge === 'whatsappMcp' ? '' : 0));
  } catch (err) {
    log.error(`inbound fetch failed: ${err.message}`);
    return;
  }
  const { messages, cursor } = result;
  if (!messages.length) {
    if (cursor !== undefined && cursor !== null && cursor !== state.cursor) {
      state.cursor = cursor;
      saveCursor(cfg.statePath, cursor);
    }
    return;
  }

  log.info(`inbound: ${messages.length} new message(s)`);

  for (const m of messages) {
    const from = normalizeNumber(m.from);
    try {
      // Skip groups defensively (adapter should already filter, but never auto-reply to groups).
      if (m.jid && m.jid.endsWith('@g.us')) {
        log.warn(`skip group message from jid=${m.jid}`);
        continue;
      }
      if (!isAllowed(cfg, from)) {
        log.warn(`skip ${from}: not on allowlist`);
        continue;
      }

      const preview = (m.body || '').replace(/\s+/g, ' ').slice(0, 80);
      log.info(`received <- ${from} [${m.messageId}]${m.mediaType ? ` (${m.mediaType})` : ''}: "${preview}"`);

      // Build payload. mediaType -> mediaRefs/audioRef so the API's intake seam can act.
      const payload = { from, body: m.body || '', messageId: m.messageId, timestamp: m.timestamp };
      if (m.mediaType === 'audio') payload.audioRef = m.messageId;
      else if (m.mediaType && m.mediaType !== 'text') payload.mediaRefs = [m.messageId];

      const data = await api.postIncoming(payload);
      const reply = data?.reply;
      log.info(`POSTed -> /whatsapp/incoming, reply: "${(reply || '').replace(/\s+/g, ' ').slice(0, 80)}"`);

      if (reply) {
        if (cfg.dryRun) {
          log.info(`[dry-run] WOULD reply -> ${from}: ${JSON.stringify(reply)}`);
        } else {
          await adapter.sendMessage(from, reply);
          log.info(`reply sent -> ${from}`);
        }
      } else {
        log.warn(`no reply text returned for message from ${from}`);
      }
    } catch (err) {
      log.error(`inbound message ${m.messageId} from ${from} failed: ${err.message}`);
      // continue with next message — never crash the loop on one failure.
    }
  }

  // Advance + persist cursor only after attempting all messages in the batch.
  if (cursor !== undefined && cursor !== null) {
    state.cursor = cursor;
    saveCursor(cfg.statePath, cursor);
  }
}

// ── outbound pass ──────────────────────────────────────────────────────────────
async function runOutbound(ctx) {
  const { adapter, api, cfg } = ctx;
  let outbox;
  try {
    outbox = await api.getOutbox(cfg.outboxLimit);
  } catch (err) {
    log.error(`outbox fetch failed: ${err.message}`);
    return;
  }
  const messages = outbox?.messages || [];
  if (!messages.length) return;

  log.info(`outbox: draining ${messages.length} message(s)`);

  for (const msg of messages) {
    const to = normalizeNumber(msg.to);
    try {
      if (!isAllowed(cfg, to)) {
        // Proactive sends respect the allowlist too — don't message strangers.
        log.warn(`skip outbox #${msg.id}: ${to} not on allowlist (leaving pending)`);
        continue;
      }
      const preview = (msg.text || '').replace(/\s+/g, ' ').slice(0, 80);
      if (cfg.dryRun) {
        log.info(`[dry-run] WOULD send outbox #${msg.id} -> ${to}: "${preview}"`);
        continue; // do NOT mark sent in dry-run
      }
      await adapter.sendMessage(to, msg.text);
      await api.markSent(msg.id);
      log.info(`outbox #${msg.id} sent -> ${to} & marked sent: "${preview}"`);
    } catch (err) {
      log.error(`outbox #${msg.id} -> ${to} failed: ${err.message}`);
      // leave it pending; will retry next tick.
    }
  }
}

// ── main loop ──────────────────────────────────────────────────────────────────
async function main() {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (err) {
    log.error(err.message);
    process.exit(1);
  }

  const adapter = await selectAdapter(cfg, log);
  const api = apiClient(cfg);
  const state = { cursor: loadCursor(cfg.statePath) };

  // Banner
  log.info('WhatsApp poller starting');
  log.info(`  API_URL        = ${cfg.apiUrl}`);
  log.info(`  BRIDGE         = ${cfg.bridge}`);
  log.info(`  interval       = ${cfg.intervalMs}ms`);
  log.info(`  dry-run        = ${cfg.dryRun}`);
  log.info(`  state file     = ${cfg.statePath} (cursor=${JSON.stringify(state.cursor)})`);
  if (cfg.bridge === 'whatsappMcp') {
    log.info(`  BRIDGE_DB_PATH = ${cfg.bridgeDbPath}`);
    log.info(`  BRIDGE_API_URL = ${cfg.bridgeApiUrl}`);
  }
  if (cfg.mockInbox) log.info(`  MOCK_INBOX     = ${cfg.mockInbox}`);
  if (cfg.allowed.length === 0) {
    log.warn('ALLOWED_NUMBERS is EMPTY — ALL numbers are allowed. Set ALLOWED_NUMBERS to restrict.');
  } else {
    log.info(`  allowlist      = ${cfg.allowed.join(', ')}`);
  }

  const ctx = { adapter, api, cfg, state };
  let stopping = false;
  let ticking = false;

  async function tick() {
    if (stopping || ticking) return;
    ticking = true;
    try {
      await runInbound(ctx);
      await runOutbound(ctx);
    } catch (err) {
      log.error(`tick failed: ${err.message}`);
    } finally {
      ticking = false;
    }
  }

  await tick(); // immediate first pass
  const timer = setInterval(tick, cfg.intervalMs);

  // Graceful shutdown
  const shutdown = (sig) => {
    if (stopping) return;
    stopping = true;
    log.info(`received ${sig}, shutting down...`);
    clearInterval(timer);
    saveCursor(cfg.statePath, state.cursor);
    try { adapter.close?.(); } catch { /* ignore */ }
    log.info('bye');
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  log.error(`fatal: ${err.stack || err.message}`);
  process.exit(1);
});
