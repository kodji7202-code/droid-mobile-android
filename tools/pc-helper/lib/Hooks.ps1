function Get-DhDefaultSettingsPath {
  $homeDir = if ($env:FACTORY_HOME_OVERRIDE) { $env:FACTORY_HOME_OVERRIDE } else { $env:USERPROFILE }
  return (Join-Path (Join-Path $homeDir '.factory') 'settings.json')
}

function Resolve-DhFullPath {
  param([Parameter(Mandatory)][string]$Path)
  return $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
}

function Get-DhNodeExe {
  $node = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($node) { return $node.Source }
  return $null
}

function Get-DhBridgeConfigFile {
  param([string]$StateDir)
  return (Join-Path $StateDir 'bridge.json')
}

function Invoke-DhHooksConfig {
  # Runs hooks-config.mjs and returns its JSON result. A non-zero exit becomes a terminating error
  # whose message is the script's own text (it names the file that could not be changed).
  param(
    [Parameter(Mandatory)][ValidateSet('install', 'uninstall', 'status')][string]$Verb,
    [Parameter(Mandatory)][string]$SettingsPath,
    [string]$HookCommand,
    [switch]$DryRun
  )
  $node = Get-DhNodeExe
  if (-not $node) { throw((New-DhError 'Node.js was not found on PATH. Install Node.js 24 (it edits the hooks JSON and runs the hook).')) }
  $arguments = @((Join-Path $script:DhModuleRoot 'hooks-config.mjs'), $Verb, '--settings', $SettingsPath)
  if ($HookCommand) { $arguments += @('--command', $HookCommand) }
  if ($DryRun) { $arguments += '--dry-run' }
  $result = Invoke-DhNative -FilePath $node -ArgumentList $arguments -TimeoutSec 30
  if ($result.ExitCode -ne 0) {
    $message = $result.Stderr.Trim()
    if (-not $message) { $message = "hooks-config.mjs exited with code $($result.ExitCode)." }
    throw((New-DhError $message))
  }
  return ($result.Stdout.Trim() | ConvertFrom-Json)
}

function Resolve-DhBridgeSecretInput {
  param([string]$BridgeSecret, [string]$BridgeSecretFile)
  if ($BridgeSecret) { return $BridgeSecret }
  if ($BridgeSecretFile) {
    if (-not (Test-Path -LiteralPath $BridgeSecretFile)) { throw((New-DhError "Bridge secret file not found: $BridgeSecretFile")) }
    return ((Get-Content -LiteralPath $BridgeSecretFile -TotalCount 1) | Out-String).Trim()
  }
  return $env:DROIDMOBILE_BRIDGE_SECRET
}

function Write-DhBridgeConfig {
  # The one place a bridge secret is stored: <StateDir>\bridge.json, readable by the current user only.
  param([string]$StateDir, [string]$Url, [string]$Secret)
  Initialize-DhDirectory $StateDir
  $file = Get-DhBridgeConfigFile $StateDir
  Write-DhJsonFile -Path $file -Value ([ordered]@{ url = $Url; secret = $Secret })
  try {
    Invoke-DhNative -FilePath 'icacls.exe' -ArgumentList @($file, '/inheritance:r', '/grant:r', "$($env:USERNAME):(M)") -TimeoutSec 10 | Out-Null
  } catch { }
  return $file
}

function Install-DroidHooks {
  <#
  .SYNOPSIS
    Adds the Droid Mobile Notification and Stop hooks to your Factory hooks configuration.
  .DESCRIPTION
    The hooks run hook.mjs, which posts a minimal event (session id, event name, notification
    type) to the FCM bridge. Target file: a hooks.json next to the settings file when one exists,
    otherwise the "hooks" key of the settings file. The target is backed up first
    (<file>.droidmobile-backup-<timestamp>, same content), existing hooks and settings are kept,
    and running the command again changes nothing. A file that is not valid JSON is refused and
    left untouched.
    The bridge URL and pairing secret are stored in <StateDir>\bridge.json (user-only ACL), never
    in the settings file or the hook command line.
  .PARAMETER SettingsPath
    Factory settings file. Default: ~\.factory\settings.json.
  .PARAMETER BridgeUrl
    FCM bridge base URL, for example http://127.0.0.1:3102. Written to bridge.json with the secret.
  .PARAMETER BridgeSecret
    Bridge pairing secret. Prefer -BridgeSecretFile or $env:DROIDMOBILE_BRIDGE_SECRET.
  .PARAMETER BridgeSecretFile
    File whose first line is the bridge pairing secret.
  .PARAMETER StateDir
    Helper state folder (default %LOCALAPPDATA%\DroidMobileHelper or $env:DROIDMOBILE_HELPER_HOME).
  .EXAMPLE
    Install-DroidHooks -BridgeUrl http://127.0.0.1:3102 -BridgeSecretFile .\pair-secret.txt
  .EXAMPLE
    Install-DroidHooks -SettingsPath $env:TEMP\scratch\settings.json -WhatIf
  #>
  [CmdletBinding(SupportsShouldProcess = $true)]
  param(
    [string]$SettingsPath,
    [string]$BridgeUrl,
    [string]$BridgeSecret,
    [string]$BridgeSecretFile,
    [string]$StateDir
  )

  $embedStateDir = [bool]($StateDir -or $env:DROIDMOBILE_HELPER_HOME)
  $StateDir = Get-DhStateDir $StateDir
  if (-not $SettingsPath) { $SettingsPath = Get-DhDefaultSettingsPath }
  $SettingsPath = Resolve-DhFullPath $SettingsPath

  $secret = $null
  if ($BridgeUrl) {
    if ($BridgeUrl -notmatch '^https?://[^\s?#]+$') { throw((New-DhError "-BridgeUrl must be an http:// or https:// URL (got '$BridgeUrl').")) }
    $secret = Resolve-DhBridgeSecretInput $BridgeSecret $BridgeSecretFile
    if (-not $secret) { throw((New-DhError 'A bridge needs its pairing secret: pass -BridgeSecretFile, -BridgeSecret or set DROIDMOBILE_BRIDGE_SECRET.')) }
    $bridgeHost = ([System.Uri]$BridgeUrl).Host
    if ($BridgeUrl -like 'http://*' -and $bridgeHost -notin @('127.0.0.1', 'localhost', '[::1]', '10.0.2.2')) {
      Write-Warning "$BridgeUrl uses plain http to a non-loopback host: the pairing secret would cross the network unencrypted. Use https."
    }
  } elseif ($BridgeSecret -or $BridgeSecretFile) {
    throw((New-DhError 'A bridge secret needs -BridgeUrl as well.'))
  }

  $scriptPath = (Join-Path $script:DhModuleRoot 'hook.mjs') -replace '\\', '/'
  $hookCommand = 'node "{0}" --droidmobile-hook' -f $scriptPath
  if ($embedStateDir) { $hookCommand += ' --state-dir "{0}"' -f ($StateDir -replace '\\', '/') }

  $plan = Invoke-DhHooksConfig -Verb install -SettingsPath $SettingsPath -HookCommand $hookCommand -DryRun
  if ($BridgeUrl -and $PSCmdlet.ShouldProcess((Get-DhBridgeConfigFile $StateDir), "Store bridge URL and pairing secret (user-only file)")) {
    $configFile = Write-DhBridgeConfig -StateDir $StateDir -Url $BridgeUrl -Secret $secret
    Write-Host "Bridge configuration saved to $configFile."
  }

  if (-not $plan.changed) {
    Write-Host "Droid Mobile hooks are already installed in $($plan.file); nothing to change."
  } elseif ($PSCmdlet.ShouldProcess($plan.file, 'Add Notification and Stop hooks (backup first)')) {
    $done = Invoke-DhHooksConfig -Verb install -SettingsPath $SettingsPath -HookCommand $hookCommand
    if ($done.backup) { Write-Host "Backup: $($done.backup)" } else { Write-Host "Created $($done.file) (there was no file to back up)." }
    Write-Host "Installed Notification and Stop hooks in $($done.file) ($($done.kind))."
    Write-Host 'Droid reads hooks at startup: restart running Droid sessions to pick them up.'
  }

  if (-not $BridgeUrl -and -not (Test-Path -LiteralPath (Get-DhBridgeConfigFile $StateDir)) -and -not $env:DROIDMOBILE_BRIDGE_URL) {
    Write-Host "Note: no bridge is configured yet, so the hooks do nothing. Re-run with -BridgeUrl and -BridgeSecretFile, or create $(Get-DhBridgeConfigFile $StateDir)."
  }
  $global:LASTEXITCODE = 0
}

function Uninstall-DroidHooks {
  <#
  .SYNOPSIS
    Removes the hooks that Install-DroidHooks added; every other hook and setting stays.
  .DESCRIPTION
    Looks in a neighbouring hooks.json and in the settings file, backs up each file it changes,
    and removes only entries owned by this helper. Running it again prints "Nothing to remove".
  .PARAMETER SettingsPath
    Factory settings file. Default: ~\.factory\settings.json.
  .PARAMETER StateDir
    Helper state folder; only used with -RemoveBridgeConfig.
  .PARAMETER RemoveBridgeConfig
    Also delete <StateDir>\bridge.json (the stored bridge URL and secret).
  .EXAMPLE
    Uninstall-DroidHooks -RemoveBridgeConfig
  #>
  [CmdletBinding(SupportsShouldProcess = $true)]
  param(
    [string]$SettingsPath,
    [string]$StateDir,
    [switch]$RemoveBridgeConfig
  )

  $StateDir = Get-DhStateDir $StateDir
  if (-not $SettingsPath) { $SettingsPath = Get-DhDefaultSettingsPath }
  $SettingsPath = Resolve-DhFullPath $SettingsPath

  $plan = Invoke-DhHooksConfig -Verb uninstall -SettingsPath $SettingsPath -DryRun
  if ($plan.removed -eq 0) {
    $where = (@($plan.results | ForEach-Object { $_.file }) -join ', ')
    if (-not $where) { $where = $SettingsPath }
    Write-Host "Nothing to remove: no Droid Mobile hooks found in $where."
  } elseif ($PSCmdlet.ShouldProcess($SettingsPath, 'Remove Droid Mobile hooks (backup first)')) {
    $done = Invoke-DhHooksConfig -Verb uninstall -SettingsPath $SettingsPath
    foreach ($entry in @($done.results | Where-Object { $_.removed -gt 0 })) {
      Write-Host "Removed $($entry.removed) hook(s) from $($entry.file). Backup: $($entry.backup)"
    }
  }

  if ($RemoveBridgeConfig) {
    $configFile = Get-DhBridgeConfigFile $StateDir
    if (Test-Path -LiteralPath $configFile) {
      if ($PSCmdlet.ShouldProcess($configFile, 'Delete stored bridge URL and secret')) {
        Remove-Item -LiteralPath $configFile -Force
        Write-Host "Deleted $configFile."
      }
    } else {
      Write-Host "No bridge configuration at $configFile."
    }
  }
  $global:LASTEXITCODE = 0
}
