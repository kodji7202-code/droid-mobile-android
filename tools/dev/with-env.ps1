# with-env.ps1 - load .env.local into the current process, then run the given command.
#
# Usage (from the repo root):
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\dev\with-env.ps1 <command> [args...]
#   e.g.: ... with-env.ps1 npm run dev -w @droidmobile/fcm-bridge -- --port 3102
#
# Values are NEVER printed; only the variable NAMES are reported. Deliberately no param()
# block: a param block makes PowerShell treat `-w`-style child arguments as its own
# parameters (verified on this host); $args receives everything verbatim instead.
$ErrorActionPreference = 'Stop'
if ($args.Count -lt 1) {
  'usage: with-env.ps1 <command> [args...]'
  exit 2
}

$envFile = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path '.env.local'
if (-not (Test-Path $envFile)) {
  "ERROR: $envFile not found"
  exit 1
}

$loaded = @()
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
    $name = $Matches[1]
    $value = $Matches[2]
    if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    Set-Item -Path "env:$name" -Value $value
    $loaded += $name
  }
}
"loaded $($loaded.Count) variable(s) from .env.local: $($loaded -join ', ')"

$Command = $args[0]
$rest = @()
if ($args.Count -gt 1) {
  $rest = @($args | Select-Object -Skip 1)
}
& $Command @rest
exit $LASTEXITCODE
