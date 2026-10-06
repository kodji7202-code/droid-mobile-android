function Resolve-DhTailscaleExe {
  if ($env:DROIDMOBILE_TAILSCALE_EXE) { return $env:DROIDMOBILE_TAILSCALE_EXE }
  $command = Get-Command tailscale.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($command) { return $command.Source }
  $fallback = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
  if (Test-Path -LiteralPath $fallback) { return $fallback }
  return $null
}

function Invoke-DhTailscale {
  param([string[]]$ArgumentList, [int]$TimeoutSec = 30)
  $exe = Resolve-DhTailscaleExe
  if (-not $exe) { throw 'tailscale.exe not found. Install Tailscale or set DROIDMOBILE_TAILSCALE_EXE.' }
  return (Invoke-DhNative -FilePath $exe -ArgumentList $ArgumentList -TimeoutSec $TimeoutSec)
}

function Get-DhServeStatusText {
  $result = Invoke-DhTailscale -ArgumentList @('serve', 'status')
  if ($result.ExitCode -ne 0) { throw "tailscale serve status failed: $($result.Stderr.Trim())" }
  return (($result.Stdout + $result.Stderr).Trim())
}

function Get-DhServeConfigJson {
  $result = Invoke-DhTailscale -ArgumentList @('serve', 'status', '--json')
  if ($result.ExitCode -ne 0) { throw "tailscale serve status --json failed: $($result.Stderr.Trim())" }
  return $result.Stdout.Trim()
}

function Get-DhServePortEntries {
  # Every part of the serve config that listens on this HTTPS port.
  param([string]$ConfigJson, [int]$Port)
  $entries = @()
  if (-not $ConfigJson) { return $entries }
  $config = $ConfigJson | ConvertFrom-Json
  if ($config.PSObject.Properties['TCP']) {
    foreach ($p in $config.TCP.PSObject.Properties) { if ($p.Name -eq "$Port") { $entries += "TCP $($p.Name)" } }
  }
  if ($config.PSObject.Properties['Web']) {
    foreach ($p in $config.Web.PSObject.Properties) {
      if ($p.Name -match ":$Port$") {
        $targets = @($p.Value.Handlers.PSObject.Properties | ForEach-Object { "$($_.Name) -> $($_.Value.Proxy)" })
        $entries += "Web $($p.Name) [$($targets -join '; ')]"
      }
    }
  }
  return $entries
}

function Test-DhServeMappingIsOurs {
  # True when the only thing on this port is a "/" proxy to the daemon port the helper recorded.
  param([string]$ConfigJson, [int]$Port, [int]$DaemonPort)
  if (-not $ConfigJson) { return $false }
  $config = $ConfigJson | ConvertFrom-Json
  if (-not $config.PSObject.Properties['Web']) { return $false }
  $webMatches = @($config.Web.PSObject.Properties | Where-Object { $_.Name -match ":$Port$" })
  if ($webMatches.Count -ne 1) { return $false }
  $handlers = @($webMatches[0].Value.Handlers.PSObject.Properties)
  if ($handlers.Count -ne 1 -or $handlers[0].Name -ne '/') { return $false }
  return ($handlers[0].Value.Proxy -eq "http://127.0.0.1:$DaemonPort")
}

function Get-DhMagicDnsName {
  $result = Invoke-DhTailscale -ArgumentList @('status', '--json')
  if ($result.ExitCode -ne 0) { throw "tailscale status failed: $($result.Stderr.Trim()). Is Tailscale running and logged in?" }
  $dns = ($result.Stdout | ConvertFrom-Json).Self.DNSName
  if (-not $dns) { throw 'Tailscale reports no MagicDNS name for this device. Enable MagicDNS in the tailnet admin console.' }
  return $dns.TrimEnd('.').ToLowerInvariant()
}

function Get-DhServeStateFile {
  param([string]$StateDir, [int]$Port)
  return (Join-Path $StateDir "tailscale-serve-$Port.json")
}

function Enable-TailscaleServe {
  <#
  .SYNOPSIS
    Publishes the local daemon on the tailnet with Tailscale Serve and prints its wss URL.
  .DESCRIPTION
    Records the prior `tailscale serve status` first, then runs
    `tailscale serve --bg --https=<Port> http://127.0.0.1:<DaemonPort>` and prints
    wss://<magicdns>:<Port>. Running it again reports "already enabled". If the port already has a
    serve entry that this helper did not create, it refuses and changes nothing.
    Requires MagicDNS and HTTPS certificates to be enabled in the tailnet admin console.
  .PARAMETER Port
    Public HTTPS port on the tailnet name: 443, 8443 (default) or 10000.
  .PARAMETER DaemonPort
    Local daemon port to publish (3100-3199, default 3101).
  .PARAMETER StateDir
    Where the prior-state record is kept (same default as Start-DroidDaemon).
  .EXAMPLE
    Enable-TailscaleServe -Port 8443 -DaemonPort 3101
  #>
  [CmdletBinding(SupportsShouldProcess = $true)]
  param(
    [ValidateSet(443, 8443, 10000)][int]$Port = 8443,
    [ValidateRange(3100, 3199)][int]$DaemonPort = 3101,
    [string]$StateDir
  )

  $StateDir = Get-DhStateDir $StateDir
  $stateFile = Get-DhServeStateFile $StateDir $Port
  $state = Read-DhJsonFile $stateFile
  if ((Test-Path -LiteralPath $stateFile) -and -not $state) {
    throw((New-DhError "$stateFile is not a valid record; refusing to change Tailscale Serve."))
  }

  try {
    $configJson = Get-DhServeConfigJson
    $statusText = Get-DhServeStatusText
    $dnsName = Get-DhMagicDnsName
  } catch {
    throw((New-DhError $_.Exception.Message))
  }
  $url = "wss://${dnsName}:$Port"
  $entries = @(Get-DhServePortEntries $configJson $Port)

  if ($state) {
    if ([int]$state.daemonPort -ne $DaemonPort) {
      throw((New-DhError "Serve on port $Port was enabled by this helper for daemon port $($state.daemonPort). Run Disable-TailscaleServe -Port $Port first."))
    }
    if ($entries.Count -gt 0 -and (Test-DhServeMappingIsOurs $configJson $Port $DaemonPort)) {
      Write-Host "Tailscale Serve already enabled on port $Port."
      Write-Host "URL: $url"
      $global:LASTEXITCODE = 0
      return
    }
    if ($entries.Count -gt 0) {
      throw((New-DhError "Port $Port now has a serve entry that differs from what this helper created: $($entries -join '; '). Refusing to change it."))
    }
  } elseif ($entries.Count -gt 0) {
    throw((New-DhError "Port $Port already has a Tailscale Serve entry that this helper did not create: $($entries -join '; '). Refusing to modify it. Use another -Port or remove that entry yourself."))
  }

  if (-not $PSCmdlet.ShouldProcess("tailscale serve on port $Port", "Record the current serve status in $stateFile, then run: tailscale serve --bg --https=$Port http://127.0.0.1:$DaemonPort (URL $url)")) {
    return
  }

  if (-not (Test-DhDaemonHealth -Port $DaemonPort)) {
    Write-Warning "No healthy daemon answers on 127.0.0.1:$DaemonPort yet. Start-DroidDaemon -Port $DaemonPort first."
  }

  if (-not $state) {
    Initialize-DhDirectory $StateDir
    Write-DhJsonFile $stateFile ([ordered]@{
        version     = 1
        servePort   = $Port
        daemonPort  = $DaemonPort
        url         = $url
        priorStatus = $statusText
        priorConfig = $configJson
        recordedAt  = (Get-Date).ToUniversalTime().ToString('o')
      })
  }

  $result = Invoke-DhTailscale -ArgumentList @('serve', '--bg', "--https=$Port", "http://127.0.0.1:$DaemonPort") -TimeoutSec 45
  if ($result.ExitCode -ne 0) {
    if (-not $state) { Remove-Item -LiteralPath $stateFile -ErrorAction SilentlyContinue }
    $detail = ($result.Stdout + $result.Stderr).Trim()
    throw((New-DhError "tailscale serve failed (exit $($result.ExitCode)): $detail"))
  }

  Write-Host "Tailscale Serve enabled: https port $Port -> http://127.0.0.1:$DaemonPort"
  Write-Host "URL: $url"
  $global:LASTEXITCODE = 0
}

function Disable-TailscaleServe {
  <#
  .SYNOPSIS
    Removes the serve mapping that Enable-TailscaleServe created and restores the recorded state.
  .DESCRIPTION
    Only the helper's own mapping on <Port> is removed, so every other serve entry is left alone.
    Afterwards `tailscale serve status` should equal the status recorded before enabling; a
    difference is reported. With no helper record it refuses to remove an existing entry and
    otherwise reports "nothing to restore".
  .PARAMETER Port
    HTTPS port given to Enable-TailscaleServe (default 8443).
  .PARAMETER StateDir
    Same meaning as for Enable-TailscaleServe.
  .EXAMPLE
    Disable-TailscaleServe -Port 8443
  #>
  [CmdletBinding(SupportsShouldProcess = $true)]
  param(
    [ValidateSet(443, 8443, 10000)][int]$Port = 8443,
    [string]$StateDir
  )

  $StateDir = Get-DhStateDir $StateDir
  $stateFile = Get-DhServeStateFile $StateDir $Port
  $state = Read-DhJsonFile $stateFile
  if ((Test-Path -LiteralPath $stateFile) -and -not $state) {
    throw((New-DhError "$stateFile is not a valid record; refusing to change Tailscale Serve."))
  }

  try {
    $configJson = Get-DhServeConfigJson
  } catch {
    throw((New-DhError $_.Exception.Message))
  }
  $entries = @(Get-DhServePortEntries $configJson $Port)

  if (-not $state) {
    if ($entries.Count -gt 0) {
      throw((New-DhError "Port $Port has a Tailscale Serve entry that this helper did not create: $($entries -join '; '). Refusing to remove it."))
    }
    Write-Host "Nothing to restore: this helper has no serve record for port $Port."
    $global:LASTEXITCODE = 0
    return
  }

  if ($entries.Count -gt 0 -and -not (Test-DhServeMappingIsOurs $configJson $Port ([int]$state.daemonPort))) {
    throw((New-DhError "Port $Port now has a serve entry that differs from what this helper created: $($entries -join '; '). Refusing to remove it; the record is kept."))
  }

  if (-not $PSCmdlet.ShouldProcess("tailscale serve on port $Port", "Run: tailscale serve --https=$Port off, then delete $stateFile")) {
    return
  }

  if ($entries.Count -gt 0) {
    $result = Invoke-DhTailscale -ArgumentList @('serve', "--https=$Port", 'off') -TimeoutSec 45
    if ($result.ExitCode -ne 0) {
      $detail = ($result.Stdout + $result.Stderr).Trim()
      throw((New-DhError "tailscale serve off failed (exit $($result.ExitCode)): $detail"))
    }
  }

  $after = Get-DhServeStatusText
  Remove-Item -LiteralPath $stateFile -ErrorAction SilentlyContinue
  if ($after -ceq [string]$state.priorStatus) {
    Write-Host "Tailscale Serve restored: status is identical to the state recorded before enabling. Removed the record."
  } else {
    Write-Warning "Removed the helper's mapping on port $Port, but 'tailscale serve status' differs from the recorded original (something else changed serve meanwhile). Record removed."
  }
  $global:LASTEXITCODE = 0
}
