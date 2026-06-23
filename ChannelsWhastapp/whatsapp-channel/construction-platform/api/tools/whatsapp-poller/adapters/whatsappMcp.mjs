// Real lharries-style whatsapp-mcp bridge adapter.
//
// Modeled after the PROVEN watcher.py at:
//   ChannelsWhastapp/whatsapp-channel/watcher/watcher.py
// which has been running in production on Pedro's machine. We match its exact
// DB query pattern and send contract — no guesswork.
//
// Inbound: read the Go bridge's SQLite store directly using Node's built-in
//   `node:sqlite` (DatabaseSync, Node 22.5+ / 24). We query the `messages`
//   table for recent individual incoming messages and dedupe by message `id`
//   (same strategy as watcher.py — no dependency on a timestamp column).
//
// Outbound: POST to the Go bridge's REST API `/api/send` with
//   { recipient: <chat_jid>, message: <text> }.
//   The recipient is the FULL chat JID (e.g. "351900000009@s.whatsapp.net"),
//   matching how watcher.py calls send_wa(chat, ...).
//
// Config (env):
//   BRIDGE_DB_PATH  path to whatsapp-bridge/store/messages.db (REQUIRED)
//                   Pedro's default: E:\whatsapp-mcp\whatsapp-bridge\store\messages.db
//   BRIDGE_API_URL  base URL of the Go bridge (default http://localhost:8080/api)

let DatabaseSync = null;
let sqliteImportError = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch (err) {
  sqliteImportError = err;
}

function jidToBare(jid) {
  return String(jid || '').split('@')[0].replace(/\D/g, '');
}

export class WhatsappMcpAdapter {
  constructor({ dbPath, apiUrl, logger = console } = {}) {
    this.name = 'whatsappMcp';
    this.logger = logger;
    this.dbPath = dbPath;
    this.apiUrl = (apiUrl || 'http://localhost:8080/api').replace(/\/+$/, '');

    if (!DatabaseSync) {
      throw new Error(
        'node:sqlite is unavailable in this runtime. The whatsappMcp adapter ' +
        'needs Node 22.5+ / 24 with the built-in SQLite module. ' +
        `Original import error: ${sqliteImportError?.message || 'unknown'}`,
      );
    }
    if (!dbPath) {
      throw new Error(
        'BRIDGE_DB_PATH is required for the whatsappMcp adapter.\n' +
        'Pedro\'s default: E:\\whatsapp-mcp\\whatsapp-bridge\\store\\messages.db',
      );
    }

    // Open read-only — we never write to the bridge's store.
    this.db = new DatabaseSync(dbPath, { readOnly: true });
  }

  // Fetch recent incoming individual messages. `sinceCursor` is the persisted
  // state: either null (never run before) or an array of already-processed
  // message IDs. This mirrors watcher.py's id-based deduplication — no
  // dependency on a timestamp column existing or being in any particular format.
  //
  // FIRST-RUN PRIMING: when there is no prior state (cursor is null/undefined),
  // we swallow the existing backlog — record every current message id as "seen"
  // and return ZERO messages. Without this, launching the poller would reply to
  // your entire WhatsApp history. watcher.py does exactly the same (its
  // `primed` flag). A fresh state file therefore means "start from now".
  async fetchIncoming(sinceCursor) {
    const firstRun = sinceCursor === null || sinceCursor === undefined;
    const seenIds = new Set(Array.isArray(sinceCursor) ? sinceCursor : []);

    // Match watcher.py's exact query: recent messages, is_from_me=0, newest first.
    // We then reverse to process oldest-first, and skip IDs we've already seen.
    const stmt = this.db.prepare(
      `SELECT id, chat_jid, sender, content
         FROM messages
        WHERE is_from_me = 0
        ORDER BY rowid DESC
        LIMIT 80`,
    );
    const rows = stmt.all();
    rows.reverse(); // oldest first

    const messages = [];
    const newSeen = [...seenIds]; // carry forward

    for (const r of rows) {
      // Skip groups — only individual chats (@s.whatsapp.net).
      if (!r.chat_jid || !r.chat_jid.includes('@s.whatsapp.net')) continue;
      const mid = String(r.id);
      if (seenIds.has(mid)) continue; // already processed
      newSeen.push(mid);
      // On the very first run, mark-as-seen WITHOUT emitting (prime the backlog).
      if (firstRun) continue;
      messages.push({
        jid: r.chat_jid,
        from: jidToBare(r.sender || r.chat_jid),
        body: r.content ?? '',
        mediaType: null,
        timestamp: null,
        messageId: mid,
      });
    }

    if (firstRun) {
      this.logger.log?.(`[whatsappMcp] primed ${newSeen.length} existing message(s) — starting from now, no replay.`);
    }

    // Cap the seen list so it doesn't grow forever (match watcher.py's 500 cap).
    const CAP = 500;
    const cursor = newSeen.length > CAP ? newSeen.slice(-CAP) : newSeen;
    return { messages, cursor };
  }

  // Send a message via the Go bridge. Recipient is the FULL chat JID
  // (e.g. "351900000009@s.whatsapp.net"), matching watcher.py's send_wa().
  // The poller passes a bare number, so we re-attach the suffix.
  async sendMessage(toBareNumber, text) {
    const digits = String(toBareNumber).replace(/\D/g, '');
    const recipient = `${digits}@s.whatsapp.net`;
    const res = await fetch(`${this.apiUrl}/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recipient, message: text }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Go bridge /send failed (${res.status}): ${detail.slice(0, 300)}`);
    }
  }

  close() {
    try { this.db?.close(); } catch { /* ignore */ }
  }
}

export function createAdapter(cfg, logger = console) {
  return new WhatsappMcpAdapter({
    dbPath: cfg.bridgeDbPath,
    apiUrl: cfg.bridgeApiUrl,
    logger,
  });
}
