#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Install + configure the whatsapp-channel Claude Code plugin (Windows / PowerShell).

.DESCRIPTION
  One-shot, idempotent setup. Run it as many times as you like - it only fills gaps.
  Steps:
    1. Copy plugin (server.ts, package.json) into the Claude Code plugin cache
    2. bun install the dependency
    3. Create ~/.claude/channels/whatsapp/ and write .env + access.json (interactive)
    4. Merge the plugin registration + permissions into ~/.claude/settings.json (backed up)
    5. Check Evolution API is reachable and the instance is connected
    6. Smoke-test the plugin boot
  Nothing here talks to WhatsApp - that's the manual test sequence in TESTING.md.

.PARAMETER Verify
  Skip writing anything; just run the health checks (steps 5-6 + config presence).

.EXAMPLE
  pwsh ./setup.ps1
.EXAMPLE
  pwsh ./setup.ps1 -Verify
#>

[CmdletBinding()]
param(
  [switch]$Verify
)

$ErrorActionPreference = 'Stop'
function Info($m){ Write-Host "  $m" -ForegroundColor Gray }
function Ok($m)  { Write-Host "[OK]  $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[!!]  $m" -ForegroundColor Yellow }
function Die($m) { Write-Host "[XX]  $m" -ForegroundColor Red; exit 1 }
function Step($n,$m){ Write-Host "`n=== $n. $m ===" -ForegroundColor Cyan }
# Windows PowerShell 5.1's Set-Content -Encoding UTF8 prepends a BOM, which breaks
# the plugin's .env line parser and JSON.parse(access.json). Always write UTF-8 no-BOM.
function Write-TextNoBom($path, $text){
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $text, $enc)
}

# -- Paths --------------------------------------------------------------------
$SrcDir   = Join-Path $PSScriptRoot '2.0.0'
$StateSrc = Join-Path $PSScriptRoot 'channel-state'
$Cache    = Join-Path $env:USERPROFILE '.claude\plugins\cache\local\whatsapp-channel\2.0.0'
$StateDir = Join-Path $env:USERPROFILE '.claude\channels\whatsapp'
$EnvFile  = Join-Path $StateDir '.env'
$AccFile  = Join-Path $StateDir 'access.json'
$Settings = Join-Path $env:USERPROFILE '.claude\settings.json'

Write-Host "whatsapp-channel setup  (mode: $(if($Verify){'VERIFY'}else{'INSTALL'}))" -ForegroundColor White
Info "Plugin source : $SrcDir"
Info "Plugin cache  : $Cache"
Info "Channel state : $StateDir"

if (-not (Test-Path (Join-Path $SrcDir 'server.ts'))) {
  Die "Can't find 2.0.0\server.ts next to this script. Run it from ChannelsWhastapp\whatsapp-channel\."
}

# -- Tool checks --------------------------------------------------------------
$bun = Get-Command bun -ErrorAction SilentlyContinue
if (-not $bun) { Die "bun is not on PATH. Install Bun first: https://bun.sh" }

# =============================================================================
if (-not $Verify) {

  Step 1 "Copy plugin into the Claude Code cache"
  New-Item -ItemType Directory -Force -Path $Cache | Out-Null
  Copy-Item (Join-Path $SrcDir 'server.ts')    $Cache -Force
  Copy-Item (Join-Path $SrcDir 'package.json') $Cache -Force
  Ok "Copied server.ts + package.json"

  Step 2 "Install the dependency (bun install)"
  Push-Location $Cache
  try { & bun install | Out-Null; Ok "@modelcontextprotocol/sdk installed" }
  catch { Pop-Location; Die "bun install failed: $_" }
  Pop-Location

  Step 3 "Channel state (.env + access.json)"
  New-Item -ItemType Directory -Force -Path (Join-Path $StateDir 'inbox') | Out-Null

  if (Test-Path $EnvFile) {
    Warn ".env already exists - leaving it untouched. Delete it to reconfigure."
  } else {
    Info "Answer a few questions (press Enter to accept the [default])."
    $url   = Read-Host "Evolution API URL [http://localhost:8080]"
    if ([string]::IsNullOrWhiteSpace($url)) { $url = 'http://localhost:8080' }
    $key   = Read-Host "Evolution API KEY (required)"
    while ([string]::IsNullOrWhiteSpace($key)) { $key = Read-Host "  -> API key cannot be empty" }
    $inst  = Read-Host "Instance name [PedroW]"
    if ([string]::IsNullOrWhiteSpace($inst)) { $inst = 'PedroW' }
    $phones= Read-Host "Allowed phones, comma-separated, no + (e.g. 351915873259)"
    while ([string]::IsNullOrWhiteSpace($phones)) { $phones = Read-Host "  -> at least one number" }
    $start = Read-Host "Start keyword [ai_pedras]"
    if ([string]::IsNullOrWhiteSpace($start)) { $start = 'ai_pedras' }
    $stop  = Read-Host "Stop keyword [bye ai_pedras]"
    if ([string]::IsNullOrWhiteSpace($stop)) { $stop = 'bye ai_pedras' }

    $phonesClean = ($phones -split ',' | ForEach-Object { ($_ -replace '\D','') } | Where-Object { $_ }) -join ','

    $envText = @"
EVOLUTION_API_URL=$url
EVOLUTION_API_KEY=$key
INSTANCE_NAME=$inst
ALLOWED_PHONES=$phonesClean
START_KEYWORD=$start
STOP_KEYWORD=$stop
POLL_INTERVAL_MS=3000
RICH_TEXT=on
"@
    Write-TextNoBom $EnvFile $envText
    Ok "Wrote $EnvFile"
  }

  if (Test-Path $AccFile) {
    Warn "access.json already exists - leaving it untouched."
  } else {
    # Build allowFrom from the phones we just stored in .env
    $allowList = @()
    if (Test-Path $EnvFile) {
      $line = (Get-Content $EnvFile | Where-Object { $_ -match '^ALLOWED_PHONES=' })
      if ($line) { $allowList = ($line -replace '^ALLOWED_PHONES=','') -split ',' | Where-Object { $_ } }
    }
    $acc = [ordered]@{
      allowFrom      = @($allowList)
      sessionActive  = $false
      replyToMode    = "off"
      textChunkLimit = 4096
      chunkMode      = "newline"
      groups         = @{}
    }
    # ackEmoji intentionally omitted -> the plugin defaults it to the eye emoji,
    # keeping this script pure ASCII (Windows PowerShell 5.1 reads .ps1 as ANSI).
    Write-TextNoBom $AccFile ($acc | ConvertTo-Json -Depth 6)
    Ok "Wrote $AccFile (sessionActive=false - send the start keyword to begin)"
  }

  Step 4 "Register in settings.json"
  $allowPerms = @(
    'reply_whatsapp','send_reaction','download_media','send_presence',
    'edit_message','delete_message','mark_read','get_chat_info','get_session_status'
  ) | ForEach-Object { "mcp__plugin_whatsapp_channel_whatsapp_channel__$_" }

  # Recursively turn parsed JSON (PSCustomObject) into hashtables we can mutate.
  function ConvertTo-Hashtable($obj) {
    if ($null -eq $obj) { return @{} }
    if ($obj -is [System.Collections.IDictionary]) { return $obj }
    if ($obj -is [pscustomobject]) {
      $h = @{}
      foreach ($p in $obj.PSObject.Properties) { $h[$p.Name] = ConvertTo-Hashtable $p.Value }
      return $h
    }
    if ($obj -is [System.Collections.IEnumerable] -and $obj -isnot [string]) {
      return @($obj | ForEach-Object { ConvertTo-Hashtable $_ })
    }
    return $obj
  }

  $cfg = @{}
  if (Test-Path $Settings) {
    Copy-Item $Settings "$Settings.bak" -Force
    Info "Backed up existing settings.json -> settings.json.bak"
    try { $cfg = ConvertTo-Hashtable (Get-Content $Settings -Raw | ConvertFrom-Json) }
    catch { Die "Existing settings.json is not valid JSON. Fix or remove it, then re-run." }
  } else {
    New-Item -ItemType Directory -Force -Path (Split-Path $Settings) | Out-Null
  }

  $cfg['channelsEnabled'] = $true
  if (-not ($cfg['enabledPlugins'] -is [hashtable])) { $cfg['enabledPlugins'] = @{} }
  $cfg['enabledPlugins']['whatsapp-channel@local'] = $true
  if (-not ($cfg['permissions'] -is [hashtable])) { $cfg['permissions'] = @{} }
  $existingAllow = @()
  if ($cfg['permissions']['allow']) { $existingAllow = @($cfg['permissions']['allow']) }
  $cfg['permissions']['allow'] = @($existingAllow + $allowPerms | Select-Object -Unique)

  Write-TextNoBom $Settings ($cfg | ConvertTo-Json -Depth 12)
  Ok "Merged plugin + 9 permissions into settings.json"
}

# =============================================================================
Step 5 "Check Evolution API"
if (-not (Test-Path $EnvFile)) { Die "No .env at $EnvFile - run without -Verify first." }
$envMap = @{}
Get-Content $EnvFile | ForEach-Object {
  if ($_ -match '^\s*(\w+)\s*=\s*(.*)$') { $envMap[$matches[1]] = $matches[2].Trim() }
}
$EVO = $envMap['EVOLUTION_API_URL']; $KEY = $envMap['EVOLUTION_API_KEY']; $INST = $envMap['INSTANCE_NAME']
try {
  $resp = Invoke-RestMethod -Uri "$EVO/instance/fetchInstances" -Headers @{ apikey = $KEY } -TimeoutSec 8
  $items = @($resp)   # normalize single-object or array responses
  $me = $null
  foreach ($it in $items) {
    $name = $it.name; if (-not $name) { $name = $it.instanceName }; if (-not $name) { $name = $it.instance.instanceName }
    if ($name -eq $INST) { $me = $it; break }
  }
  if (-not $me) {
    Warn "Instance '$INST' not found in fetchInstances response. Instances present: $(@($items | ForEach-Object { $_.name; $_.instanceName; $_.instance.instanceName } | Where-Object { $_ }) -join ', ')"
  } else {
    # Connection state lives under different field names across Evolution versions.
    $state = $me.connectionStatus; if (-not $state) { $state = $me.state }
    if (-not $state) { $state = $me.status }; if (-not $state) { $state = $me.connectionState }
    if (-not $state) { $state = $me.instance.state }; if (-not $state) { $state = $me.instance.status }
    if (-not $state) { $state = $me.instance.connectionStatus }
    if (-not $state) { $state = 'unknown' }
    if ($state -eq 'open') { Ok "Evolution reachable; instance '$INST' state=open (WhatsApp linked)" }
    elseif ($state -eq 'unknown') { Warn "Evolution reachable; instance '$INST' found but state field not recognized. Check the Evolution Manager UI — if it shows 'Disconnect', you're connected and good to go." }
    else { Warn "Evolution reachable but '$INST' state=$state (need 'open' - scan the QR in Evolution)" }
  }
} catch {
  Warn "Could not reach $EVO/instance/fetchInstances : $($_.Exception.Message)"
  Info "Is Docker up? Try:  docker ps | findstr evolution"
}

Step 6 "Smoke-test the plugin boot"
$bootErr = Join-Path $env:TEMP 'wa-boot.err.log'
$bootOut = Join-Path $env:TEMP 'wa-boot.out.log'
try {
  $p = Start-Process -FilePath 'bun' -ArgumentList 'server.ts' -WorkingDirectory $Cache `
        -NoNewWindow -PassThru -RedirectStandardError $bootErr -RedirectStandardOutput $bootOut
  Start-Sleep -Seconds 2
  if (-not $p.HasExited) { $p.Kill() }
  $log = if (Test-Path $bootErr) { Get-Content $bootErr -Raw } else { '' }
  if ($log -match 'MCP connected') { Ok "Plugin boots and connects MCP" }
  elseif ($log -match 'EVOLUTION_API_KEY is empty') { Warn ".env didn't load - check $EnvFile" }
  else { Warn "Boot log didn't show 'MCP connected':`n$log" }
} catch { Warn "Smoke test could not run: $_" }
Remove-Item $bootErr,$bootOut -ErrorAction SilentlyContinue

Write-Host "`nDone." -ForegroundColor White
Write-Host "Next: launch 'claude', run /mcp (expect whatsapp-channel = connected)," -ForegroundColor White
Write-Host "then follow TESTING.md from your phone." -ForegroundColor White
