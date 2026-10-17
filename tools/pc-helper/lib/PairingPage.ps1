# QR page for New-PairingCode: a self-contained HTML file in a user-only directory, shown in the
# default browser while the user pairs the phone, then deleted. ASCII only: Windows PowerShell 5.1
# reads BOM-less .ps1 files in the ANSI code page.

$script:DhPairingPagePattern = 'droidmobile-pairing-*.html'

function Get-DhPairingDir {
  $base = $env:LOCALAPPDATA
  if (-not $base) { $base = [Environment]::GetFolderPath('LocalApplicationData') }
  return (Join-Path (Join-Path $base 'DroidMobile') 'pairing')
}

function Test-DhInteractiveConsole {
  # DROIDMOBILE_PAIRING_FORCE_WINDOW=1 is the documented test hook: redirected stdin is then read
  # for the Enter key instead of the console keyboard.
  if ($env:DROIDMOBILE_PAIRING_FORCE_WINDOW -eq '1') { return $true }
  if (-not [Environment]::UserInteractive) { return $false }
  if ([Console]::IsInputRedirected -or [Console]::IsOutputRedirected) { return $false }
  if (@([Environment]::GetCommandLineArgs()) -match '^-NonI') { return $false }
  return $true
}

function Initialize-DhPairingDir {
  # The page can carry the API key inside the QR, so the directory is closed to everyone but the
  # current user before any page is written. Returns $false when that could not be guaranteed.
  param([Parameter(Mandatory)][string]$Path)
  try {
    Initialize-DhDirectory $Path
    # The whole DACL is replaced rather than edited: an elevated session creates directories with
    # explicit SYSTEM and Administrators entries that icacls /inheritance:r would keep. .NET is used
    # instead of Get-Acl/Set-Acl because PSModulePath can load an incompatible security module.
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $security = New-Object System.Security.AccessControl.DirectorySecurity
    $security.SetAccessRuleProtection($true, $false)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
      $sid,
      [System.Security.AccessControl.FileSystemRights]::FullControl,
      ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit),
      [System.Security.AccessControl.PropagationFlags]::None,
      [System.Security.AccessControl.AccessControlType]::Allow)
    $security.AddAccessRule($rule)
    $info = New-Object System.IO.DirectoryInfo $Path
    $info.SetAccessControl($security)

    $actual = $info.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access)
    if (-not $actual.AreAccessRulesProtected) { return $false }
    $rules = @($actual.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
    if ($rules.Count -ne 1) { return $false }
    return ($rules[0].IdentityReference.Value -eq $sid.Value -and
      $rules[0].AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
      (($rules[0].FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl))
  } catch {
    return $false
  }
}

function Remove-DhStalePairingPages {
  param([Parameter(Mandatory)][string]$Path)
  Get-ChildItem -LiteralPath $Path -Filter $script:DhPairingPagePattern -File -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction SilentlyContinue
}

function ConvertTo-DhQrSvg {
  # One path of horizontal runs per row; no namespace attribute because the page is HTML5 and the
  # page must contain no URL at all.
  param([Parameter(Mandatory)][string[]]$Rows, [int]$SizePx = 520)
  $n = $Rows.Count
  $path = New-Object System.Text.StringBuilder
  for ($y = 0; $y -lt $n; $y++) {
    $row = $Rows[$y]
    $x = 0
    while ($x -lt $row.Length) {
      if ($row[$x] -ne '1') { $x++; continue }
      $start = $x
      while ($x -lt $row.Length -and $row[$x] -eq '1') { $x++ }
      $len = $x - $start
      [void]$path.Append("M$start $y" + "h$len" + 'v1' + "h-$len" + 'z')
    }
  }
  return ('<svg viewBox="0 0 {0} {0}" width="{1}" height="{1}" role="img" aria-label="Pairing QR code" shape-rendering="crispEdges">' -f $n, $SizePx) +
    ('<rect width="{0}" height="{0}" fill="#fff"/><path d="{1}" fill="#000"/></svg>' -f $n, $path.ToString())
}

function New-DhPairingPageHtml {
  param([Parameter(Mandatory)][string[]]$Rows, [bool]$IncludesKey)
  $svg = ConvertTo-DhQrSvg -Rows $Rows
  $keyNote = ''
  if ($IncludesKey) {
    $keyNote = '<p class="warn">This code contains your Factory API key. Show it only to your own phone.</p>'
  }
  return @"
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Droid Mobile pairing</title>
<style>
body { font-family: Segoe UI, Arial, sans-serif; margin: 0; padding: 24px; background: #f4f4f4; color: #111; text-align: center; }
main { display: inline-block; max-width: 640px; text-align: left; }
h1 { font-size: 1.4rem; text-align: center; }
.qr { background: #fff; padding: 8px; text-align: center; border-radius: 8px; }
.qr svg { max-width: 100%; height: auto; }
ol { line-height: 1.6; }
.warn { color: #8a4b00; font-weight: 600; }
.small { color: #555; font-size: 0.9rem; }
</style>
</head>
<body>
<main>
<h1>Pair Droid Mobile with this PC</h1>
<div class="qr">$svg</div>
<ol>
<li>Open Droid Mobile on your phone and go to the Connect screen.</li>
<li>Tap "Scan QR code" and point the camera at this code.</li>
<li>If scanning does not work, copy the pairing code printed in the PowerShell window and use "Paste pairing code" or the Paste button.</li>
</ol>
$keyNote
<p class="small">This page is private to your Windows account. Press Enter in the PowerShell window once the phone is paired and the page is deleted.</p>
</main>
</body>
</html>
"@
}

function Wait-DhEnterKey {
  # Polls instead of blocking so Ctrl+C and PowerShell.Stop() reach the caller's finally block.
  if (-not [Console]::IsInputRedirected) {
    try {
      while ($true) {
        if ([Console]::KeyAvailable) {
          if ([Console]::ReadKey($true).Key -eq [ConsoleKey]::Enter) { return }
        } else {
          Start-Sleep -Milliseconds 150
        }
      }
    } catch {
      # No usable console keyboard (for example a hosted runspace): fall back to stdin below.
      if ($_.Exception -is [System.Management.Automation.PipelineStoppedException]) { throw }
    }
  }
  $stdin = [Console]::OpenStandardInput()
  $buffer = New-Object byte[] 256
  $pending = $stdin.ReadAsync($buffer, 0, $buffer.Length)
  while (-not $pending.Wait(200)) { }
}

function Show-DhPairingPage {
  param(
    [Parameter(Mandatory)][string[]]$Rows,
    [bool]$IncludesKey,
    [scriptblock]$Opener
  )
  $dir = Get-DhPairingDir
  if (-not (Initialize-DhPairingDir $dir)) {
    Write-Warning "The QR page was skipped: $dir could not be restricted to your Windows account."
    return
  }
  Remove-DhStalePairingPages $dir
  $file = Join-Path $dir ('droidmobile-pairing-' + [guid]::NewGuid().ToString('N') + '.html')
  try {
    [System.IO.File]::WriteAllText($file, (New-DhPairingPageHtml -Rows $Rows -IncludesKey $IncludesKey), (New-Object System.Text.UTF8Encoding($false)))
    try {
      if ($Opener) { & $Opener $file } else { Start-Process -FilePath $file }
    } catch {
      Write-Warning "Could not open the QR page automatically ($($_.Exception.Message)). Open this file yourself: $file"
    }
    Write-Host 'A larger QR code is open in your browser. Press Enter once the phone is paired (the page is then deleted).'
    Wait-DhEnterKey
  } finally {
    Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
  }
}
