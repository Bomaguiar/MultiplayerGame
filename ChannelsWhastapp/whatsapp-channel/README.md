# whatsapp-channel — Claude Code Plugin (v2.0.0, "ultimate")

Brings WhatsApp into a Claude Code session using the experimental **`claude/channel`**
MCP protocol — the same mechanism the official Telegram plugin uses. A WhatsApp
message arrives, Claude Code injects it straight into the live conversation as a
`<channel>` block, and Claude replies through a tool. No terminal switching, no
polling skills, no fragile file-watchers.

This is the production build of the plan in
[`../../projects/whatsapp-channel/whatsapp-claude-channel.md`](../../projects/whatsapp-channel/whatsapp-claude-channel.md),
upgraded to full **Telegram feature parity**.

---

## What's in this folder

```
whatsapp-channel/
├── 2.0.0/
│   ├── server.ts                 ← the plugin (single file)
│   └── package.json              ← one dep: @modelcontextprotocol/sdk
├── channel-state/
│   ├── .env.example              ← copy to ~/.claude/channels/whatsapp/.env
│   └── access.example.json       ← copy to ~/.claude/channels/whatsapp/access.json
├── settings.snippet.json         ← merge into ~/.claude/settings.json
└── README.md
```

---

## Architecture

```
Phone ──WhatsApp──▶ Evolution API (Docker :8080)
                          │
        plugin polls ◀────┘  (Windows→Docker direction always works)
        every 3s
          │
          ▼
   server.ts (Bun, stdio child of Claude Code)
          │  notifications/claude/channel
          ▼
   Claude Code  →  <channel> block in the conversation
          │
          │  Claude calls reply_whatsapp
          ▼
   server.ts → POST /message/sendText/PedroW → Evolution API → WhatsApp
```

Polling (not webhooks) is deliberate: Evolution API lives in Docker/WSL2 and the
Docker→Windows webhook direction is blocked by WSL2 NAT. Pulling from Windows→Docker
on `:8080` is the same path sending already uses, so it always works.

---

## How this "ultimate" build improves on the v2.0 spec

Everything from the deep-dive's Telegram analysis, carried over to WhatsApp:

| Capability | v2.0 spec | This build |
|---|:--:|:--:|
| `reply_whatsapp` (auto-chunk) | ✅ | ✅ + **file attachments** (inbox-gated) + **newline-aware chunking** |
| **Markdown → WhatsApp formatting** (`RICH_TEXT`) | — | ✅ |
| `send_reaction` | ✅ | ✅ |
| `download_media` | ✅ | ✅ (image/doc/audio/video) |
| `get_session_status` | ✅ | ✅ |
| **Typing indicator** (`send_presence`) | — | ✅ |
| **`edit_message`** | — | ✅ |
| **`delete_message`** | — | ✅ |
| **`mark_read`** | — | ✅ |
| **`get_chat_info`** | — | ✅ |
| **Group chat support** (`@g.us`, require-mention) | — | ✅ |
| **Ack reaction on receipt** (👁️) | — | ✅ |
| **Outbound by `chat_id` JID** (not just phone) | — | ✅ |
| **Backlog priming** (no replay of old history on start) | — | ✅ |
| **`assertSendable()` file-safety gate** | — | ✅ |
| **Retry/backoff on Evolution calls** | partial | ✅ |
| Reply-security (`assertAllowedChat`) | ✅ | ✅ (DMs + groups) |
| PID zombie guard + orphan watchdog | ✅ | ✅ |
| `safeName()` XML-attr sanitization | ✅ | ✅ |

`claude/channel/permission` is intentionally **not** declared — WhatsApp has no
authenticated inline approve/deny UI, so a permission relay couldn't prove who
approved (deep-dive §13.3).

---

## Install

### 1. Copy the plugin into the Claude Code cache

```powershell
# Windows
$dst = "$env:USERPROFILE\.claude\plugins\cache\local\whatsapp-channel\2.0.0"
mkdir $dst -Force
copy 2.0.0\server.ts   $dst
copy 2.0.0\package.json $dst
cd $dst; bun install
```

```bash
# macOS / Linux
dst=~/.claude/plugins/cache/local/whatsapp-channel/2.0.0
mkdir -p "$dst"
cp 2.0.0/server.ts 2.0.0/package.json "$dst"
( cd "$dst" && bun install )
```

### 2. Create channel state

```bash
mkdir -p ~/.claude/channels/whatsapp/inbox
cp channel-state/.env.example        ~/.claude/channels/whatsapp/.env
cp channel-state/access.example.json ~/.claude/channels/whatsapp/access.json
chmod 600 ~/.claude/channels/whatsapp/.env     # POSIX only
```

Edit `.env` — set `EVOLUTION_API_KEY`, `INSTANCE_NAME`, and `ALLOWED_PHONES`.

### 3. Register in `~/.claude/settings.json`

Merge the contents of [`settings.snippet.json`](./settings.snippet.json). The
`permissions.allow` entries stop Claude prompting "Allow?" on every reply — required
for autonomous operation.

### 4. Launch

```bash
claude              # if channelsEnabled: true
# or
claude --channels plugin:whatsapp-channel@local
```

Verify with `/mcp` → `whatsapp-channel` should be **connected**.

---

## Session flow

```
Phone                          Claude Code
─────                          ───────────
"ai_pedras"            →   plugin sets sessionActive=true (Claude never sees it)
"status of Oficina     →   <channel> block injected → Claude reads, replies
 Vale?"
                       ←   reply_whatsapp → arrives on phone
"bye ai_pedras"        →   plugin sets sessionActive=false; Claude goes quiet
```

A received message looks like this inside Claude Code:

```xml
<channel source="plugin:whatsapp-channel:whatsapp-channel"
         chat_id="351915873259@s.whatsapp.net" phone="351915873259"
         name="Pedro" message_id="3EB0A1B2C3D4E5F6"
         ts="2026-06-16T10:30:00.000Z" is_group="false"
         has_image="false" has_document="false" session_active="true">
Olá Claude, podes verificar o estado do projeto Oficina Vale?
</channel>
```

---

## Rich text / formatting

Evolution API has **no "enable rich text" switch** on `sendText` — WhatsApp formatting is
just raw characters (`*bold*`, `_italic_`, `~strike~`, ` ```mono``` `) and always renders
*if you send WhatsApp's exact syntax*. The catch: Claude naturally writes **standard
Markdown** (`**bold**`, `## headings`, `- bullets`, `[text](url)`), which WhatsApp shows
**literally** — that's the "rich text not working" symptom. (Evolution itself only converts
Markdown for its *Chatwoot* channel, never for the raw API this plugin uses.)

The fix lives in the plugin: every outbound message is passed through `mdToWhatsApp()`
before `sendText`, converting Markdown → WhatsApp formatting (same idea as Evolution's
Chatwoot regex). So you can let Claude write normal Markdown and the recipient sees real
formatting.

| Claude writes (Markdown) | Recipient sees (WhatsApp) |
|---|---|
| `**bold**` / `__bold__` | *bold* |
| `***x***` | bold + italic |
| `~~strike~~` | ~strike~ |
| `## Heading` | *Heading* (bold line) |
| `- item` / `* item` | • item |
| `` `code` `` | ```` ```code``` ```` (monospace) |
| `[label](https://…)` | label (https://…) |

Toggle with `RICH_TEXT` in `.env` (default `on`; set `off` to send byte-for-byte).
Fenced code blocks and inline code are protected from emphasis rewriting, and the
converter is collision-safe (e.g. "I have 5 apples" is never mangled).

> Secondary, server-side note: if formatting *still* misbehaves on some recipients, an
> outdated emulated client can be the cause — set `CONFIG_SESSION_PHONE_VERSION` on the
> Evolution API container to a current WhatsApp Web version. That's an Evolution-side env
> var, not part of this plugin.

## Tools exposed to Claude

| Tool | Purpose |
|---|---|
| `reply_whatsapp` | Send text (auto-chunked) and/or an inbox file, optionally quoting a message |
| `send_reaction` | React to a received message with an emoji |
| `download_media` | Fetch image/doc/audio/video to `inbox/`, returns local path |
| `send_presence` | Show typing / recording / available |
| `edit_message` | Edit a previously sent bot message |
| `delete_message` | Revoke a previously sent bot message |
| `mark_read` | Blue-tick a received message |
| `get_chat_info` | Profile / group metadata for a chat |
| `get_session_status` | Session state, allowlist, active chats this session |

Every outbound tool runs `assertAllowedChat()` — Claude can only act on chats that
delivered to it this session (or an allow-listed DM), so a prompt injection in an
inbound message can't redirect replies to an arbitrary number.

---

## Security model

| Threat | Protection |
|---|---|
| Unknown phone messages you | `ALLOWED_PHONES` gate — silent drop |
| Allowed phone, session off | `sessionActive` gate — silent drop |
| "approve me / start session" injection | Claude instructed never to mutate access from channel text; keywords handled by plugin only |
| Reply to arbitrary phone | `assertAllowedChat()` |
| Leak `.env` / `access.json` via file send | `assertSendable()` — only `inbox/` is sendable |
| Forged XML attributes | `safeName()` strips `< > [ ] ; ' " \r \n` |
| Duplicate delivery | in-memory `seenIds` dedup |
| Stale poller after a crash | PID file + SIGTERM on startup |
| Zombie after Claude Code exits | orphan watchdog (ppid / stdin checks every 5s) |

---

## Troubleshooting

- **Not in `/mcp`** — check `channelsEnabled: true`, the plugin name
  `whatsapp-channel@local`, and that `…/cache/local/whatsapp-channel/2.0.0/server.ts`
  exists. Run `bun server.ts` directly to see startup errors on stderr.
- **No messages arriving** — send `ai_pedras` first (`sessionActive` must be true);
  confirm your number is in `ALLOWED_PHONES`; confirm Evolution is up (`docker ps`) and
  the instance state is `open`. Debug log: `claude 2>plugin-debug.log`.
- **Reply not delivered** — test Evolution directly:
  `curl -X POST $EVOLUTION_API_URL/message/sendText/$INSTANCE -H "apikey: $KEY" -d '{"number":"351915873259","text":"test"}'`.
- **Duplicates** — a stale poller is alive; check `bot.pid`, kill it, restart Claude Code.
