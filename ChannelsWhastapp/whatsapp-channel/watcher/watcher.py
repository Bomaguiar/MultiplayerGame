#!/usr/bin/env python3
"""
whatsapp-assistant watcher — token-optimal, event-driven.

Replaces the /loop. A plain Python process (NO LLM, zero tokens) tails the
whatsapp-mcp SQLite DB and gates every message in code. It only spins up a
short-lived `claude -p` when there is genuine freeform/connector work; everything
deterministic (menu, AI_start/AI_end, @help, terminal commands, sim/nao
confirmations) is answered directly through the bridge's REST API for free.

Token cost:
  - idle / non-allowlisted / inactive / AI_start / @help / "! cmd"  -> 0 tokens
  - "? question" or plain chat   -> one cheap `claude -p` (Haiku, MCP disabled)
  - cu / cal / mail / @projetos  -> one `claude -p` (Sonnet, connectors enabled)

Run it once and leave it open:  python watcher.py
Stop with Ctrl+C.
"""

import json, os, re, sqlite3, subprocess, sys, time, urllib.request
from pathlib import Path

# ── Config ───────────────────────────────────────────────────────────────────
DB_PATH    = r"E:\whatsapp-mcp\whatsapp-bridge\store\messages.db"
SEND_URL   = "http://localhost:8080/api/send"
STATE_FILE = Path(os.path.expanduser("~")) / ".claude" / "whatsapp-assistant.json"
EMPTY_MCP  = Path(os.path.expanduser("~")) / ".claude" / "empty-mcp.json"
POLL_SECONDS   = 5
MODEL_SIMPLE   = "haiku"     # ? questions + plain chat (no connectors needed)
MODEL_CONNECT  = "sonnet"    # cu / cal / mail / @projetos (needs MCP connectors)
CLAUDE_BIN     = "claude"    # must be on PATH
PROCESSED_CAP  = 500

MENU = """🤖 Claude · Assistente Pessoal
━━━━━━━━━━━━━━━━━━━━━

💻 Terminal
! <comando> → executa no PC

📋 ClickUp
cu tasks → todas as tarefas abertas
cu tasks <proj> → filtrar por projecto
cu done <tarefa> → marcar como ✅
cu add <tarefa> em <lista> → criar nova

📅 Calendário
cal hoje → agenda de hoje
cal semana → esta semana
cal add <evento> → criar evento

📧 Email
mail inbox → emails recentes
mail de <nome> → de alguém
mail busca <assunto> → pesquisar

🧠 IA & Conversa
? <pergunta> → resposta directa
(sem prefixo) → conversa normal

⚙️ Sistema
@help → este menu
@projetos → listar espaços ClickUp
@memoria → o que sei desta sessão

⚠️ Aprovações
Comandos perigosos pedem confirmação
→ responde sim ou não"""

# Commands that must NEVER run without an explicit "sim".
DANGER = re.compile(
    r"\b(rm|rmdir|del|erase|format|mkfs|dd|shutdown|restart|reboot|"
    r"taskkill|reg\s+delete|rd|move|mv)\b|--hard|git\s+push|>\s*\S|del\s+/",
    re.IGNORECASE,
)

# ── State ────────────────────────────────────────────────────────────────────
def load_state():
    try:
        s = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        s = {}
    s.setdefault("allow", [])
    s.setdefault("activeChats", {})
    s.setdefault("pendingConfirm", {})
    s.setdefault("processedIds", [])
    s.setdefault("primed", False)
    return s

def save_state(s):
    s["processedIds"] = s["processedIds"][-PROCESSED_CAP:]
    STATE_FILE.write_text(json.dumps(s, ensure_ascii=False, indent=2), encoding="utf-8")

# ── Helpers ──────────────────────────────────────────────────────────────────
def digits(jid: str) -> str:
    local = (jid or "").split("@")[0].split(":")[0]
    return re.sub(r"\D", "", local)

def is_allowed(sender, chat_jid, allow):
    a = {re.sub(r'\D', '', x) for x in allow}
    return digits(sender) in a or digits(chat_jid) in a

def send_wa(recipient: str, message: str):
    body = json.dumps({"recipient": recipient, "message": message}).encode("utf-8")
    req = urllib.request.Request(SEND_URL, data=body,
                                 headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=20).read()
        print(f"  → sent to {recipient} ({len(message)} chars)")
    except Exception as e:
        print(f"  !! send failed: {e}")

def run_shell(cmd: str) -> str:
    try:
        p = subprocess.run(["powershell", "-NoProfile", "-Command", cmd],
                           capture_output=True, text=True, timeout=120)
        out = (p.stdout or "") + (("\n" + p.stderr) if p.stderr else "")
        out = out.strip() or "(sem output)"
    except subprocess.TimeoutExpired:
        out = "⏱️ comando excedeu 120s"
    except Exception as e:
        out = f"erro: {e}"
    return out[:1500]

def ask_claude(text: str, connectors: bool) -> str:
    """One short-lived headless Claude call. Returns ONLY the reply text."""
    prompt = (
        "És o assistente pessoal do utilizador no WhatsApp. Responde em português, "
        "curto e claro, em texto simples para telemóvel (podes usar *negrito*). "
        "Faz a tarefa pedida e escreve APENAS a mensagem a enviar, nada mais.\n\n"
        f"Pedido: {text}"
    )
    cmd = [CLAUDE_BIN, "-p", prompt, "--model",
           MODEL_CONNECT if connectors else MODEL_SIMPLE]
    if not connectors:
        # Disable all MCP servers -> minimal tool-definition tokens for pure Q&A.
        if not EMPTY_MCP.exists():
            EMPTY_MCP.write_text('{"mcpServers":{}}', encoding="utf-8")
        cmd += ["--strict-mcp-config", "--mcp-config", str(EMPTY_MCP)]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        reply = (p.stdout or "").strip()
        return reply or "⚠️ Sem resposta."
    except subprocess.TimeoutExpired:
        return "⏱️ O pedido demorou demasiado."
    except Exception as e:
        return f"⚠️ Erro: {e}"

def needs_connectors(text: str) -> bool:
    t = text.lower()
    return (t.startswith(("cu ", "cal ", "mail "))
            or t in ("@projetos", "@memoria")
            or t.startswith(("@projetos", "@memoria")))

# ── Per-message handling ─────────────────────────────────────────────────────
def handle(msg, state):
    mid, chat, sender, content = msg
    text = (content or "").strip()
    chat = chat or sender

    if not is_allowed(sender, chat, state["allow"]):
        return  # silent drop, non-allowlisted

    low = text.lower()

    # Pending sim/nao confirmation for a dangerous terminal command.
    pend = state["pendingConfirm"].get(chat)
    if pend is not None:
        del state["pendingConfirm"][chat]
        if low == "sim":
            send_wa(chat, "▶️ A executar...\n\n" + run_shell(pend))
        else:
            send_wa(chat, "❌ Cancelado.")
        return

    if low == "ai_start":
        state["activeChats"][chat] = True
        send_wa(chat, MENU)
        return
    if low == "ai_end":
        state["activeChats"].pop(chat, None)
        send_wa(chat, "👋 Sessão terminada. Envia *AI_start* para recomeçar.")
        return

    if not state["activeChats"].get(chat):
        return  # inactive chat — only AI_start wakes it

    if low == "@help":
        send_wa(chat, MENU); return

    if text.startswith("!"):
        cmd = text[1:].strip()
        if not cmd:
            send_wa(chat, "Usa: ! <comando>"); return
        if DANGER.search(cmd):
            state["pendingConfirm"][chat] = cmd
            send_wa(chat, f"⚠️ Confirmar:\n`{cmd}`\n\nResponde *sim* ou *não*.")
        else:
            send_wa(chat, run_shell(cmd))
        return

    # Everything else escalates to a short-lived Claude call.
    send_wa(chat, ask_claude(text, connectors=needs_connectors(text)))

# ── Main loop ────────────────────────────────────────────────────────────────
def tick(state):
    con = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, timeout=10)
    try:
        rows = con.execute(
            "SELECT id, chat_jid, sender, content FROM messages "
            "WHERE is_from_me = 0 ORDER BY timestamp DESC LIMIT 80"
        ).fetchall()
    finally:
        con.close()

    seen = set(state["processedIds"])
    fresh = [r for r in rows if r[0] not in seen]
    if not fresh:
        return
    fresh.reverse()  # oldest first

    if not state["primed"]:
        # First run: swallow existing backlog, never replay history.
        for r in fresh:
            state["processedIds"].append(r[0])
        state["primed"] = True
        print(f"Primed {len(fresh)} existing messages (no replay).")
        save_state(state)
        return

    for r in fresh:
        print(f"msg {r[0][:8]} from {r[2]}: {(r[3] or '')[:40]!r}")
        try:
            handle(r, state)
        except Exception as e:
            print(f"  !! handle error: {e}")
        state["processedIds"].append(r[0])
    save_state(state)

def main():
    if not Path(DB_PATH).exists():
        sys.exit(f"DB not found: {DB_PATH}")
    print(f"watcher up — polling every {POLL_SECONDS}s. Ctrl+C to stop.")
    while True:
        try:
            tick(load_state())
        except Exception as e:
            print(f"tick error: {e}")
        time.sleep(POLL_SECONDS)

if __name__ == "__main__":
    main()
