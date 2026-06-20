# Running the demo on your own machine

Two ways to see the platform working — both run on **your** infrastructure, no
external services.

## Option A — Full stack (Docker: real Postgres + API + dashboard)

This is the production-shaped artifact: a real Postgres database, the API
running migrations on boot, and the browser dashboard.

```bash
cd ChannelsWhastapp/whatsapp-channel/construction-platform
docker compose up --build
```

Then open **http://localhost:4000/app/** in your browser.

You'll land on the **founder** view of project *Vila Sol*. Use the buttons in the
top-right to switch identity:

- **👤 Maria (cliente)** — read-only transparency: project status, milestones,
  daily photos/logs, tasks, materials. She sees only her own project.
- **👷 João (obra)** — can post a daily log, request materials, and advance his
  assigned task (todo → doing → done).
- **🧭 Pedro (gestor)** — can approve/deny material requests (watch *Cement*
  move `requested → ordered`).

Every button is a real, role-gated API call — try acting as Maria and you'll see
the worker/founder actions simply aren't offered (and the server would reject
them anyway). Data persists in Postgres across restarts.

Stop with `Ctrl+C`; wipe data with `docker compose down -v`.

## Option B — Headless transcript (no Docker)

A scripted end-to-end run against an in-memory Postgres that prints every
request and response:

```bash
cd construction-platform/api
npm install
npm run demo
```

You'll see 15 steps covering project creation, logs+photos, customer
transparency, the privacy gate (a stranger gets `404`), task assignment + audit
trail, and material approval — each with its live HTTP status.

## Run the tests

```bash
cd construction-platform/api
npm test        # 29 tests, all green
```

## How this maps to WhatsApp

The dashboard is a demo lens onto the same API the WhatsApp layer drives. In
production the identity tokens come from the **watcher** (signed from your
unofficial WhatsApp bridge), not the demo login — see
[`BLUEPRINT.md`](./BLUEPRINT.md) §6. The `/demo/*` routes and the dashboard are
gated by `DEMO_MODE=1` and never ship to production.
