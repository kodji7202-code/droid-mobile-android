# Static verification of the signed release artifacts (no device needed). Prints booleans,
# counts and certificate fingerprints only, never secret values. Exits non-zero on any failure.
#
# Usage (from repo root):
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\dev\verify-release.ps1
param(
    [string]$Apk = 'apps\mobile\android\app\build\outputs\apk\release\app-release.apk',
    [string]$Aab = 'apps\mobile\android\app\build\outputs\bundle\release\app-release.aab'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\env-android.ps1"

$repo = (Resolve-Path "$PSScriptRoot\..\..").Path
Set-Location $repo
Add-Type -AssemblyName System.IO.Compression.FileSystem

$buildTools = Get-ChildItem "$env:ANDROID_HOME\build-tools" -Directory |
    Where-Object { Test-Path (Join-Path $_.FullName 'apksigner.bat') } |
    Sort-Object { [version]($_.Name -replace '-.*$', '') } -Descending | Select-Object -First 1
if (-not $buildTools) { throw 'No Android build-tools with apksigner found' }
$bt = $buildTools.FullName
$apkanalyzer = "$env:ANDROID_HOME\cmdline-tools\latest\bin\apkanalyzer.bat"

$failures = New-Object System.Collections.Generic.List[string]
function Check([string]$name, [bool]$ok, [string]$detail = '') {
    $status = if ($ok) { 'PASS' } else { 'FAIL' }
    Write-Host ("{0}  {1}{2}" -f $status, $name, $(if ($detail) { "  ($detail)" } else { '' }))
    if (-not $ok) { $failures.Add($name) }
}

foreach ($f in $Apk, $Aab) {
    Check "exists and non-empty: $f" ((Test-Path $f) -and ((Get-Item $f).Length -gt 0)) $(if (Test-Path $f) { "$((Get-Item $f).Length) bytes" })
}
if ($failures.Count -gt 0) { throw 'artifacts missing' }

# --- signatures -------------------------------------------------------------------------
$verify = (& "$bt\apksigner.bat" verify --verbose --print-certs $Apk) -join "`n"
Check 'apksigner verify' ($LASTEXITCODE -eq 0 -and $verify -match 'Verifies')
Check 'APK scheme v2 and v3' ($verify -match 'v2 scheme \(APK Signature Scheme v2\): true' -and $verify -match 'v3 scheme \(APK Signature Scheme v3\): true')
Check 'APK has exactly one signer' ($verify -match 'Number of signers: 1')
$dn = [regex]::Match($verify, 'certificate DN: (.+)').Groups[1].Value.Trim()
Check 'APK certificate is not the debug certificate' ($dn -ne '' -and $dn -notmatch 'Android Debug') $dn
$apkSha = [regex]::Match($verify, 'certificate SHA-256 digest: ([0-9a-f]+)').Groups[1].Value
& "$bt\zipalign.exe" -c 4 $Apk
Check 'zipalign -c 4' ($LASTEXITCODE -eq 0)

$jar = (& jarsigner -verify $Aab 2>&1) -join "`n"
Check 'jarsigner -verify AAB' ($jar -match 'jar verified')
$certOut = (& keytool -printcert -jarfile $Aab) -join "`n"
$aabSha = ([regex]::Match($certOut, 'SHA256:\s*([0-9A-F:]+)').Groups[1].Value -replace ':', '').ToLower()
Check 'AAB signer SHA-256 equals APK signer SHA-256' ($aabSha -ne '' -and $aabSha -eq $apkSha) $apkSha

# --- manifest ---------------------------------------------------------------------------
$appId = (& $apkanalyzer manifest application-id $Apk) -join ''
Check 'application id' ($appId.Trim() -eq 'com.droidmobile.client') $appId.Trim()
Check 'min-sdk 24' (((& $apkanalyzer manifest min-sdk $Apk) -join '').Trim() -eq '24')
Check 'target-sdk 36' (((& $apkanalyzer manifest target-sdk $Apk) -join '').Trim() -eq '36')
$manifest = (& $apkanalyzer manifest print $Apk) -join "`n"
Check 'no usesCleartextTraffic=true' ($manifest -notmatch 'usesCleartextTraffic="true"')
Check 'no debuggable=true' ($manifest -notmatch 'debuggable="true"')
Check 'allowBackup=false' ($manifest -match 'allowBackup="false"')
Check 'no networkSecurityConfig permitting cleartext' ($manifest -notmatch 'cleartextTrafficPermitted="true"')
$badging = (& "$bt\aapt2.exe" dump badging $Apk) -join "`n"
$label = [regex]::Match($badging, "application-label:'([^']*)'").Groups[1].Value
Check 'application label is Droid Mobile' ($label -eq 'Droid Mobile') $label

$gsFile = 'secrets\google-services.json'
if (Test-Path $gsFile) {
    $gsPackages = @((Get-Content $gsFile -Raw | ConvertFrom-Json).client | ForEach-Object { $_.client_info.android_client_info.package_name })
    Check 'application id equals google-services.json package_name' ($gsPackages -contains $appId.Trim())
}

# --- capacitor config in the APK assets -----------------------------------------------------
$zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path $Apk).Path)
try {
    $entry = $zip.GetEntry('assets/capacitor.config.json')
    $reader = New-Object System.IO.StreamReader($entry.Open())
    $cfg = $reader.ReadToEnd() | ConvertFrom-Json
    $reader.Dispose()
    $server = $cfg.PSObject.Properties['server']
    $serverValue = if ($server) { $server.Value } else { $null }
    $scheme = if ($serverValue -and $serverValue.PSObject.Properties['androidScheme']) { $serverValue.androidScheme } else { 'https' }
    Check 'capacitor androidScheme is https' ($scheme -eq 'https') $scheme
    Check 'capacitor has no server.cleartext / server.url' (-not ($serverValue -and ($serverValue.PSObject.Properties['cleartext'] -or $serverValue.PSObject.Properties['url'])))
    $android = $cfg.PSObject.Properties['android']
    $debugging = $android -and $android.Value.PSObject.Properties['webContentsDebuggingEnabled'] -and $android.Value.webContentsDebuggingEnabled
    Check 'WebView debugging disabled' (-not $debugging)

    $names = $zip.Entries | ForEach-Object { $_.FullName }
    # META-INF/services/kotlinx.coroutines.internal.MainDispatcherFactory is a library service file, not branding.
    Check 'no res/ or assets/ file name contains "factory"' (@($names | Where-Object { $_ -match '^(res|assets)/' -and $_ -match '(?i)factory' }).Count -eq 0)
} finally {
    $zip.Dispose()
}

# --- secrets in the artifacts --------------------------------------------------------------
$envKey = $null
if (Test-Path '.env.local') {
    $line = Get-Content '.env.local' | Where-Object { $_ -match '^FACTORY_API_KEY=' } | Select-Object -First 1
    if ($line) { $envKey = ($line -replace '^FACTORY_API_KEY=', '').Trim().Trim('"') }
}
$serviceAccountKeyId = $null
if (Test-Path 'secrets\firebase-service-account.json') {
    $serviceAccountKeyId = (Get-Content 'secrets\firebase-service-account.json' -Raw | ConvertFrom-Json).private_key_id
}
$latin1 = [System.Text.Encoding]::GetEncoding(28591)
$probe = 'fk-invalid-validation-probe'
$leakRegex = New-Object System.Text.RegularExpressions.Regex 'fk-[A-Za-z0-9_-]{8,}'
foreach ($artifact in $Apk, $Aab) {
    $counts = @{ key = 0; keyPattern = 0; privateKeyId = 0; pem = 0 }
    $archive = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path $artifact).Path)
    try {
        foreach ($e in $archive.Entries) {
            if ($e.Length -eq 0) { continue }
            $stream = $e.Open()
            $ms = New-Object System.IO.MemoryStream
            $stream.CopyTo($ms); $stream.Dispose()
            $text = $latin1.GetString($ms.ToArray()); $ms.Dispose()
            if ($envKey -and $text.Contains($envKey)) { $counts.key++ }
            $counts.keyPattern += $leakRegex.Matches($text.Replace($probe, '')).Count
            if ($serviceAccountKeyId -and $text.Contains($serviceAccountKeyId)) { $counts.privateKeyId++ }
            if ($text -match 'BEGIN (RSA |EC )?PRIVATE KEY') { $counts.pem++ }
        }
    } finally {
        $archive.Dispose()
    }
    $total = $counts.key + $counts.keyPattern + $counts.privateKeyId + $counts.pem
    Check "no secrets in $(Split-Path $artifact -Leaf)" ($total -eq 0) ("key={0} KEY-LEAK-SCAN={1} private_key_id={2} pem={3}" -f $counts.key, $counts.keyPattern, $counts.privateKeyId, $counts.pem)
}

if ($failures.Count -gt 0) {
    throw "release verification failed: $($failures -join '; ')"
}
Write-Host 'release verification OK'
