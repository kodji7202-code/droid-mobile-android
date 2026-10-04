# stop-daemon.ps1 - stop the daemon started by start-daemon.ps1, and nothing else.
#
# Usage (from the repo root, as referenced by services.yaml):
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\dev\stop-daemon.ps1 [-Port 3101]
#
# Only a process recorded in .tmp\daemon-<port>.pid is ever killed, and only after its
# identity is validated: the live process must have the recorded start time and a command
# line naming `daemon --host 127.0.0.1 --port <port>`. A port listener is never killed
# because of the port alone; with no valid record the script refuses and exits 1.
param(
  [int]$Port = 3101,
  [string]$StateDir
)

$ErrorActionPreference = 'Stop'
if (-not $StateDir) {
  $StateDir = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path '.tmp'
}
$pidFile = Join-Path $StateDir "daemon-$Port.pid"
$marker = "daemon --host 127.0.0.1 --port $Port"

function Test-PortListening {
  param([int]$ListenPort)
  return [bool](Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction SilentlyContinue)
}

if (-not (Test-Path $pidFile)) {
  if (Test-PortListening -ListenPort $Port) {
    "REFUSED: no daemon record for port $Port but something is listening; not killing a process I did not start"
    exit 1
  }
  "nothing to stop on port $Port (no record, port free)"
  exit 0
}

$raw = (Get-Content $pidFile -Raw -ErrorAction SilentlyContinue)
$record = $null
try { $record = $raw | ConvertFrom-Json } catch { }
if ($record -isnot [pscustomobject] -or -not $record.pid -or -not $record.startTime) {
  "REFUSED: $pidFile is not a valid daemon record; leaving it and all processes untouched"
  exit 1
}

$wrapperPid = [int]$record.pid
$proc = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $wrapperPid" -ErrorAction SilentlyContinue
if (-not $proc) {
  Remove-Item $pidFile -ErrorAction SilentlyContinue
  "recorded pid $wrapperPid is gone; removed stale record, nothing killed"
  if (Test-PortListening -ListenPort $Port) {
    "REFUSED: port $Port is held by a process I did not start"
    exit 1
  }
  exit 0
}

$liveStart = $proc.CreationDate.ToUniversalTime().ToString('o')
$recordedStart = ([datetime]$record.startTime).ToUniversalTime().ToString('o')
if ($liveStart -ne $recordedStart -or -not $proc.CommandLine -or $proc.CommandLine.IndexOf($marker) -lt 0) {
  Remove-Item $pidFile -ErrorAction SilentlyContinue
  "REFUSED: pid $wrapperPid no longer matches the recorded daemon (pid reuse); removed stale record, nothing killed"
  exit 1
}

taskkill /PID $wrapperPid /T /F | Out-Null
Start-Sleep -Milliseconds 500
if (Get-Process -Id $wrapperPid -ErrorAction SilentlyContinue) {
  "ERROR: pid $wrapperPid still alive after taskkill"
  exit 1
}
Remove-Item $pidFile -ErrorAction SilentlyContinue
"stopped daemon on port $Port (cmd pid $wrapperPid)"
if (Test-PortListening -ListenPort $Port) {
  "ERROR: port $Port is still listening after stop"
  exit 1
}
"port $Port free"
exit 0
