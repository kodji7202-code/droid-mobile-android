# supervisor.ps1 - keeps one `droid daemon --host 127.0.0.1 --port <Port>` alive.
#
# Started detached by Start-DroidDaemon; not meant to be run by hand. It owns exactly one
# daemon child: it records the supervisor and daemon PIDs under StateDir, restarts the daemon
# after a crash or a hung /health, and never looks at any other process.
param(
  [Parameter(Mandatory)][int]$Port,
  [Parameter(Mandatory)][string]$DroidExe,
  [Parameter(Mandatory)][string]$StateDir
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\Common.ps1')

$logDir = Join-Path $StateDir 'logs'
Initialize-DhDirectory $logDir
$supLog = Join-Path $logDir "supervisor-$Port.log"
$outLog = Join-Path $logDir "daemon-$Port.out.log"
$errLog = Join-Path $logDir "daemon-$Port.err.log"
$pidFile = Join-Path $StateDir "daemon-$Port.pid"
$recordFile = Join-Path $StateDir "daemon-$Port.json"

# One supervisor per port, even if two Start-DroidDaemon calls race.
$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, "Global\DroidMobileHelper-daemon-$Port", [ref]$createdNew)
if (-not $createdNew) {
  Write-DhLogLine $supLog "another supervisor already owns port $Port; exiting"
  exit 0
}

$minRestartDelaySec = 1
$maxRestartDelaySec = 15
$healthGraceSec = 30
$healthFailuresToRestart = 6
$giveUpAfterFastExits = 10
$fastExitSec = 5

$self = Get-DhProcessInfo -ProcessId $PID
$record = [ordered]@{
  port            = $Port
  supervisorPid   = $PID
  supervisorStart = (Get-DhStartTime $self)
  daemonPid       = 0
  daemonStart     = $null
  restarts        = 0
}
Write-DhJsonFile $recordFile $record
Write-DhLogLine $supLog "supervisor started pid=$PID port=$Port exe=$DroidExe"

$daemon = $null
$fastExits = 0
$delay = $minRestartDelaySec

try {
  while ($true) {
    foreach ($log in @($outLog, $errLog)) {
      if (Test-Path -LiteralPath $log) { Move-Item -LiteralPath $log -Destination "$log.prev" -Force }
    }
    $daemon = Start-Process -FilePath $DroidExe `
      -ArgumentList @('daemon', '--host', '127.0.0.1', '--port', "$Port") `
      -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput $outLog -RedirectStandardError $errLog
    $startedAt = Get-Date
    # Touching Handle caches it; without this ExitCode comes back empty for Start-Process -PassThru.
    $null = $daemon.Handle
    $info = Get-DhProcessInfo -ProcessId $daemon.Id
    $record.daemonPid = $daemon.Id
    $record.daemonStart = if ($info) { Get-DhStartTime $info } else { $null }
    Write-DhJsonFile $recordFile $record
    Set-Content -LiteralPath $pidFile -Value $daemon.Id -Encoding ASCII
    Write-DhLogLine $supLog "daemon started pid=$($daemon.Id) restarts=$($record.restarts)"

    $failures = 0
    $killedForHealth = $false
    while (-not $daemon.WaitForExit(2000)) {
      if (((Get-Date) - $startedAt).TotalSeconds -lt $healthGraceSec) { continue }
      if (Test-DhDaemonHealth -Port $Port) { $failures = 0; continue }
      $failures++
      if ($failures -ge $healthFailuresToRestart) {
        Write-DhLogLine $supLog "daemon pid=$($daemon.Id) alive but /health failed $failures times; killing it"
        Stop-DhProcessTree -ProcessId $daemon.Id
        $killedForHealth = $true
        break
      }
    }
    $daemon.WaitForExit()

    $ranSec = ((Get-Date) - $startedAt).TotalSeconds
    $why = if ($killedForHealth) { 'killed after failed health checks' } else { "exited code=$($daemon.ExitCode)" }
    Write-DhLogLine $supLog ("daemon pid={0} {1} after {2:N0}s" -f $daemon.Id, $why, $ranSec)
    Remove-Item -LiteralPath $pidFile -ErrorAction SilentlyContinue

    if ($ranSec -lt $fastExitSec) { $fastExits++ } else { $fastExits = 0; $delay = $minRestartDelaySec }
    if ($fastExits -ge $giveUpAfterFastExits) {
      Write-DhLogLine $supLog "daemon exited $fastExits times within $fastExitSec s each; giving up (see daemon-$Port.err.log)"
      break
    }
    Write-DhLogLine $supLog "restarting daemon in $delay s"
    Start-Sleep -Seconds $delay
    $delay = [Math]::Min($delay * 2, $maxRestartDelaySec)
    $record.restarts++
  }
} finally {
  # Only reached on a normal exit or a stop signal; a forced kill is cleaned up by Stop-DroidDaemon.
  if ($daemon -and -not $daemon.HasExited) { Stop-DhProcessTree -ProcessId $daemon.Id }
  Remove-Item -LiteralPath $pidFile -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $recordFile -ErrorAction SilentlyContinue
  Write-DhLogLine $supLog 'supervisor exiting'
  $mutex.ReleaseMutex()
}
