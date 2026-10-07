# Shared helpers for the DroidMobileHelper module. ASCII only: Windows PowerShell 5.1
# reads BOM-less .ps1 files in the ANSI code page.

$script:DhHealthBody = 'factory-daemon ok'

function Resolve-DhFullPath {
  # Caller-owned paths must be absolute before the helper detaches a process or persists a hook
  # command: both later run from a different working directory.
  param([Parameter(Mandatory)][string]$Path)
  return $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
}

function Get-DhStateDir {
  param([string]$StateDir)
  if ($StateDir) { return (Resolve-DhFullPath $StateDir) }
  if ($env:DROIDMOBILE_HELPER_HOME) { return (Resolve-DhFullPath $env:DROIDMOBILE_HELPER_HOME) }
  $base = $env:LOCALAPPDATA
  if (-not $base) { $base = [Environment]::GetFolderPath('LocalApplicationData') }
  return (Join-Path $base 'DroidMobileHelper')
}

function Initialize-DhDirectory {
  param([Parameter(Mandatory)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { New-Item -ItemType Directory -Force -Path $Path | Out-Null }
}

function Get-DhWindowsPowerShell {
  # The supervisor must run under Windows PowerShell even when the caller is PowerShell 7.
  $candidate = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  if (Test-Path -LiteralPath $candidate) { return $candidate }
  return 'powershell.exe'
}

function ConvertTo-DhArgument {
  param([string]$Value)
  if ($Value -eq '') { return '""' }
  if ($Value -notmatch '[\s"]') { return $Value }
  $escaped = $Value -replace '(\\*)"', '$1$1\"'
  $escaped = $escaped -replace '(\\+)$', '$1$1'
  return '"' + $escaped + '"'
}

function Invoke-DhNative {
  # Runs a native program without PowerShell's stderr-as-error behaviour and with a timeout.
  param(
    [Parameter(Mandatory)][string]$FilePath,
    [string[]]$ArgumentList = @(),
    [string]$InputText,
    [int]$TimeoutSec = 30
  )
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $FilePath
  $psi.Arguments = (($ArgumentList | ForEach-Object { ConvertTo-DhArgument $_ }) -join ' ')
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.RedirectStandardInput = $true
  $proc = [System.Diagnostics.Process]::Start($psi)
  $outTask = $proc.StandardOutput.ReadToEndAsync()
  $errTask = $proc.StandardError.ReadToEndAsync()
  if ($InputText) { $proc.StandardInput.Write($InputText) }
  $proc.StandardInput.Close()
  if (-not $proc.WaitForExit($TimeoutSec * 1000)) {
    try { $proc.Kill() } catch { }
    return [pscustomobject]@{ ExitCode = -1; Stdout = ''; Stderr = "timed out after $TimeoutSec s"; TimedOut = $true }
  }
  $proc.WaitForExit()
  return [pscustomobject]@{
    ExitCode = $proc.ExitCode
    Stdout   = $outTask.Result
    Stderr   = $errTask.Result
    TimedOut = $false
  }
}

function Get-DhProcessInfo {
  param([int]$ProcessId)
  if ($ProcessId -le 0) { return $null }
  return (Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue)
}

function Get-DhStartTime {
  param($ProcessInfo)
  return $ProcessInfo.CreationDate.ToUniversalTime().ToString('o')
}

function Test-DhSameInstant {
  param([string]$A, [string]$B)
  if (-not $A -or -not $B) { return $false }
  return (([datetime]$A).ToUniversalTime().Ticks -eq ([datetime]$B).ToUniversalTime().Ticks)
}

function Get-DhPortListeners {
  param([int]$Port)
  $rows = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if (-not $rows) { return @() }
  return @($rows)
}

function Test-DhDaemonHealth {
  param([int]$Port, [int]$TimeoutSec = 3)
  try {
    $request = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$Port/health")
    $request.Timeout = $TimeoutSec * 1000
    $request.Proxy = $null
    $response = $request.GetResponse()
    try {
      $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
      $body = $reader.ReadToEnd()
    } finally {
      $response.Close()
    }
    return ($body.Trim() -eq $script:DhHealthBody)
  } catch {
    return $false
  }
}

function Read-DhJsonFile {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  try {
    return (Get-Content -LiteralPath $Path -Raw -ErrorAction Stop | ConvertFrom-Json)
  } catch {
    return $null
  }
}

function Write-DhJsonFile {
  # Write to a temp file and rename so a crash never leaves a half-written record.
  param([string]$Path, $Value)
  $tmp = "$Path.$PID.tmp"
  $json = $Value | ConvertTo-Json -Depth 6
  [System.IO.File]::WriteAllText($tmp, $json, (New-Object System.Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $tmp -Destination $Path -Force
}

function Write-DhLogLine {
  param([string]$Path, [string]$Message)
  $stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  Add-Content -LiteralPath $Path -Value "$stamp $Message" -Encoding ASCII
}

function Stop-DhProcessTree {
  param([int]$ProcessId)
  & taskkill.exe /PID $ProcessId /T /F 2>&1 | Out-Null
}

function New-DhError {
  # Callers `throw` the result. It must be `throw`, not ThrowTerminatingError: the latter only
  # ends the statement, so a `powershell -File` caller would still exit 0.
  param([Parameter(Mandatory)][string]$Message)
  $exception = New-Object System.InvalidOperationException($Message)
  return (New-Object System.Management.Automation.ErrorRecord($exception, 'DroidMobileHelper', [System.Management.Automation.ErrorCategory]::InvalidOperation, $null))
}
