# Pedra & Luz — Demo Day Script

A tight, ~10-minute walkthrough you can present live. Everything runs locally on
pg-mem (no Docker, no internet). For setup see [`DEMO.md`](./DEMO.md).

---

## 0. Launch (30s before you present)

```bash
cd ChannelsWhastapp/whatsapp-channel/construction-platform/api
npm install        # first time only
npm run demo:server
```

Open two browser tabs:
- **Portal:** http://localhost:4000/app/
- **AI Assistant (WhatsApp simulator):** http://localhost:4000/app/bot.html

> The demo auto-seeds the **Santa Rita – Summer 2026** project (real ClickUp
> tasks, real materials list, budget, photos). Data resets on restart, so you
> can re-run the script cleanly any time.

The three demo people (top-right role switch):
- 🧭 **Pedro** — gestor / founder (command center)
- 👷 **Franek** — obra / worker (field)
- 👤 **Ilya** — cliente / customer (transparency + approvals)

---

## 1. The pitch in one sentence (15s)

> "Pedra & Luz is a WhatsApp-native operating system for construction. The whole
> site team — client, builder, manager — runs the project from the chat they
> already use. No app to install. And there's an AI assistant on the other end."

---

## 2. The client's view — transparency (90s) · Portal tab, role = 👤 Ilya

Walk down the page:
- **Hero + budget card** — total €85 000, **spent vs remaining** with a progress
  bar, and a **per-category breakdown** (Exterior, Eléctrica, Interior…). "The
  client always knows where the money is."
- **📸 Gallery** — site photos from the daily logs; click one → **lightbox**,
  arrow-key through them.
- **🎨 Selecções** — the client approves a finish (e.g. kitchen countertop) with
  a **typed e-signature**. Click **aprovar**, pick an option, sign. "That's an
  ESIGN/UETA-valid sign-off, captured with name + timestamp."
- **📅 Milestones, ✅ Tasks, 🧱 Materials** — read-only for the client.

Key line: *"Everything the client sees is a real, role-gated API call. They
physically cannot see worker actions or change another person's data."*

---

## 3. The AI assistant — the star (4 min) · Bot tab

This is the WhatsApp simulator: type like you would in WhatsApp; the right-hand
panel shows **what the assistant actually did** (which tool, which DB change).

### As 👷 Franek (worker) — *get* (the bot receives)
Type (or tap the suggestion chips):
1. `pintámos o portão hoje, 2 pessoas, 8h` — **logs the day**, parses crew + hours.
2. Click 📎 then send a message — attaches a **photo** to the log.
3. Click 🎙️, say `preciso de 10 sacos de cimento, urgente` — a **voice note** is
   transcribed and becomes a **material request** (qty + urgency parsed).
4. `que tarefas tenho?` — lists his tasks with **one-tap "✓ done" buttons**. Tap one.

> Point out: "He never learned a single command. He just talked. And a voice
> note turned into a structured material request."

### As 🧭 Pedro (founder) — *give* (the bot delivers) + act
Switch role to Pedro (top-right):
5. `como está o orçamento?` — budget summary in chat.
6. `que materiais faltam?` — pending list with a **tappable approve list**. Tap to
   approve one. (Over a real text-only WhatsApp bridge this shows as
   *"responda aprovar 13"* — same action, no buttons needed.)
7. `resumo para o cliente` — the **AI writes a client update** for the day, ready
   to send.
8. Tap **🔔 Simular alertas (18h)** — the bot **reaches out first**: overdue
   tasks → Pedro + Franek, pending approvals → Pedro, decisions + daily update →
   Ilya. The action panel lists every outbound message and its recipient.

> Punchline: *"It doesn't just answer — at 6pm it messages the right person about
> the right thing, automatically. That's the difference between a chatbot and a
> site foreman."*

---

## 4. The manager's command center (60s) · Portal tab, role = 🧭 Pedro

- Full **budget vs actual** with the founder-only **line-item table** (expand
  "Ver itens detalhados") — add/edit actual costs live.
- **19 ClickUp tasks** grouped by area, each with a **↗** link back to ClickUp.
- **Materials** with approve/deny; **change orders** the client decides on.
- **⚙️ Admin** (footer) — manage users, names, roles, and **editable phone numbers**.

---

## 5. The honest engineering close (45s)

- **Role security:** *"The server enforces every permission. A worker asking for
  the budget is refused even though I could type it — let me show you."* (As
  Franek: `qual é o orçamento?` → it won't reveal figures.)
- **Works offline / no lock-in:** *"The AI has a deterministic fallback — the bot
  works with zero API cost, and gets smarter when we plug Claude in."*
- **Tested:** `npm test` → **196 passing**, including the AI agent, budget math,
  e-signatures, and the proactive alerts.
- **Bridge-ready:** *"It speaks plain WhatsApp through your existing bridge —
  inbound to one webhook, outbound from a queue. No Meta account required to start."*

---

## Backup Q&A — likely questions

- **"Does it do invoices for Portugal?"** Yes, but correctly: QuickBooks/Xero are
  **not** AT-certified. We issue legal invoices via a certified provider
  (InvoiceXpress/Moloni — ATCUD + QR + SAF-T); California uses QuickBooks. Pluggable
  per region. *(Roadmap.)*
- **"What if there's no internet on site?"** Logs/photos queue; the assistant's
  understanding has an offline fallback.
- **"Which WhatsApp number?"** Your existing bridge number — co-exists with the
  WhatsApp Business app; no migration.
- **"Can each partner firm brand it?"** On the roadmap, but the data shows clients
  buy it for the transparency + cost control first, not white-label.

---

## If something goes sideways

- Bot tab blank / "Sem projectos" → the seed didn't run; reload the Portal tab
  once (it calls `/demo/seed`), then reload the Bot tab.
- Restart for a clean slate: `Ctrl+C` then `npm run demo:server` again.
- Port busy → `PORT=4001 npm run demo:server` and use `:4001` in the URLs.
