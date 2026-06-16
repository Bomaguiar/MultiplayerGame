# Testing the whatsapp-channel plugin

Two parts: `setup.ps1` automates install + config + health checks; this doc covers the
live phone tests it can't do for you.

---

## 1. Run the configurator

From `ChannelsWhastapp\whatsapp-channel\` in a **Windows PowerShell** terminal:

```powershell
pwsh ./setup.ps1
```

It will:
1. Copy the plugin into `~/.claude/plugins/cache/local/whatsapp-channel/2.0.0/` and `bun install`
2. Ask for your Evolution URL / API key / instance / allowed phones and write `.env` + `access.json`
3. Merge the plugin + 9 permissions into `~/.claude/settings.json` (backs up to `settings.json.bak`)
4. Check Evolution API is reachable and the instance state is `open`
5. Smoke-test the plugin boot (expects `MCP connected`)

Re-run any time — it skips anything already configured. To re-check health only without
writing anything:

```powershell
pwsh ./setup.ps1 -Verify
```

> Tip for your first run: put **only your own number** in "allowed phones" so nothing
> unexpected fires. Add Ilya later.

✅ End state: green `[OK]` lines for copy, install, settings; Evolution `state=open`;
boot shows `MCP connected`.

---

## 2. Confirm the plugin loads in Claude Code

```powershell
claude
```
In the prompt:
```
/mcp
```
✅ `whatsapp-channel` shows **connected**. If not, see Troubleshooting in `README.md`
(usually a path or name mismatch, or `channelsEnabled` not set).

---

## 3. Live message tests (from your phone → your own WhatsApp)

| # | Send from phone | Expect within ~3 s |
|---|---|---|
| **1 — start** | `ai_pedras` | Nothing appears in Claude (keyword is plugin-only). `access.json` → `"sessionActive": true`. Maybe a 👁️ reaction. |
| **2 — deliver** | `hello claude, what's up?` | A `<channel …>` block appears in the Claude conversation containing your text. |
| **3 — reply** | (in Claude) `reply to that whatsapp` | A message arrives back on your phone. |
| **4 — rich text** | (in Claude) `reply with a **bold** word, a 2-item bullet list, and a link to https://example.com` | On your phone: real *bold*, • bullets, working link — **not** literal `**` or `-`. (This proves the rich-text fix.) |
| **5 — stop** | `bye ai_pedras` | `access.json` → `"sessionActive": false`. Further messages are ignored. |

Other tools to spot-check once the basics work:
- `react to that message with 👍` → `send_reaction`
- send yourself a photo, then in Claude: `download that image and describe it` → `download_media`
- `show me the whatsapp session status` → `get_session_status`

---

## 4. If something stalls

| Symptom | Check |
|---|---|
| No `<channel>` block (step 2) | Did you send `ai_pedras` first? Is your number in `ALLOWED_PHONES`? Run `claude 2>plugin-debug.log`, reproduce, read the log. |
| Reply never arrives (step 3) | Test Evolution directly: `curl -X POST $EVOLUTION_API_URL/message/sendText/$INSTANCE -H "apikey: KEY" -H "Content-Type: application/json" -d '{"number":"351915873259","text":"direct"}'`. If that lands but the tool doesn't, read the debug log. |
| Literal `**`/`-` on phone (step 4) | `RICH_TEXT` is `off` in `.env`, or the recipient's client is very outdated (set `CONFIG_SESSION_PHONE_VERSION` on the Evolution container). |
| Duplicate messages | A stale poller is alive: `Get-Process bun | Stop-Process`, then restart Claude. |
| Plugin missing from `/mcp` | `pwsh ./setup.ps1 -Verify`; confirm `channelsEnabled: true` and the cache path exists. |
