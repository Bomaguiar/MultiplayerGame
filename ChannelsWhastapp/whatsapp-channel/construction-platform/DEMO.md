# Running the demo on your own machine

Three ways to see the platform working — all run on **your** infrastructure, no
external services.

## Option A — No Docker needed (recommended for older Macs)

Just Node.js — no Docker, no Postgres. Everything runs in memory. Perfect for
any machine that has Node.js 18+.

```bash
cd ChannelsWhastapp/whatsapp-channel/construction-platform/api
npm install
npm run demo:server
```

Then open **http://localhost:4000/app/** in your browser.

Data lives in memory and resets when you restart. This is the fastest way to
see the dashboard.

### Install Node.js (if you don't have it)

**Mac (Homebrew):**
```bash
brew install node
```

**Mac (direct download):**
Go to https://nodejs.org/ and download the LTS version.

## Option B — Full stack (Docker: real Postgres + API + dashboard)

The production-shaped artifact: a real Postgres database, the API running
migrations on boot, and the browser dashboard. **Requires Docker Desktop
(macOS Sonoma or newer).**

```bash
cd ChannelsWhastapp/whatsapp-channel/construction-platform
docker compose up --build
```

Then open **http://localhost:4000/app/** in your browser.

Data persists in Postgres across restarts.
Stop with `Ctrl+C`; wipe data with `docker compose down -v`.

## Option C — Headless transcript (no Docker)

A scripted end-to-end run against an in-memory Postgres that prints every
request and response:

```bash
cd ChannelsWhastapp/whatsapp-channel/construction-platform/api
npm install
npm run demo
```

You'll see 15 steps covering project creation, logs+photos, customer
transparency, the privacy gate, task assignment + audit trail, and material
approval — each with its live HTTP status.

## What you'll see in the dashboard

The demo seeds real data from the **Santa Rita - Summer 2026** ClickUp workspace:

- **🧭 Pedro (gestor)** — budget overview, 19 real ClickUp tasks grouped by area
  (house exterior, main living room, kitchen, building systems), 13 material
  requests from the real materials spreadsheet, 2 change orders pending customer
  approval. Can propose changes and approve materials.

- **👤 Ilya (cliente)** — read-only transparency: project status, milestones,
  daily photos/logs, tasks, materials. Can approve or reject change orders
  (the money decisions). Cannot see worker actions.

- **👷 Franek (obra)** — can post daily logs, request materials, advance his
  assigned tasks (todo → doing → done). Cannot approve or see budget.

Every button is a real, role-gated API call — the server rejects unauthorized
actions regardless of what the UI shows.

## Run the tests

```bash
cd ChannelsWhastapp/whatsapp-channel/construction-platform/api
npm test
```

## How this maps to WhatsApp

The dashboard is a demo lens onto the same API the WhatsApp layer drives. In
production the identity tokens come from the **watcher** (signed from your
unofficial WhatsApp bridge), not the demo login — see
[`BLUEPRINT.md`](./BLUEPRINT.md) §6. The `/demo/*` routes and the dashboard are
gated by `DEMO_MODE=1` and never ship to production.

## ClickUp integration

Tasks synced from ClickUp show a **↗** link that opens directly in ClickUp.
The sync is bidirectional — status changes in the platform can be pushed back
to ClickUp via the `/clickup/sync` API.
