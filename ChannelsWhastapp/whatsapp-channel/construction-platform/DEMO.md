# Running the demo on your own machine

Three ways to see the platform working — all run on **your** infrastructure, no
external services.

> **Presenting live?** Follow [`DEMO_SCRIPT.md`](./DEMO_SCRIPT.md) — a timed
> ~10-minute walkthrough (client transparency → AI assistant → manager → close).

Two URLs once the server is up:
- **Portal:** http://localhost:4000/app/
- **AI assistant (WhatsApp simulator):** http://localhost:4000/app/bot.html

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

- **🧭 Pedro (gestor)** — **budget vs actual** with a per-category breakdown and a
  founder-only line-item table, 19 real ClickUp tasks grouped by area, 13 material
  requests, change orders + client selections pending approval. Can propose
  changes, approve materials, and generate AI client updates.

- **👤 Ilya (cliente)** — transparency: budget, **photo gallery + lightbox**,
  milestones, daily logs, tasks, materials. Approves **selections** (typed
  e-signature) and change orders — the money decisions. Cannot see worker actions.

- **👷 Franek (obra)** — posts daily logs (with photos), requests materials,
  advances his tasks. Cannot approve or see budget.

Every button is a real, role-gated API call — the server rejects unauthorized
actions regardless of what the UI shows.

## The AI assistant — http://localhost:4000/app/bot.html

A WhatsApp-style simulator wired to the **same agent** the real webhook uses.
Chat in plain language (PT/EN); the right panel shows the tool it picked and the
DB change it made:

- **Receives:** natural-language work logs, photos, **voice notes** (transcribed),
  material requests, task completions.
- **Gives:** project status, budget, pending lists with **tap-to-act buttons**,
  AI-written client updates.
- **Reaches out first:** the **🔔 Simular alertas (18h)** button shows the agent
  proactively messaging the right person about overdue tasks, pending approvals,
  and the daily update.

It also works over a **plain-text WhatsApp bridge**: interactive options degrade
to command hints (*"responda aprovar 13"*) the agent already understands.

## Run the tests

```bash
cd ChannelsWhastapp/whatsapp-channel/construction-platform/api
npm test
```

## Connecting real WhatsApp — the poller

To drive the platform from an actual WhatsApp number there's a standalone
poller in [`api/tools/whatsapp-poller/`](./api/tools/whatsapp-poller/). It
bridges a WhatsApp account to the API in both directions:

- **Inbound:** reads new incoming messages from your bridge, POSTs each to
  `/whatsapp/incoming`, and sends the AI reply back.
- **Outbound:** drains the proactive outbox (`/whatsapp/outbox`) and delivers
  those messages (the 6pm "reaches out first" alerts).

It ships with a **mock adapter** so you can watch the whole loop run against the
demo server with no real WhatsApp:

```bash
# Terminal 1 — the demo server (seed it by opening http://localhost:4000/app/ once)
cd api && npm run demo:server

# Terminal 2 — the poller, mock bridge, pointed at the demo
cd api/tools/whatsapp-poller
BRIDGE=mock API_URL=http://localhost:4000 \
  MOCK_INBOX=./mock-inbox.example.json \
  ALLOWED_NUMBERS=351900000009,351900000002 node poller.mjs
```

You'll see it forward each scripted message, get the assistant's reply, and
"send" it back. A real lharries `whatsapp-mcp` bridge is wired the same way with
`BRIDGE=whatsappMcp` — see the poller's
[`README.md`](./api/tools/whatsapp-poller/README.md) for the SQLite + Go-bridge
setup, the safety/allowlist model, and `--dry-run`.

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
