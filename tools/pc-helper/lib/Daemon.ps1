function Resolve-DhDroidExe {
  param([string]$DroidExe)
  if ($DroidExe) { return $DroidExe }
  if ($env:DROIDMOBILE_DROID_EXE) { return $env:DROIDMOBILE_DROID_EXE }
  $command = Get-Command droid.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($command) { return $command.Source }
  $fallback = Join-Path $env:USERPROFILE 'bin\droid.exe'
  if (Test-Path -LiteralPath $fallback) { return $fallback }
  return $null
}

function Test-DhSupervisorAlive {
  # True only for the recorded process: same start time and a supervisor.ps1 command line for this port.
  param($Record, [int]$Port)
  if (-not $Record -or -not $Record.supervisorPid) { return $false }
  $info = Get-DhProcessInfo -ProcessId ([int]$Record.supervisorPid)
  if (-not $info -or -not $info.CommandLine) { return $false }
  if (-not (Test-DhSameInstant (Get-DhStartTime $info) $Record.supervisorStart)) { return $false }
  return ($info.CommandLine.IndexOf('supervisor.ps1') -ge 0 -and $info.CommandLine -match "-Port $Port(\s|$)")
}

function Test-DhDaemonProcess {
  # Identity check for a daemon PID before it is ever killed. A desktop daemon (`--listen ipc`)
  # can never match, because the command line must name this exact host and port.
  param([int]$ProcessId, [int]$Port)
  $info = Get-DhProcessInfo -ProcessId $ProcessId
  if (-not $info -or -not $info.CommandLine) { return $false }
  if ($info.CommandLine.IndexOf('--listen ipc') -ge 0) { return $false }
  return ($info.CommandLine.IndexOf("daemon --host 127.0.0.1 --port $Port") -ge 0)
}

function Remove-DhDaemonRecord {
  param([string]$StateDir, [int]$Port)
  Remove-Item -LiteralPath (Join-Path $StateDir "daemon-$Port.pid") -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $StateDir "daemon-$Port.json") -ErrorAction SilentlyContinue
}

function Start-DroidDaemon {
  <#
  .SYNOPSIS
    Starts a supervised, detached `droid daemon` on 127.0.0.1.
  .DESCRIPTION
    Launches supervisor.ps1 detached (it survives this shell), which runs
    `droid daemon --host 127.0.0.1 --port <Port>` and restarts it after a crash. Waits for
    GET /health to return "factory-daemon ok". Running it again reports "already running".
    Refuses a port that something else listens on and never touches any other daemon.
  .PARAMETER Port
    Loopback port for the daemon (3100-3199).
  .PARAMETER StateDir
    Where PID files, records and logs live. Default: %LOCALAPPDATA%\DroidMobileHelper
    (or $env:DROIDMOBILE_HELPER_HOME).
  .PARAMETER DroidExe
    Path to droid.exe. Default: $env:DROIDMOBILE_DROID_EXE, droid.exe on PATH, %USERPROFILE%\bin\droid.exe.
  .PARAMETER HealthTimeoutSec
    How long to wait for /health before giving up (default 20).
  .PARAMETER PassThru
    Return an object with the port and PIDs.
  .EXAMPLE
    Start-DroidDaemon -Port 3101
  #>
  [CmdletBinding(SupportsShouldProcess = $true)]
  param(
    [ValidateRange(3100, 3199)][int]$Port = 3101,
    [string]$StateDir,
    [string]$DroidExe,
    [ValidateRange(5, 120)][int]$HealthTimeoutSec = 20,
    [switch]$PassThru
  )

  $StateDir = Get-DhStateDir $StateDir
  $pidFile = Join-Path $StateDir "daemon-$Port.pid"
  $recordFile = Join-Path $StateDir "daemon-$Port.json"
  $record = Read-DhJsonFile $recordFile
  $deadline = (Get-Date).AddSeconds($HealthTimeoutSec)

  if ($record -and (Test-DhSupervisorAlive $record $Port)) {
    # Our supervisor is alive; give a restarting daemon time to come back before judging it.
    while (-not (Test-DhDaemonHealth -Port $Port) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
    if (-not (Test-DhDaemonHealth -Port $Port)) {
      throw((New-DhError "A supervisor for port $Port is running (pid $($record.supervisorPid)) but /health does not answer. See $StateDir\logs, or run Stop-DroidDaemon -Port $Port."))
    }
    $record = Read-DhJsonFile $recordFile
    $daemonPid = [int]$record.daemonPid
    Write-Host "Droid daemon already running on 127.0.0.1:$Port (daemon PID $daemonPid, supervisor PID $($record.supervisorPid))."
    $global:LASTEXITCODE = 0
    if ($PassThru) { return [pscustomobject]@{ Port = $Port; DaemonPid = $daemonPid; SupervisorPid = [int]$record.supervisorPid; AlreadyRunning = $true } }
    return
  }
  if ($record) {
    # Supervisor is gone: a leftover record from a crash or reboot.
    if (-not $WhatIfPreference) { Remove-DhDaemonRecord $StateDir $Port }
  }

  $listeners = @(Get-DhPortListeners -Port $Port)
  if ($listeners.Count -gt 0) {
    $owners = ($listeners | ForEach-Object { $_.OwningProcess } | Select-Object -Unique) -join ', '
    throw((New-DhError "Port $Port is already in use by PID $owners, which this helper did not start. Refusing to start or to touch it. Pick another port with -Port."))
  }

  $exe = Resolve-DhDroidExe $DroidExe
  if (-not $exe -or -not (Test-Path -LiteralPath $exe)) {
    throw((New-DhError 'droid.exe not found. Install the Droid CLI or pass -DroidExe <path> (or set DROIDMOBILE_DROID_EXE).'))
  }

  if (-not $PSCmdlet.ShouldProcess("127.0.0.1:$Port", "Start supervised 'droid daemon --host 127.0.0.1 --port $Port' (state in $StateDir)")) {
    return
  }

  Initialize-DhDirectory $StateDir
  $supervisor = Join-Path $script:DhModuleRoot 'supervisor.ps1'
  $commandLine = '"{0}" -NoProfile -ExecutionPolicy Bypass -File "{1}" -Port {2} -DroidExe "{3}" -StateDir "{4}"' -f (Get-DhWindowsPowerShell), $supervisor, $Port, $exe, $StateDir
  $startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
  $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine        = $commandLine
    CurrentDirectory   = $StateDir
    ProcessStartupInformation = $startup
  }
  if ($created.ReturnValue -ne 0) {
    throw((New-DhError "Could not start the supervisor (Win32_Process.Create returned $($created.ReturnValue))."))
  }
  $supervisorPid = [int]$created.ProcessId

  $healthy = $false
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    if (Test-DhDaemonHealth -Port $Port) {
      $current = Read-DhJsonFile $recordFile
      if ($current -and $current.daemonPid -and (Test-Path -LiteralPath $pidFile)) { $healthy = $true; break }
    }
    if (-not (Get-Process -Id $supervisorPid -ErrorAction SilentlyContinue)) {
      # It may have exited because another supervisor won the per-port mutex.
      $current = Read-DhJsonFile $recordFile
      if ($current -and (Test-DhSupervisorAlive $current $Port)) { continue }
      break
    }
  }

  if (-not $healthy) {
    $current = Read-DhJsonFile $recordFile
    if ($current -and (Test-DhSupervisorAlive $current $Port)) { Stop-DhProcessTree -ProcessId ([int]$current.supervisorPid) }
    elseif (Get-Process -Id $supervisorPid -ErrorAction SilentlyContinue) { Stop-DhProcessTree -ProcessId $supervisorPid }
    $current = Read-DhJsonFile $recordFile
    if ($current -and $current.daemonPid -and (Test-DhDaemonProcess ([int]$current.daemonPid) $Port)) { Stop-DhProcessTree -ProcessId ([int]$current.daemonPid) }
    Remove-DhDaemonRecord $StateDir $Port
    $tail = ''
    $errLog = Join-Path $StateDir "logs\daemon-$Port.err.log"
    if (Test-Path -LiteralPath $errLog) { $tail = ' Last error output: ' + ((Get-Content -LiteralPath $errLog -Tail 3) -join ' | ') }
    throw((New-DhError "The daemon on port $Port did not become healthy within $HealthTimeoutSec s; supervisor stopped.$tail"))
  }

  $record = Read-DhJsonFile $recordFile
  Write-Host "Droid daemon started on 127.0.0.1:$Port (daemon PID $($record.daemonPid), supervisor PID $($record.supervisorPid)). State: $StateDir"
  $global:LASTEXITCODE = 0
  if ($PassThru) { return [pscustomobject]@{ Port = $Port; DaemonPid = [int]$record.daemonPid; SupervisorPid = [int]$record.supervisorPid; AlreadyRunning = $false } }
}

function Stop-DroidDaemon {
  <#
  .SYNOPSIS
    Stops the daemon and supervisor that Start-DroidDaemon started, and nothing else.
  .DESCRIPTION
    Acts only on the PIDs recorded in the helper's own PID/record files, and only after checking
    their start time and command line. A listener on the port with no record is never killed.
  .PARAMETER Port
    The daemon port given to Start-DroidDaemon (default 3101).
  .PARAMETER StateDir
    Same meaning as for Start-DroidDaemon.
  .EXAMPLE
    Stop-DroidDaemon -Port 3101
  #>
  [CmdletBinding(SupportsShouldProcess = $true)]
  param(
    [ValidateRange(3100, 3199)][int]$Port = 3101,
    [string]$StateDir
  )

  $StateDir = Get-DhStateDir $StateDir
  $pidFile = Join-Path $StateDir "daemon-$Port.pid"
  $recordFile = Join-Path $StateDir "daemon-$Port.json"
  $record = Read-DhJsonFile $recordFile

  if (-not $record) {
    if (Test-Path -LiteralPath $recordFile) {
      throw((New-DhError "$recordFile is not a valid record; leaving it and all processes untouched."))
    }
    if (@(Get-DhPortListeners -Port $Port).Count -gt 0) {
      throw((New-DhError "No helper record for port $Port but something is listening on it. Refusing to stop a process this helper did not start."))
    }
    Write-Host "Nothing to stop on port $Port (no helper record, port free)."
    $global:LASTEXITCODE = 0
    return
  }

  $supervisorPid = [int]$record.supervisorPid
  $supervisorLive = Test-DhSupervisorAlive $record $Port
  $daemonPid = 0
  if (Test-Path -LiteralPath $pidFile) {
    $raw = (Get-Content -LiteralPath $pidFile -Raw -ErrorAction SilentlyContinue)
    if ($raw -and $raw.Trim() -match '^\d+$') { $daemonPid = [int]$raw.Trim() }
  }
  if ($daemonPid -eq 0 -and $record.daemonPid) { $daemonPid = [int]$record.daemonPid }
  $daemonLive = ($daemonPid -gt 0 -and (Test-DhDaemonProcess $daemonPid $Port))

  if (-not $PSCmdlet.ShouldProcess("127.0.0.1:$Port", "Stop supervisor PID $supervisorPid (live: $supervisorLive) and daemon PID $daemonPid (live: $daemonLive), then remove the PID file")) {
    return
  }

  # Supervisor first so it cannot restart the daemon while we stop it.
  if ($supervisorLive) { Stop-DhProcessTree -ProcessId $supervisorPid }
  if ($daemonLive -and (Test-DhDaemonProcess $daemonPid $Port)) { Stop-DhProcessTree -ProcessId $daemonPid }
  Remove-DhDaemonRecord $StateDir $Port

  $freeDeadline = (Get-Date).AddSeconds(10)
  while (@(Get-DhPortListeners -Port $Port).Count -gt 0 -and (Get-Date) -lt $freeDeadline) { Start-Sleep -Milliseconds 300 }
  if (@(Get-DhPortListeners -Port $Port).Count -gt 0) {
    throw((New-DhError "Port $Port is still in use after stopping the recorded processes; it is held by a process this helper did not start."))
  }
  if ($supervisorLive -or $daemonLive) {
    Write-Host "Stopped droid daemon on port $Port (supervisor PID $supervisorPid, daemon PID $daemonPid). Port $Port is free."
  } else {
    Write-Host "Removed a stale record for port $Port (its processes were already gone). Port $Port is free."
  }
  $global:LASTEXITCODE = 0
}
