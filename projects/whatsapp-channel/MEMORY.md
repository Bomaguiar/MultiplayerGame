# Project: WhatsApp Channel (Claude Code Plugin)

## What This Is
A Claude Code plugin that delivers WhatsApp messages directly into the Claude Code terminal session via the `claude/channel` MCP protocol. Autonomous — Claude receives and replies without user intervention.

## Full Spec Document
See: `whatsapp-claude-channel.md` in this folder (or the root of this repo).

## Current Stack (broken)
```
Evolution API (Docker/WSL2, port 8080)
    → webhook POST → BROKEN (WSL2 NAT blocks Docker→Windows)
    → whatsapp-channel plugin (Bun, port 3333, Windows)
    → wa-inbox.jsonl
    → Claude Code Monitor (/wa skill)
```

## Target Stack (v2.0 plugin)
```
Evolution API (Docker/WSL2, port 8080)
    ← polling every 3s ← server.ts (Bun, stdio child of Claude Code)
    → MCP notification (claude/channel)
    → Claude Code context window
    → reply_whatsapp tool → Evolution API → WhatsApp
```

## Key Config
- **Instance:** PedroW
- **API key:** YOUR_EVOLUTION_API_KEY
- **Evolution API:** http://localhost:8080
- **Allowed contacts:** <PEDRO_PHONE> (Pedro), <ILYA_PHONE> (Ilya)
- **Start keyword:** ai_pedras
- **Stop keyword:** bye ai_pedras
- **Poll interval:** 3000ms

## Why Polling (not webhooks)
WSL2 NAT blocks Docker→Windows traffic. Polling flips the direction to Windows→Docker which always works. WSL2 mirrored networking (Option A) was rejected — requires `wsl --shutdown`.

## File Layout
```
~/.claude/channels/whatsapp/
├── .env
├── access.json
├── bot.pid
└── inbox/

~/.claude/plugins/cache/local/whatsapp-channel/2.0.0/
├── server.ts
└── package.json
```

## Tools Exposed to Claude
- `reply_whatsapp(phone, text, reply_to_message_id?)` 
- `send_reaction(phone, message_id, emoji)`
- `download_media(message_id, phone)`
- `get_session_status()`

## Security Model
- Only allowed phones receive delivery
- Session gate: ai_pedras / bye ai_pedras
- assertAllowedPhone(): can only reply to phones that sent inbound
- PID file: zombie guard
- Orphan watchdog: shuts down if Claude Code dies

## Build Status
- [ ] Create state directories
- [ ] Write .env and access.json
- [ ] Write server.ts (full spec in whatsapp-claude-channel.md)
- [ ] Register in settings.json
- [ ] Test sequence (5 steps)

## Broken Components to Remove
- daemon.mjs — do NOT restart, legacy
- whatsapp_channel_mcp.py — remove from .mcp.json (port conflict)
- PowerShell monitor — replaced by plugin
- wa-cursor.txt — replaced by in-memory seenIds
