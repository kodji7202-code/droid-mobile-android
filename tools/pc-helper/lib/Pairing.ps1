function ConvertTo-DhQueryValue {
  # Percent-encode everything except unreserved characters, ':' and '/' (valid in a query string
  # and keeps URLs readable). The app decodes with URLSearchParams, which accepts both forms.
  param([Parameter(Mandatory)][string]$Value)
  $encoded = [System.Uri]::EscapeDataString($Value)
  return ($encoded -replace '%3A', ':' -replace '%2F', '/')
}

function Get-DhQrRows {
  # 0/1 rows from qr.mjs; $null when Node or the QR library is unavailable.
  param([Parameter(Mandatory)][string]$Payload)
  $node = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $node) { return $null }
  $script = Join-Path $script:DhModuleRoot 'qr.mjs'
  # The payload goes in on stdin so a secret never appears in a process command line.
  $result = Invoke-DhNative -FilePath $node.Source -ArgumentList @($script) -InputText $Payload -TimeoutSec 20
  if ($result.ExitCode -ne 0) { return $null }
  $rows = @($result.Stdout -split "`r?`n" | Where-Object { $_ -match '^[01]+$' })
  if ($rows.Count -eq 0) { return $null }
  return $rows
}

function Write-DhQrBlock {
  param([string[]]$Rows)
  if ([Console]::IsOutputRedirected) {
    # Plain ASCII, two columns per module, so captured output keeps the shape.
    foreach ($row in $Rows) {
      Write-Host (($row.ToCharArray() | ForEach-Object { if ($_ -eq '1') { '##' } else { '  ' } }) -join '')
    }
    return
  }
  # Half-block characters give square modules in about half the height. Black on white keeps
  # dark-on-light contrast on any terminal theme.
  $full = [string][char]0x2588
  $upper = [string][char]0x2580
  $lower = [string][char]0x2584
  $width = $Rows[0].Length
  $blank = '0' * $width
  for ($i = 0; $i -lt $Rows.Count; $i += 2) {
    $top = $Rows[$i]
    $bottom = if ($i + 1 -lt $Rows.Count) { $Rows[$i + 1] } else { $blank }
    $line = New-Object System.Text.StringBuilder
    for ($c = 0; $c -lt $width; $c++) {
      $t = $top[$c] -eq '1'
      $b = $bottom[$c] -eq '1'
      if ($t -and $b) { [void]$line.Append($full) }
      elseif ($t) { [void]$line.Append($upper) }
      elseif ($b) { [void]$line.Append($lower) }
      else { [void]$line.Append(' ') }
    }
    Write-Host $line.ToString() -ForegroundColor Black -BackgroundColor White
  }
}

function ConvertFrom-DhSecureString {
  param([System.Security.SecureString]$Secure)
  $ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try { return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function New-PairingCode {
  <#
  .SYNOPSIS
    Prints a droidmobile://pair pairing code (text and QR) for the Droid Mobile app.
  .DESCRIPTION
    Payload: droidmobile://pair?v=1&url=<wss-url>[&bridge=<bridge-url>&bridgeSecret=<secret>]
    The URL is the helper's recorded Tailscale Serve URL, or wss://<magicdns>:<ServePort>.
    The Factory API key is NOT included unless -IncludeApiKey is given; then it is read from
    $env:FACTORY_API_KEY (or prompted for), shown on screen only with a warning, and never
    written to any file. Nothing here is saved to disk.
  .PARAMETER Url
    Daemon URL to embed (ws:// or wss://). Default: the recorded Serve URL.
  .PARAMETER ServePort
    Serve port used to find or build the default URL (default 8443).
  .PARAMETER BridgeUrl
    FCM bridge base URL the phone should use (http:// or https://). Needs a bridge secret.
  .PARAMETER BridgeSecret
    Bridge pairing secret. Prefer -BridgeSecretFile or $env:DROIDMOBILE_BRIDGE_SECRET to keep
    it out of the shell history.
  .PARAMETER BridgeSecretFile
    File whose first line is the bridge pairing secret.
  .PARAMETER IncludeApiKey
    Add key=<Factory API key> to the payload. On screen only; do not share the output.
  .PARAMETER NoQr
    Print only the text payload.
  .PARAMETER PassThru
    Also return the payload string.
  .PARAMETER StateDir
    Same meaning as for Enable-TailscaleServe (only read, to find the Serve URL).
  .EXAMPLE
    New-PairingCode -BridgeUrl http://10.0.2.2:3102 -BridgeSecretFile .\pair-secret.txt
  #>
  [CmdletBinding()]
  param(
    [string]$Url,
    [ValidateSet(443, 8443, 10000)][int]$ServePort = 8443,
    [string]$BridgeUrl,
    [string]$BridgeSecret,
    [string]$BridgeSecretFile,
    [switch]$IncludeApiKey,
    [switch]$NoQr,
    [switch]$PassThru,
    [string]$StateDir
  )

  $StateDir = Get-DhStateDir $StateDir

  if (-not $Url) {
    $state = Read-DhJsonFile (Get-DhServeStateFile $StateDir $ServePort)
    if ($state -and $state.url) {
      $Url = [string]$state.url
    } else {
      try { $dns = Get-DhMagicDnsName } catch { throw((New-DhError "Cannot work out the daemon URL: $($_.Exception.Message) Pass -Url explicitly.")) }
      $Url = "wss://${dns}:$ServePort"
      Write-Host "Note: Tailscale Serve is not enabled by this helper on port $ServePort; run Enable-TailscaleServe so the URL answers."
    }
  }
  if ($Url -notmatch '^wss?://[^\s/?#]+$') {
    throw((New-DhError "-Url must look like wss://host:port or ws://host:port (got '$Url')."))
  }

  $secret = $null
  if ($BridgeUrl) {
    if ($BridgeUrl -notmatch '^https?://[^\s?#]+$') {
      throw((New-DhError "-BridgeUrl must be an http:// or https:// URL (got '$BridgeUrl')."))
    }
    if ($BridgeSecret) { $secret = $BridgeSecret }
    elseif ($BridgeSecretFile) {
      if (-not (Test-Path -LiteralPath $BridgeSecretFile)) { throw((New-DhError "Bridge secret file not found: $BridgeSecretFile")) }
      $secret = ((Get-Content -LiteralPath $BridgeSecretFile -TotalCount 1) | Out-String).Trim()
    }
    elseif ($env:DROIDMOBILE_BRIDGE_SECRET) { $secret = $env:DROIDMOBILE_BRIDGE_SECRET }
    if (-not $secret) {
      throw((New-DhError 'A bridge needs its pairing secret: pass -BridgeSecretFile, -BridgeSecret or set DROIDMOBILE_BRIDGE_SECRET.'))
    }
  } elseif ($BridgeSecret -or $BridgeSecretFile) {
    throw((New-DhError 'A bridge secret needs -BridgeUrl as well.'))
  }

  $key = $null
  if ($IncludeApiKey) {
    $key = $env:FACTORY_API_KEY
    if (-not $key) {
      $secure = Read-Host -Prompt 'Factory API key (not echoed)' -AsSecureString
      $key = ConvertFrom-DhSecureString $secure
    }
    if (-not $key) { throw((New-DhError 'No API key available for -IncludeApiKey.')) }
  }

  $payload = 'droidmobile://pair?v=1&url=' + (ConvertTo-DhQueryValue $Url)
  if ($key) { $payload += '&key=' + (ConvertTo-DhQueryValue $key) }
  if ($BridgeUrl) { $payload += '&bridge=' + (ConvertTo-DhQueryValue $BridgeUrl) + '&bridgeSecret=' + (ConvertTo-DhQueryValue $secret) }

  if ($key) {
    Write-Host 'WARNING: this pairing code contains your Factory API key. Show it only to your own phone,' -ForegroundColor Yellow
    Write-Host 'do not paste it into chats or tickets, and clear this window afterwards. Nothing was saved.' -ForegroundColor Yellow
  } elseif ($BridgeUrl) {
    Write-Host 'Note: this pairing code contains the bridge pairing secret. Do not share or save the output.'
  }
  Write-Host 'Pairing code (paste into the app via "Paste pairing code", or scan the QR):'
  Write-Host $payload
  if (-not $NoQr) {
    $rows = Get-DhQrRows -Payload $payload
    if ($rows) {
      Write-Host ''
      Write-DhQrBlock -Rows $rows
      Write-Host ''
    } else {
      Write-Host 'QR block skipped: Node.js or the qrcode-generator package (npm install in the repo) is not available.'
    }
  }
  $global:LASTEXITCODE = 0
  if ($PassThru) { return $payload }
}
