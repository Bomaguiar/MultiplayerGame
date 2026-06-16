# Project: WhatsApp Assistance

## What This Is
A Claude skill/configuration for reliably accessing and managing WhatsApp in any Claude session.

## The Problem It Solves
WhatsApp MCP tools evict from context between turns — especially on mobile. This skill ensures tools are always reloaded before use.

## Tool Loading Protocol (ALWAYS run first)
```
tool_search("whatsapp list chats messages")
tool_search("whatsapp")  ← if first doesn't return list_chats
```

## Available Connectors
### `whatsapp` MCP connector (primary — use this)
- `list_chats` — all chats, sorted, with last message
- `list_messages` — read messages, date filters, search, pagination
- `search_contacts` — find by name or number
- `get_chat` — chat metadata
- `get_message_context` — context around specific message
- `get_last_interaction` — last message with a contact
- `get_contact_chats` — all chats involving a contact
- `send_message` — send to any JID (individual or group)
- `download_media` — images/documents
- `send_audio_message` — audio messages

### `evolution-whatsapp` connector (local Evo API — limited)
- `send_whatsapp_message` — send only
- `get_whatsapp_status` — currently returning 404

## JID Patterns
- Individual: `[number]@s.whatsapp.net`
- Group: `[id]@g.us`
- Lid: `[id]@lid`
- Skip: `status@broadcast`

## Inbox Summary Format
- 🔴 Needs Attention
- 💼 Work / Business
- 🏠 Projects
- 💰 Crypto / Finance
- 👨‍👩‍👧 Personal / Family
- ⚠️ Watch Out (scams, suspicious links)

## Rules
- NEVER send without explicit user confirmation
- Flag crypto messages with suspicious links
- Never share IBAN or personal data in artifacts
