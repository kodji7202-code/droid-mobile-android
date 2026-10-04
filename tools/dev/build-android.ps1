# Web build + cap sync + Gradle assemble for the chosen variant.
#
# The Capacitor variant (transport policy, architecture.md section 2) is selected ONLY through
# the CAPACITOR_VARIANT env consumed by capacitor.config.ts during `cap sync`:
#   debug   -> androidScheme http, WebView debugging on, cleartext via debug source set
#   release -> default https://localhost origin, no cleartext, wss-only
# Never hand-edit the generated android/ files to change variants.
#
# Usage (from repo root):
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\dev\build-android.ps1 -Variant debug
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\dev\build-android.ps1 -Variant release
#   ... -SyncOnly           (web build + cap sync, no Gradle)
#   ... -SkipWebBuild       (reuse the existing dist/)
param(
    [ValidateSet('debug', 'release')]
    [string]$Variant = 'debug',
    [switch]$SkipWebBuild,
    [switch]$SyncOnly,
    # Additionally run bundle<Variant> (AAB; meaningful for release).
    [switch]$Bundle
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\env-android.ps1"

Set-Location (Resolve-Path "$PSScriptRoot\..\..")

if (-not $SkipWebBuild) {
    $env:VITE_DROID_BUILD = $Variant
    npm run build -w @droidmobile/mobile
    if ($LASTEXITCODE -ne 0) { throw 'web build failed' }
}

$env:CAPACITOR_VARIANT = $Variant
# cap sync must run from the workspace that owns capacitor.config.ts.
Push-Location apps\mobile
try {
    npx cap sync android
    if ($LASTEXITCODE -ne 0) { throw 'cap sync failed' }
} finally {
    Pop-Location
}
if ($SyncOnly) { return }

$buildType = $Variant.Substring(0, 1).ToUpper() + $Variant.Substring(1)  # Debug / Release
$tasks = @("assemble$buildType")
if ($Bundle) { $tasks += "bundle$buildType" }
Push-Location apps\mobile\android
try {
    .\gradlew.bat @tasks
    if ($LASTEXITCODE -ne 0) { throw "gradlew $($tasks -join ' ') failed" }
} finally {
    Pop-Location
}

$apk = "apps\mobile\android\app\build\outputs\apk\$Variant\app-$Variant.apk"
Write-Host "android $Variant build OK: $apk"
