# Scans the tracked working tree and every revision (git rev-list --all) for secrets and signing
# material. Prints match counts per pattern only, never matched text. Exits 1 on any match.
#
# Usage (from repo root):
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\dev\scan-repo-secrets.ps1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path "$PSScriptRoot\..\..")

$revs = @(git rev-list --all)
Write-Host "revisions scanned: $($revs.Count)"
$probe = 'fk-invalid-validation-probe'
$total = 0

function Report([string]$name, [int]$count) {
    Write-Host ("{0,-34} {1}" -f $name, $count)
    $script:total += $count
}

# Content patterns (extended regex). The KEY-LEAK-SCAN pattern ignores the documented probe key.
$patterns = [ordered]@{
    'fk- token outside *.test.* files' = 'fk-[A-Za-z0-9_-]{8,}'
    'service_account json type' = '"type": *"service_account"'
    'PEM private key'           = 'BEGIN (RSA |EC )?PRIVATE KEY'
    'private_key_id'            = 'private_key_id'
}
foreach ($name in $patterns.Keys) {
    $hits = 0
    foreach ($target in @($null) + $revs) {
        $gitArgs = @('grep', '-I', '-h', '-o', '-E', $patterns[$name])
        if ($target) { $gitArgs += $target }
        $gitArgs += '--'
        # Unit tests use obviously fake fk- literals (not secrets); they cannot be removed from history.
        if ($name -like 'fk-*') { $gitArgs += ':(exclude)*.test.*' }
        $out = @(& git @gitArgs 2>$null)
        if ($name -like 'fk-*') {
            $out = @($out | ForEach-Object { $_ -replace [regex]::Escape($probe), '' } | Where-Object { $_ -match 'fk-[A-Za-z0-9_-]{8,}' })
        }
        $hits += $out.Count
    }
    Report $name $hits
}

# The real key value from .env.local, passed to git through a pattern file (not a command line).
$keyHits = 0
if (Test-Path '.env.local') {
    $line = Get-Content '.env.local' | Where-Object { $_ -match '^FACTORY_API_KEY=.+' } | Select-Object -First 1
    if ($line) {
        $patternFile = Join-Path $env:TEMP "scan-$([guid]::NewGuid().ToString('N')).txt"
        try {
            Set-Content -Path $patternFile -Value (($line -replace '^FACTORY_API_KEY=', '').Trim().Trim('"')) -Encoding ascii
            foreach ($target in @($null) + $revs) {
                $gitArgs = @('grep', '-I', '-l', '-F', '-f', $patternFile)
                if ($target) { $gitArgs += $target }
                $gitArgs += '--'
                $keyHits += @(& git @gitArgs 2>$null).Count
            }
        } finally {
            Remove-Item $patternFile -Force -ErrorAction SilentlyContinue
        }
    }
}
Report 'KEY value from .env.local' $keyHits

# Forbidden paths: currently tracked, and anywhere in history.
$pathRegex = '(\.jks|\.keystore|\.p12|keystore\.properties|google-services\.json|\.env\.local|service-account[^/]*\.json)$|(^|/)secrets/'
Report 'tracked forbidden paths' @(git ls-files | Where-Object { $_ -match $pathRegex }).Count
$historic = @(git log --all --name-only --pretty=format: | Where-Object { $_ -match $pathRegex } | Sort-Object -Unique)
Report 'forbidden paths in history' $historic.Count

if ($total -gt 0) { exit 1 }
Write-Host 'repo secret scan OK'
