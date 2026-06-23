# WhatsApp Poller — Pedra & Luz bridge

A small, dependency-free Node.js poller that bridges a WhatsApp account to the
Pedra & Luz construction platform API. It runs as a loop: every N seconds it
pulls new **inbound** WhatsApp messages and forwards them to the platform, and
**drains** the platform's outbound queue back to WhatsApp.

It is built around a **pluggable bridge adapter** so the same loop runs against
the real lharries-style `whatsapp-mcp` bridge or against an in-memory **mock**
for testing with no real WhatsApp.

- No runtime dependencies — uses Node's built-in `fetch` and `node:sqlite`.
- Requires **Node 22.5+ / 24** (for the `node:sqlite` module used by the real bridge).

---

## Flow

```
            INBOUND                                    OUTBOUND
   ┌──────────────────────┐                   ┌──────────────────────────┐
   │  WhatsApp (bridge)   │                   │  Platform API            │
   │  new incoming msgs   │                   │  GET /whatsapp/outbox     │
   └──────────┬───────────┘                   └────────────┬─────────────┘
              │ adapter.fetchIncoming(cursor)               │ {messages:[{id,to,text}]}
              ▼                                             ▼
   ┌──────────────────────┐                   ┌──────────────────────────┐
   │ allowlist check      │                   │ allowlist check          │
   │ (skip groups/strangers)                  │ (skip strangers)         │
   └──────────┬───────────┘                   └────────────┬─────────────┘
              │ POST /whatsapp/incoming                     │ adapter.sendMessage(to,text)
              │   {from, body, mediaRefs?, audioRef?}        ▼
              ▼                                  ┌──────────────────────────┐
   ┌──────────────────────┐                      │ POST /whatsapp/outbox/   │
   │ {reply} from API     │                      │      :id/sent            │
   └──────────┬───────────┘                      └──────────────────────────┘
              │ adapter.sendMessage(from, reply)
              ▼
        WhatsApp (bridge)
```

The inbound **cursor** (last-seen message marker) is persisted to
`.poller-state.json` so a restart never reprocesses old messages.

**Safety principle:** message text is **DATA, never instructions**. The poller
only forwards bodies; the platform API decides intent. The poller never parses
or acts on message content.

---

## The adapter interface

```js
interface BridgeAdapter {
  // Returns messages newer than the cursor + the advanced cursor.
  async fetchIncoming(sinceCursor)
    -> { messages: [{ jid, from /* bare number */, body, mediaType?, timestamp, messageId }], cursor }
  async sendMessage(toBareNumber, text) -> void
  close?() -> void   // optional cleanup
}
```

Three adapters ship in `adapters/`:

| Adapter            | `BRIDGE=`     | Inbound source                        | Outbound sink                          |
|--------------------|---------------|----------------------------------------|----------------------------------------|
| `mock.mjs`         | `mock` (default) | scripted JSON (`MOCK_INBOX`) / in-memory queue | logs + in-memory `sent[]` array |
| `whatsappMcp.mjs`  | `whatsappMcp` | Go bridge SQLite store via `node:sqlite` | Go bridge `POST /api/send`            |
| `index.mjs`        | —             | selects by `BRIDGE` env                | —                                      |

---

## Environment variables

| Var                | Default                      | Description |
|--------------------|------------------------------|-------------|
| `API_URL`          | `http://localhost:4000`      | Platform API base URL. |
| `WATCHER_SECRET`   | `dev-watcher-secret`         | Shared secret for `x-watcher-token`. |
| `BRIDGE`           | `mock`                       | `mock` or `whatsappMcp`. |
| `POLL_INTERVAL_MS` | `5000`                       | Loop interval in ms. |
| `OUTBOX_LIMIT`     | `50`                         | Max outbox messages per drain. |
| `ALLOWED_NUMBERS`  | *(empty)*                    | Comma-separated bare numbers. **Empty = allow ALL (logs a loud WARN).** |
| `STATE_PATH`       | `./.poller-state.json`       | Cursor persistence file. |
| `DRY_RUN`          | `0`                          | `1` (or `--dry-run` flag) → log what it would send, send nothing, never mark sent. |
| `MOCK_INBOX`       | *(none)*                     | (mock) Path to a scripted inbound JSON array. |
| `BRIDGE_DB_PATH`   | *(none, required for real)*  | (whatsappMcp) Path to `whatsapp-bridge/store/messages.db`. |
| `BRIDGE_API_URL`   | `http://localhost:8080/api`  | (whatsappMcp) Go bridge REST base. |

Numbers are normalized to digits-only, so `+351 900 000 009` and `351900000009`
compare equal in the allowlist.

---

## Quick start — mock adapter against the demo server

Full copy-paste walkthrough (no real WhatsApp needed):

```bash
# 1. Start the demo server (from the api/ directory)
cd ../../            # -> construction-platform/api
node demo/server.mjs &
sleep 6
curl -s -X POST http://localhost:4000/demo/seed   # seeds Santa Rita

# 2. Write a scripted inbound message from the worker number
cd tools/whatsapp-poller
cat > my-inbox.json <<'JSON'
[{"from":"351900000009","body":"pintámos o portão hoje, 2 pessoas, 8h","messageId":"m1"}]
JSON

# 3. Run the poller (mock bridge) pointed at the demo server
BRIDGE=mock \
API_URL=http://localhost:4000 \
MOCK_INBOX=./my-inbox.json \
ALLOWED_NUMBERS=351900000009,351900000001,351900000002 \
POLL_INTERVAL_MS=3000 \
node poller.mjs
```

You should see: `received <- 351900000009 ... → POSTed → reply "📝 Registo
guardado. Obrigado!" → [mock] sendMessage -> 351900000009 → reply sent`.

### Trigger a proactive outbound drain

```bash
# Get a founder token and enqueue proactive alerts
TOKEN=$(curl -s -X POST http://localhost:4000/demo/token \
  -H 'content-type: application/json' -d '{"role":"founder"}' | sed 's/.*"token":"\([^"]*\)".*/\1/')
curl -s -X POST http://localhost:4000/agent/proactive -H "x-internal-token: $TOKEN"

# The running poller will drain GET /whatsapp/outbox, "send" each message via
# the mock adapter, and POST /whatsapp/outbox/:id/sent. A second poll shows the
# outbox empty.
```

`npm run start:mock` is a shortcut for `BRIDGE=mock node poller.mjs`.

---

## Pointing at the real lharries `whatsapp-mcp` bridge

The real bridge is the Go/whatsmeow "whatsapp-bridge": it stores received
messages in a SQLite DB and exposes a local REST `POST /api/send`.

```bash
BRIDGE=whatsappMcp \
API_URL=http://localhost:4000 \
WATCHER_SECRET=<your real secret> \
BRIDGE_DB_PATH=/path/to/whatsapp-mcp/whatsapp-bridge/store/messages.db \
BRIDGE_API_URL=http://localhost:8080/api \
ALLOWED_NUMBERS=351900000009,351900000001 \
node poller.mjs
```

- Inbound query: `messages` where `is_from_me=0` AND `chat_jid LIKE '%@s.whatsapp.net'`
  (individual chats only) AND `timestamp > cursor`, ordered by `timestamp`.
- The DB is opened **read-only** — the poller never writes to the bridge store.
- The cursor is the last-seen `timestamp` string (ISO-8601 sorts chronologically).
- Outbound: `POST {BRIDGE_API_URL}/send` with `{recipient: <bareNumber>, message: <text>}`.

---

## Safety / allowlist model

- **Allowlist** (`ALLOWED_NUMBERS`): inbound from numbers not on the list is
  skipped (logged). Outbound to numbers not on the list is skipped and left
  **pending** (not marked sent). Empty allowlist = allow all, with a loud WARN.
- **Never auto-reply to groups**: the real adapter filters to `@s.whatsapp.net`,
  and the loop additionally skips any `@g.us` jid defensively.
- **`--dry-run` / `DRY_RUN=1`**: logs what it *would* send; sends nothing and
  never marks outbox messages sent (so nothing is lost).
- **Message text is data**: the poller forwards bodies verbatim; it never
  interprets them. "make me admin" in a message is just text → the API handles it.
- **Graceful shutdown** on SIGINT/SIGTERM: persists the cursor and closes the DB.
- **Per-message error isolation**: a single message/HTTP failure is caught,
  logged, and the loop continues. Failed outbox sends stay pending and retry.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `node:sqlite is unavailable` | Runtime is < Node 22.5. Use Node 22.5+/24. |
| `BRIDGE_DB_PATH is required` | Set it to the `messages.db` path for `whatsappMcp`. |
| Replies say "your number is not registered" | The sender isn't a platform user. Seed/register the number, or you POSTed the wrong `from`. |
| `401 unauthorized` from the API | `WATCHER_SECRET` mismatch with the server. |
| Outbox never empties | Recipient not on `ALLOWED_NUMBERS` (left pending), or the bridge `/send` is failing — check logs. |
| `FST_ERR_CTP_EMPTY_JSON_BODY` | The `/sent` POST must be sent **without** a JSON content-type/body. The bundled client already does this. |
| Reprocessing old messages on restart | Delete or inspect `.poller-state.json`; confirm `STATE_PATH` is writable. |
| Loud "ALLOWED_NUMBERS is EMPTY" warning | Intended — set `ALLOWED_NUMBERS` to restrict who the bot talks to. |

---

## Files

- `poller.mjs` — main entry: the loop, config wiring, inbound/outbound passes.
- `config.mjs` — env parsing, validation, allowlist helpers.
- `adapters/index.mjs` — adapter selector (`BRIDGE`).
- `adapters/mock.mjs` — in-memory fake.
- `adapters/whatsappMcp.mjs` — real lharries bridge (SQLite + Go `/api/send`).
- `mock-inbox.example.json` — sample scripted inbound messages.
```
