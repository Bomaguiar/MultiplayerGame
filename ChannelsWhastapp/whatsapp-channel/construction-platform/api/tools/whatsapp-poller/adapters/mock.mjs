// Mock bridge adapter — in-memory fake for testing the whole loop with NO
// real WhatsApp.
//
// fetchIncoming:
//   - On first call, loads scripted messages from a JSON file (MOCK_INBOX env
//     or constructor opt) if present, plus anything pushed onto the internal
//     queue via .push(...).
//   - Returns only messages strictly newer than the given cursor (a numeric
//     timestamp), and advances the cursor to the newest message returned.
// sendMessage:
//   - Logs to console and appends to an in-memory `sent` array (inspectable in
//     tests / by the loop).
//
// The scripted JSON file is an array of objects shaped like:
//   { jid?, from, body, mediaType?, timestamp?, messageId? }
// `from` is a bare number; `jid` is derived if absent. `timestamp` is epoch
// seconds (to match the lharries store); auto-assigned if absent.

import { readFileSync } from 'node:fs';

function toJid(from) {
  return `${String(from).replace(/\D/g, '')}@s.whatsapp.net`;
}

export class MockAdapter {
  constructor({ inboxPath = null, logger = console } = {}) {
    this.name = 'mock';
    this.logger = logger;
    this.sent = [];
    this._queue = [];
    this._loaded = false;
    this._inboxPath = inboxPath;
    this._seq = 0;
  }

  _ensureLoaded() {
    if (this._loaded) return;
    this._loaded = true;
    if (!this._inboxPath) return;
    try {
      const raw = readFileSync(this._inboxPath, 'utf8');
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        for (const m of arr) this.push(m);
        this.logger.log(`[mock] loaded ${arr.length} scripted message(s) from ${this._inboxPath}`);
      }
    } catch (err) {
      this.logger.error(`[mock] could not load MOCK_INBOX (${this._inboxPath}): ${err.message}`);
    }
  }

  // Inject a message programmatically (used by tests and by the JSON loader).
  push(m) {
    const from = String(m.from ?? '').replace(/\D/g, '');
    const ts = Number(m.timestamp) || Math.floor(Date.now() / 1000) + (this._seq++);
    this._queue.push({
      jid: m.jid || toJid(from),
      from,
      body: m.body ?? '',
      mediaType: m.mediaType || null,
      timestamp: ts,
      messageId: m.messageId || `mock-${ts}-${this._queue.length}`,
    });
  }

  async fetchIncoming(sinceCursor) {
    this._ensureLoaded();
    const cursor = Number(sinceCursor) || 0;
    const fresh = this._queue
      .filter((m) => m.timestamp > cursor)
      .sort((a, b) => a.timestamp - b.timestamp);
    const newCursor = fresh.length ? fresh[fresh.length - 1].timestamp : cursor;
    return { messages: fresh, cursor: newCursor };
  }

  async sendMessage(toBareNumber, text) {
    const entry = { to: String(toBareNumber).replace(/\D/g, ''), text, at: new Date().toISOString() };
    this.sent.push(entry);
    this.logger.log(`[mock] sendMessage -> ${entry.to}: ${JSON.stringify(text)}`);
  }
}

export function createAdapter(cfg, logger = console) {
  return new MockAdapter({ inboxPath: cfg.mockInbox, logger });
}
