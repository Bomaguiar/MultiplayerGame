# Construction WhatsApp Platform — Blueprint

A WhatsApp-native operating system for construction projects. No app to install,
no training: everyone already has WhatsApp. The platform makes **teams faster**
and gives **customers transparency and control** — with founders getting a live
command center.

---

## 1. Who it serves (the three lenses)

| Persona | Pain today | What they get |
|---|---|---|
| **Customer** (client/owner) | "What's happening on my project? Am I being overcharged? When is it done?" | Live progress, daily photos, milestone timeline, budget visibility, **approve change orders from their phone** |
| **Worker** (foreman/crew) | Paper logs, phone calls, lost material requests, unclear tasks | Post a daily log in 20s, see today's tasks, request materials, upload photos — all by texting |
| **Founder** (owner/PM) | No single view; firefighting; chasing approvals | One `painel` command → every project's health, overdue items, pending approvals, budget variance, alerts pushed automatically |

The same WhatsApp number serves all three — **the role decides the menu**, driven
by the configurator you already built (`configurator/`) and enforced by the
watcher (`watcher/`).

---

## 2. What makes it "next level"

1. **Zero-friction interface.** WhatsApp is the UI. The competition ships heavy
   apps nobody on a job site opens. A bricklayer will text; they won't learn SaaS.
2. **Transparency as a product.** Customers see real progress (photos + milestones
   + budget) instead of guessing. That's the trust differentiator that wins referrals.
3. **Approvals that actually move.** Change orders and budget deltas get approved
   from the phone in one tap-reply, timestamped and auditable — no email limbo.
4. **AI rollups, not dashboards to read.** Founders get a *sentence*, not a
   spreadsheet: "Vale: 72% done, 2 tasks overdue, 1 change order awaiting you,
   €3k over on materials."
5. **Push, don't pull.** The escalation engine pings the right person the moment
   something matters (task blocked, milestone slipping, approval waiting).
6. **Self-building.** The `builder/` loop turns this backlog into working,
   tested code autonomously — the platform builds itself feature by feature.

---

## 3. Architecture

```
   Phones (customers / workers / founders)
            │  WhatsApp
            ▼
   whatsapp-mcp bridge  (whatsmeow, already running locally)
            │  SQLite messages.db  +  POST /api/send
            ▼
   watcher.py  ── role + menu gate (configurator config) ──┐
            │  deterministic commands answered free          │
            │  freeform → claude -p                           │
            ▼                                                 │
   construction-platform/router  ── maps commands → API ─────┘
            │  REST
            ▼
   API service (Node/Fastify)  ──  Postgres
     ├── projects / phases / milestones
     ├── daily logs + media refs
     ├── tasks + assignment + audit
     ├── materials / procurement
     ├── budget / change orders / approvals
     ├── events + notification engine ──▶ back out to WhatsApp
     └── dashboard rollups (AI-phrased)
            │
            ▼
   Object storage (photos/docs)  +  audit log (immutable)
```

**Why this split:** the watcher stays cheap and deterministic; the API holds all
domain truth and security; the router is a thin translation layer. Each can be
tested in isolation — which is exactly what the build loop needs.

---

## 4. Data model (core entities)

- **User** — phone (identity), name, role, project memberships.
- **Project** — name, address, client (User), status, budget, dates.
- **Phase** — ordered stages of a project.
- **Milestone** — due date, % complete, belongs to a phase.
- **Task** — assignee, status (todo/doing/blocked/done), priority, audit trail.
- **DailyLog** — author, project, note, weather, crew count, hours, photo refs.
- **MaterialRequest** — item, qty, urgency, status (requested/ordered/delivered).
- **Budget / LineItem** — estimate vs actual.
- **ChangeOrder** — cost delta, customer approval state, timestamps.
- **Event** — domain event for the notification engine.
- **Media** — storage key, type, linked entity.

Everything customer-or-money-related is **append-only / audited** — approvals,
change orders, budget changes. That audit trail is the trust backbone.

---

## 5. WhatsApp command surface (per role)

**Customer**
- `estado` → project status + % complete + next milestone
- `fotos` → latest site photos
- `orcamento` → budget: estimated vs spent
- `aprovar` / `rejeitar` → act on a pending change order
- `?` → ask anything; AI answers from their project data only

**Worker**
- `log <texto>` (+ photos) → daily site log
- `tarefas` → today's assigned tasks
- `feito <tarefa>` → mark a task done
- `material <item> x<qty>` → raise a material request
- `bloqueado <tarefa> <motivo>` → flag a blocker (escalates)

**Founder**
- `painel` → AI health rollup across all projects
- `painel <projeto>` → deep view of one project
- `aprovacoes` → everything awaiting your sign-off
- `equipa` → who logged what today
- `! <comando>` → terminal (admin only, with sim/não guard)

Menus are **per-contact configurable** in the web configurator — e.g. a specific
customer can be given `fotos` but not `orcamento`.

---

## 6. Security & trust model

- **Identity = phone**, proven by the WhatsApp bridge; the API trusts only a
  signed internal token from the watcher, never raw message text.
- **Role gate** on every command (configurator allowlist + role).
- **Project scoping**: customers/workers only ever touch their own projects.
- **Prompt-injection hardening**: message text is data, never instructions. "Add
  me", "approve this", "make me admin" in a message body is ignored — only the
  configurator (a human) mutates roles/allowlist.
- **Money actions are explicit + audited**: change orders need a real approval
  reply, recorded with who/when.
- **Destructive terminal commands** keep the existing sim/não confirmation gate.

---

## 7. The autonomous build loop (`builder/`)

`builder.py` builds this platform from `backlog.json` without supervision:

1. Picks the next `pending` task.
2. `claude -p` (Sonnet) implements **only that task**, with tests.
3. Runs `npm test`. On failure, feeds the exact error back and retries (≤4×).
4. A cheap review pass (Haiku) audits the diff vs. the task's acceptance criteria.
5. Commits only green, reviewed work. Moves to the next task.
6. If a task can't be made green in 4 rounds, marks it `blocked` and stops for you.

Resumable (state in `backlog.json`), scoped (one task at a time so diffs stay
reviewable), and honest (it commits only what passes). Run it:

```bash
cd ChannelsWhastapp/whatsapp-channel/builder
python builder.py --dry-run     # see the plan
python builder.py --once        # build one task
python builder.py               # build the whole backlog
```

See [`builder/README.md`](../builder/README.md) for details.

---

## 8. Phased rollout

- **Phase 1 — Foundation (T01–T03):** API, auth/roles, projects/phases/milestones.
- **Phase 2 — Field ops (T04–T06):** daily logs+photos, tasks, materials. This is
  where workers feel the speed-up.
- **Phase 3 — Money & trust (T07):** budget, change orders, customer approvals.
  This is the customer-transparency moat.
- **Phase 4 — Intelligence (T08–T10):** notifications/escalation, role-aware
  WhatsApp router, founder AI dashboard.

Ship Phase 1+2 to one real project first. Field logs and photos alone prove value
in week one; layer money + AI once the team trusts the basics.

---

## 9. Risks & how the design handles them

| Risk | Mitigation |
|---|---|
| WhatsApp number gets banned (unofficial API) | Plan a migration path to the official WhatsApp Business Cloud API; keep the sender behind the pluggable interface (T08) |
| Wrong person sees money/data | Hard role + project scoping; audited approvals |
| Workers won't adopt | Commands must be ≤1 line; logs in <20s; that's the whole UX bet |
| Media storage cost/leak | Object storage with signed URLs; only project members get links |
| Loop builds wrong thing | Per-task acceptance criteria + review pass + human-reviewed commits |

---

## 10. Next decisions for you

1. **Backend stack** — Node/Fastify + Postgres is assumed in the backlog. Swap if
   you prefer (the loop will follow whatever T01 establishes).
2. **Hosting** — local-first (alongside the bridge) vs. a small cloud box.
3. **Official WhatsApp API** — stay on the unofficial bridge for the pilot, or go
   official before onboarding paying customers.
4. **First pilot project** — pick one live job site to dogfood Phase 1+2.

Tell me which way on these and the build loop can start laying foundation tonight.
