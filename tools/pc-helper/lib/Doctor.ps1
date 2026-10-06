function New-DhCheck {
  param([string]$Name, [ValidateSet('PASS', 'WARN', 'FAIL')][string]$Status, [string]$Detail, [string]$Fix)
  return [pscustomobject]@{ Name = $Name; Status = $Status; Detail = $Detail; Fix = $Fix }
}

function Get-DhFirstLine {
  param([string]$Text)
  return (($Text -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -First 1) | Out-String).Trim()
}

function Test-DhHttpOk {
  # Status code of a GET, or 0 when nothing answered. Never throws.
  param([string]$Uri, [int]$TimeoutSec = 3)
  try {
    $request = [System.Net.HttpWebRequest]::Create($Uri)
    $request.Timeout = $TimeoutSec * 1000
    $request.Proxy = $null
    $response = $request.GetResponse()
    try { return [int]$response.StatusCode } finally { $response.Close() }
  } catch [System.Net.WebException] {
    if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
    return 0
  } catch {
    return 0
  }
}

function Get-DhDoctorChecks {
  param([int]$DaemonPort, [int]$ServePort, [string]$StateDir, [string]$BridgeUrl, [string]$SettingsPath)

  $checks = @()

  $droid = Resolve-DhDroidExe $null
  if (-not $droid -or -not (Test-Path -LiteralPath $droid)) {
    $checks += New-DhCheck 'droid version' 'FAIL' 'droid.exe not found' 'Install the Droid CLI, or set DROIDMOBILE_DROID_EXE to its full path.'
  } else {
    $version = Invoke-DhNative -FilePath $droid -ArgumentList @('--version') -TimeoutSec 20
    $text = Get-DhFirstLine $version.Stdout
    if ($version.ExitCode -eq 0 -and $text) {
      $checks += New-DhCheck 'droid version' 'PASS' $text
    } else {
      $checks += New-DhCheck 'droid version' 'FAIL' "droid --version failed (exit $($version.ExitCode))" 'Reinstall the Droid CLI and run droid --version in a terminal.'
    }
  }

  $node = Get-DhNodeExe
  if (-not $node) {
    $checks += New-DhCheck 'Node version' 'FAIL' 'node.exe not found on PATH' 'Install Node.js 24 from nodejs.org (the hooks and the QR code need it).'
  } else {
    $nodeVersion = Get-DhFirstLine (Invoke-DhNative -FilePath $node -ArgumentList @('--version') -TimeoutSec 20).Stdout
    $major = 0
    if ($nodeVersion -match '^v(\d+)\.') { $major = [int]$Matches[1] }
    if ($major -ge 24) { $checks += New-DhCheck 'Node version' 'PASS' $nodeVersion }
    elseif ($major -ge 18) { $checks += New-DhCheck 'Node version' 'WARN' "$nodeVersion (Node 24 is the supported version)" 'Install Node.js 24.' }
    else { $checks += New-DhCheck 'Node version' 'FAIL' "$nodeVersion is too old" 'Install Node.js 24.' }
  }

  $record = Read-DhJsonFile (Join-Path $StateDir "daemon-$DaemonPort.json")
  if (Test-DhDaemonHealth -Port $DaemonPort) {
    $owner = if ($record -and (Test-DhSupervisorAlive $record $DaemonPort)) { 'supervised by this helper' } else { 'not started by this helper' }
    $checks += New-DhCheck 'daemon health' 'PASS' "127.0.0.1:$DaemonPort answers /health ($owner)"
  } else {
    $checks += New-DhCheck 'daemon health' 'FAIL' "nothing healthy on 127.0.0.1:$DaemonPort" "Run Start-DroidDaemon -Port $DaemonPort (see $StateDir\logs if it keeps failing)."
  }

  $status = $null
  $tailscaleProblem = $null
  try {
    $result = Invoke-DhTailscale -ArgumentList @('status', '--json')
    if ($result.TimedOut) { $tailscaleProblem = 'tailscale status timed out' }
    elseif ([string]::IsNullOrWhiteSpace($result.Stdout)) { $tailscaleProblem = "tailscale status gave no data: $(Get-DhFirstLine $result.Stderr)" }
    else { $status = $result.Stdout | ConvertFrom-Json }
  } catch {
    $tailscaleProblem = 'tailscale.exe not found'
  }
  if ($status -and $status.BackendState -eq 'Running') {
    $dns = if ($status.Self -and $status.Self.DNSName) { $status.Self.DNSName.TrimEnd('.') } else { 'no MagicDNS name' }
    $checks += New-DhCheck 'Tailscale status' 'PASS' "running as $dns"
  } elseif ($status) {
    $checks += New-DhCheck 'Tailscale status' 'FAIL' "backend state is $($status.BackendState)" 'Start Tailscale and sign in (tailscale up), then run Doctor again.'
  } else {
    $checks += New-DhCheck 'Tailscale status' 'FAIL' $tailscaleProblem 'Install Tailscale, start it and sign in; set DROIDMOBILE_TAILSCALE_EXE if it is not on PATH.'
  }

  if ($status) {
    $domains = @($status.CertDomains | Where-Object { $_ })
    if ($domains.Count -gt 0) {
      $checks += New-DhCheck 'HTTPS certificates' 'PASS' "available for $($domains -join ', ')"
    } else {
      $checks += New-DhCheck 'HTTPS certificates' 'FAIL' 'the tailnet offers no certificate domain' 'In the Tailscale admin console (DNS page) enable MagicDNS and HTTPS certificates.'
    }
  } else {
    $checks += New-DhCheck 'HTTPS certificates' 'WARN' 'not checked because Tailscale status is unavailable' 'Fix the Tailscale status check first.'
  }

  if ($status -and $status.BackendState -eq 'Running') {
    try {
      $entries = @(Get-DhServePortEntries -ConfigJson (Get-DhServeConfigJson) -Port $ServePort)
      $serveRecord = Read-DhJsonFile (Get-DhServeStateFile $StateDir $ServePort)
      if ($entries.Count -eq 0) {
        $checks += New-DhCheck 'Tailscale Serve' 'WARN' "nothing is published on HTTPS port $ServePort" "Run Enable-TailscaleServe -Port $ServePort -DaemonPort $DaemonPort so the phone can reach the daemon."
      } elseif ($serveRecord -and $serveRecord.url) {
        $checks += New-DhCheck 'Tailscale Serve' 'PASS' "published by this helper: $($serveRecord.url)"
      } else {
        $checks += New-DhCheck 'Tailscale Serve' 'WARN' "HTTPS port $ServePort is used by an entry this helper did not create" "Leave it alone and pick another port with Enable-TailscaleServe -Port, or remove that entry yourself."
      }
    } catch {
      $checks += New-DhCheck 'Tailscale Serve' 'WARN' 'could not read the serve configuration' "Run tailscale serve status to see why; then Enable-TailscaleServe -Port $ServePort."
    }
  } else {
    $checks += New-DhCheck 'Tailscale Serve' 'WARN' 'not checked because Tailscale is not running' "Fix Tailscale first, then run Enable-TailscaleServe -Port $ServePort."
  }

  $bridgeFile = Get-DhBridgeConfigFile $StateDir
  $bridgeConfig = Read-DhJsonFile $bridgeFile
  $explicit = $false
  if ($BridgeUrl) { $explicit = $true }
  elseif ($env:DROIDMOBILE_BRIDGE_URL) { $BridgeUrl = $env:DROIDMOBILE_BRIDGE_URL; $explicit = $true }
  elseif ($bridgeConfig -and $bridgeConfig.url) { $BridgeUrl = [string]$bridgeConfig.url; $explicit = $true }
  else { $BridgeUrl = 'http://127.0.0.1:3102' }
  if ($BridgeUrl -notmatch '^https?://[^\s?#]+$') {
    $checks += New-DhCheck 'bridge reachability' 'FAIL' "the bridge URL is not an http(s) URL: $BridgeUrl" 'Pass a valid -BridgeUrl (for example http://127.0.0.1:3102) or fix bridge.json.'
  } else {
    $code = Test-DhHttpOk -Uri ($BridgeUrl.TrimEnd('/') + '/healthz')
    if ($code -eq 200) {
      $checks += New-DhCheck 'bridge reachability' 'PASS' "$BridgeUrl/healthz answers 200"
    } else {
      $reason = if ($code -eq 0) { 'no answer' } else { "HTTP $code" }
      $level = if ($explicit) { 'FAIL' } else { 'WARN' }
      $checks += New-DhCheck 'bridge reachability' $level "$BridgeUrl/healthz: $reason" 'Start the FCM bridge (npm run dev -w @droidmobile/fcm-bridge -- --port 3102, see server/fcm-bridge/README.md) or fix the URL with -BridgeUrl.'
    }
  }

  if (-not $node) {
    $checks += New-DhCheck 'Droid hooks' 'WARN' 'not checked because Node.js is missing' 'Install Node.js 24.'
  } else {
    try {
      $hooks = Invoke-DhHooksConfig -Verb status -SettingsPath $SettingsPath
      $missing = @('Notification', 'Stop' | Where-Object { $hooks.events.$_ -lt 1 })
      $hasSecret = [bool]($bridgeConfig -and $bridgeConfig.secret) -or [bool]($env:DROIDMOBILE_BRIDGE_URL -and $env:DROIDMOBILE_BRIDGE_SECRET)
      if ($missing.Count -gt 0) {
        $checks += New-DhCheck 'Droid hooks' 'WARN' "no Droid Mobile hook for: $($missing -join ', ') in $($hooks.file)" 'Run Install-DroidHooks -BridgeUrl <url> -BridgeSecretFile <file> to get phone notifications.'
      } elseif (-not $hasSecret) {
        $checks += New-DhCheck 'Droid hooks' 'WARN' "hooks installed in $($hooks.file) but no bridge secret is stored" "Run Install-DroidHooks -BridgeUrl <url> -BridgeSecretFile <file> (creates $bridgeFile)."
      } else {
        $checks += New-DhCheck 'Droid hooks' 'PASS' "Notification and Stop hooks installed in $($hooks.file)"
      }
    } catch {
      $checks += New-DhCheck 'Droid hooks' 'WARN' (Get-DhFirstLine $_.Exception.Message) 'Repair the settings file named above (it must be valid JSON), then run Doctor again.'
    }
  }

  return $checks
}

function Get-DroidDoctor {
  <#
  .SYNOPSIS
    Checks the PC side of Droid Mobile and tells you how to fix what is wrong. Read-only.
  .DESCRIPTION
    Prints one line per check (PASS, WARN or FAIL): droid and Node versions, daemon health,
    Tailscale status, HTTPS certificates, Tailscale Serve, FCM bridge reachability and the hooks.
    Every WARN or FAIL is followed by a "fix:" line. It changes nothing and prints no secret.
    When any check is FAIL the command ends with an error, so the exit code is non-zero.
  .PARAMETER DaemonPort
    Daemon port to check (default 3101).
  .PARAMETER ServePort
    Tailscale Serve HTTPS port to check (default 8443).
  .PARAMETER BridgeUrl
    Bridge base URL. Default: $env:DROIDMOBILE_BRIDGE_URL, then bridge.json, then http://127.0.0.1:3102.
  .PARAMETER SettingsPath
    Factory settings file whose hooks are inspected. Default: ~\.factory\settings.json.
  .PARAMETER StateDir
    Helper state folder.
  .PARAMETER PassThru
    Also return the check objects.
  .EXAMPLE
    Doctor
  #>
  [CmdletBinding()]
  [Alias('Doctor')]
  param(
    [ValidateRange(3100, 3199)][int]$DaemonPort = 3101,
    [ValidateSet(443, 8443, 10000)][int]$ServePort = 8443,
    [string]$BridgeUrl,
    [string]$SettingsPath,
    [string]$StateDir,
    [switch]$PassThru
  )

  $StateDir = Get-DhStateDir $StateDir
  if (-not $SettingsPath) { $SettingsPath = Get-DhDefaultSettingsPath }
  $SettingsPath = Resolve-DhFullPath $SettingsPath

  $checks = @(Get-DhDoctorChecks -DaemonPort $DaemonPort -ServePort $ServePort -StateDir $StateDir -BridgeUrl $BridgeUrl -SettingsPath $SettingsPath)
  $colors = @{ PASS = 'Green'; WARN = 'Yellow'; FAIL = 'Red' }
  foreach ($check in $checks) {
    Write-Host ("[{0}] {1}: {2}" -f $check.Status, $check.Name, $check.Detail) -ForegroundColor $colors[$check.Status]
    if ($check.Status -ne 'PASS') { Write-Host ("       fix: {0}" -f $check.Fix) }
  }
  $failed = @($checks | Where-Object { $_.Status -eq 'FAIL' }).Count
  $warned = @($checks | Where-Object { $_.Status -eq 'WARN' }).Count
  Write-Host ("Summary: {0} passed, {1} warning(s), {2} failed." -f (@($checks | Where-Object { $_.Status -eq 'PASS' }).Count), $warned, $failed)
  if ($PassThru) { $checks }
  if ($failed -gt 0) {
    $global:LASTEXITCODE = 1
    throw((New-DhError "Doctor found $failed failing check(s). The fix lines above say what to do."))
  }
  $global:LASTEXITCODE = 0
}
