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

# google-services.json is git-ignored; the Gradle google-services plugin applies only when the
# copy next to build.gradle exists. Its source is secrets/ (or GOOGLE_SERVICES_JSON_PATH in .env.local).
$googleServicesTarget = 'apps\mobile\android\app\google-services.json'
$googleServicesSource = 'secrets\google-services.json'
if (-not (Test-Path $googleServicesSource) -and (Test-Path '.env.local')) {
    $pathLine = Get-Content '.env.local' | Where-Object { $_ -match '^GOOGLE_SERVICES_JSON_PATH=.+' } | Select-Object -First 1
    if ($pathLine) { $googleServicesSource = ($pathLine -replace '^GOOGLE_SERVICES_JSON_PATH=', '').Trim().Trim('"') }
}
if (Test-Path $googleServicesSource) {
    Copy-Item $googleServicesSource $googleServicesTarget -Force
} else {
    Write-Host 'WARN: no google-services.json in secrets/; building without Firebase (push will not work)'
    Remove-Item $googleServicesTarget -ErrorAction SilentlyContinue
}

if ($Variant -eq 'release') {
    # Creates the local release key on first use; a no-op afterwards.
    & "$PSScriptRoot\new-release-keystore.ps1"
}

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
if ($Variant -eq 'release' -and $Bundle) {
    Write-Host 'bundle: apps\mobile\android\app\build\outputs\bundle\release\app-release.aab'
    & "$PSScriptRoot\verify-release.ps1"
    if ($LASTEXITCODE -ne 0) { throw 'release verification failed' }
}
