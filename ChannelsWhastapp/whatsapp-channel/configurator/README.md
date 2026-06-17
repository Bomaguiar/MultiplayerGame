# WhatsApp Assistant Configurator

Web UI for managing WhatsApp assistant settings: permissions, whitelists, and custom menus per contact.

## Install

```bash
cd configurator
npm install
```

## Run

```bash
npm start
```

Visit `http://localhost:3000` in your browser.

## What it does

**Whitelist tab** — Add/remove allowed phone numbers (country code + digits, e.g., `351915873259`)

**Permissions tab** — Define three permission levels:
- `admin` — full menu, can run terminal commands, use connectors
- `user` — restricted menu (calendar, email, AI), connectors enabled, no terminal
- `guest` — questions/chat only

Each level controls:
- `canRunCommands` — allow `! cmd`
- `canUseConnectors` — allow ClickUp/Calendar/Gmail commands
- `canViewMenu` — which menu sections they see

**Contacts tab** — Assign a name and permission level to each phone

**Custom Menus tab** — Override a contact's menu items (e.g., Mom sees only calendar + AI)

## How it integrates with the watcher

The configurator saves to `~/.claude/whatsapp-assistant.json`. The watcher reads this file at the start of every tick, so changes take effect immediately.

Config schema:
```json
{
  "allow": ["351915873259"],
  "permissions": {
    "admin": { "canRunCommands": true, "canUseConnectors": true, "canViewMenu": [...] },
    "user": { "canRunCommands": false, "canUseConnectors": true, "canViewMenu": [...] },
    "guest": { "canRunCommands": false, "canUseConnectors": false, "canViewMenu": ["ai"] }
  },
  "contacts": {
    "351915873259": { "name": "Pedro", "permission": "admin", "customMenu": null }
  },
  "activeChats": {},
  "pendingConfirm": {},
  "processedIds": [],
  "primed": false
}
```

## Manual edit

If you prefer, edit `~/.claude/whatsapp-assistant.json` directly. The configurator will reload it on next page load.
