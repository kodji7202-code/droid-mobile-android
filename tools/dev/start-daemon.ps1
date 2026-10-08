# start-daemon.ps1 - start a detached `droid daemon` via WMI/CIM Win32_Process.Create.
#
# Usage (from the repo root):
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\dev\start-daemon.ps1 [-Port 3101]
#
# droid.exe is taken from -DroidExe, $env:DROIDMOBILE_DROID_EXE, PATH or %USERPROFILE%\bin.
#
# - The daemon survives the launching shell (children of plain Start-Process die with it).
# - Logs: .tmp\logs\daemon-<port>.out.log / .err.log; the cmd wrapper PID (the kill handle)
#   is written to .tmp\daemon-<port>.pid and printed.
# - Health check: GET http://127.0.0.1:<port>/health must return 200 ("factory-daemon ok").
# - Prints no secrets; the daemon is unauthenticated on loopback by design.
param(
  [int]$Port = 3101,
  [string]$DroidExe,
  [int]$HealthTimeoutSec = 30,
  [string]$StateDir
)

$ErrorActionPreference = 'Stop'
if (-not $DroidExe) {
  $onPath = Get-Command droid.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  $DroidExe = if ($env:DROIDMOBILE_DROID_EXE) { $env:DROIDMOBILE_DROID_EXE }
  elseif ($onPath) { $onPath.Source }
  else { Join-Path $env:USERPROFILE 'bin\droid.exe' }
}
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$logDir = Join-Path $repoRoot '.tmp\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
if (-not $StateDir) { $StateDir = Join-Path $repoRoot '.tmp' }
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
$pidFile = Join-Path $StateDir "daemon-$Port.pid"

function Test-DaemonHealth {
  param([int]$HealthPort)
  try {
    $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$HealthPort/health" -UseBasicParsing -TimeoutSec 3
    return ($resp.StatusCode -eq 200)
  } catch {
    return $false
  }
}

# Idempotence: if our PID file points at a live, healthy process, start nothing.
if (Test-Path $pidFile) {
  $existing = try { (Get-Content $pidFile -Raw | ConvertFrom-Json).pid } catch { $null }
  if ($existing -and (Get-Process -Id $existing -ErrorAction SilentlyContinue)) {
    if (Test-DaemonHealth -HealthPort $Port) {
      "daemon already running on port $Port (cmd pid $existing), healthy"
      exit 0
    }
    "ERROR: pid file $pidFile points at live pid $existing but /health fails; stop it with stop-daemon.ps1 or remove the file"
    exit 1
  }
}

if (-not (Test-Path $DroidExe)) {
  "ERROR: droid CLI not found at $DroidExe"
  exit 1
}

# Refuse to double-start when the port is held by something we did not record.
$listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listeners) {
  "ERROR: port $Port is already in use by pid(s) $($listeners.OwningProcess -join ','); not starting"
  exit 1
}

$outLog = Join-Path $logDir "daemon-$Port.out.log"
$errLog = Join-Path $logDir "daemon-$Port.err.log"
$inner = '"' + $DroidExe + '" daemon --host 127.0.0.1 --port ' + $Port + ' > "' + $outLog + '" 2> "' + $errLog + '"'
$cmdLine = 'cmd /s /c "' + $inner + '"'

$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  CommandLine      = $cmdLine
  CurrentDirectory = $logDir
}
if ($result.ReturnValue -ne 0) {
  "ERROR: Win32_Process.Create returned $($result.ReturnValue)"
  exit 1
}

$wrapperPid = $result.ProcessId
$startTime = (Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $wrapperPid").CreationDate.ToUniversalTime().ToString('o')
@{ pid = $wrapperPid; startTime = $startTime } | ConvertTo-Json -Compress | Set-Content -Path $pidFile -Encoding ASCII
"daemon cmd pid $wrapperPid"

# Cold start takes a few seconds; fail fast if the wrapper process already exited.
$deadline = (Get-Date).AddSeconds($HealthTimeoutSec)
$healthy = $false
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 800
  if (Test-DaemonHealth -HealthPort $Port) { $healthy = $true; break }
  if (-not (Get-Process -Id $wrapperPid -ErrorAction SilentlyContinue)) { break }
}

if ($healthy) {
  "daemon healthy on port $Port"
  exit 0
}

"ERROR: daemon on port $Port not healthy after $HealthTimeoutSec s; last log lines:"
if (Test-Path $errLog) { Get-Content $errLog -Tail 15 }
if (Test-Path $outLog) { Get-Content $outLog -Tail 15 }
# Clean up our own failed start so the port is free for a retry.
taskkill /PID $wrapperPid /T /F 2>$null
Remove-Item $pidFile -ErrorAction SilentlyContinue
exit 1
