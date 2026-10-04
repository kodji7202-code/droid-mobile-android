# stop-daemon.ps1 - stop the daemon started by start-daemon.ps1.
#
# Usage (from the repo root, as referenced by services.yaml):
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\dev\stop-daemon.ps1 [-Port 3101]
#
# - Primary: taskkill the cmd wrapper PID recorded in .tmp\daemon-<port>.pid (/T kills the
#   daemon child tree). Only PIDs this tooling started are recorded, so only those stop.
# - Fallback (per services.yaml): when no PID file exists, stop the single process LISTENING
#   on this exact port. Never matches by process name.
param(
  [int]$Port = 3101
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$pidFile = Join-Path $repoRoot ".tmp\daemon-$Port.pid"

function Test-PortListening {
  param([int]$ListenPort)
  return [bool](Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction SilentlyContinue)
}

$stopped = $false

if (Test-Path $pidFile) {
  $wrapperPid = Get-Content $pidFile
  if ($wrapperPid -and (Get-Process -Id $wrapperPid -ErrorAction SilentlyContinue)) {
    taskkill /PID $wrapperPid /T /F | Out-Null
    Start-Sleep -Milliseconds 500
    if (Get-Process -Id $wrapperPid -ErrorAction SilentlyContinue) {
      "ERROR: pid $wrapperPid still alive after taskkill"
      exit 1
    }
    "stopped daemon on port $Port (cmd pid $wrapperPid)"
    $stopped = $true
  } else {
    "pid file $pidFile exists but its pid is gone"
  }
  Remove-Item $pidFile -ErrorAction SilentlyContinue
}

if (-not $stopped -and (Test-PortListening -ListenPort $Port)) {
  $owner = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty OwningProcess
  taskkill /PID $owner /T /F | Out-Null
  Start-Sleep -Milliseconds 500
  "stopped daemon on port $Port (port-owner pid $owner, no pid file present)"
  $stopped = $true
}

if (-not $stopped -and -not (Test-PortListening -ListenPort $Port)) {
  "nothing to stop on port $Port"
}

if (Test-PortListening -ListenPort $Port) {
  "ERROR: port $Port is still listening after stop attempts"
  exit 1
}
"port $Port free"
exit 0
