// Real lharries-style whatsapp-mcp bridge adapter.
//
// Inbound: read the Go bridge's SQLite store directly using Node's built-in
//   `node:sqlite` (DatabaseSync). Available in Node 22.5+/24. Pedro runs Node 24.
//   We query the `messages` table for individual incoming messages newer than
//   the cursor.
// Outbound: POST to the Go bridge's REST API `/api/send` with
//   { recipient: <bareNumber>, message: <text> }.
//
// Config (env):
//   BRIDGE_DB_PATH  path to whatsapp-bridge/store/messages.db (REQUIRED)
//   BRIDGE_API_URL  base URL of the Go bridge (default http://localhost:8080/api)
//
// The store's `timestamp` column is stored by whatsmeow as an RFC3339 / SQLite
// datetime string. We carry the cursor as that same string and compare with
// SQLite's own string ordering (lexicographic == chronological for ISO-8601).

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
      throw new Error('BRIDGE_DB_PATH is required for the whatsappMcp adapter (path to whatsapp-bridge/store/messages.db).');
    }

    // Open read-only — we never write to the bridge's store.
    this.db = new DatabaseSync(dbPath, { readOnly: true });
  }

  async fetchIncoming(sinceCursor) {
    // Cursor is the last-seen timestamp string. Empty string scans from the start.
    const cursor = sinceCursor || '';
    const stmt = this.db.prepare(
      `SELECT id, chat_jid, sender, content, timestamp, media_type, filename
         FROM messages
        WHERE is_from_me = 0
          AND chat_jid LIKE '%@s.whatsapp.net'
          AND timestamp > ?
        ORDER BY timestamp ASC
        LIMIT 200`,
    );
    const rows = stmt.all(cursor);

    const messages = rows.map((r) => ({
      jid: r.chat_jid,
      // Prefer the explicit sender if present, else derive from the chat jid.
      from: jidToBare(r.sender || r.chat_jid),
      body: r.content ?? '',
      mediaType: r.media_type || null,
      timestamp: r.timestamp,
      messageId: r.id,
    }));

    const newCursor = messages.length ? messages[messages.length - 1].timestamp : cursor;
    return { messages, cursor: newCursor };
  }

  async sendMessage(toBareNumber, text) {
    const recipient = String(toBareNumber).replace(/\D/g, '');
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
