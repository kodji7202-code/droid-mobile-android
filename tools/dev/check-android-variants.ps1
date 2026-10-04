# Automated transport-policy check for both build variants:
# 1. web build once
# 2. cap sync (CAPACITOR_VARIANT=debug)  + gradlew :app:processDebugMainManifest
# 3. cap sync (CAPACITOR_VARIANT=release) + gradlew :app:processReleaseMainManifest
# 4. vitest parses each variant's merged manifest and the synced capacitor.config.json
#    (apps/mobile/src/native/android-variants.test.ts)
#
# Usage (from repo root):
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\dev\check-android-variants.ps1
#   ... -SkipWebBuild   (reuse the existing dist/)
param(
    [switch]$SkipWebBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\env-android.ps1"

Set-Location (Resolve-Path "$PSScriptRoot\..\..")

if (-not $SkipWebBuild) {
    npm run build -w @droidmobile/mobile
    if ($LASTEXITCODE -ne 0) { throw 'web build failed' }
}

foreach ($variant in 'debug', 'release') {
    $env:CAPACITOR_VARIANT = $variant
    # cap sync must run from the workspace that owns capacitor.config.ts.
    Push-Location apps\mobile
    try {
        npx cap sync android
        if ($LASTEXITCODE -ne 0) { throw "cap sync ($variant) failed" }
    } finally {
        Pop-Location
    }
    Push-Location apps\mobile\android
    try {
        .\gradlew.bat ":app:process$($variant.Substring(0, 1).ToUpper() + $variant.Substring(1))MainManifest"
        if ($LASTEXITCODE -ne 0) { throw "manifest merge ($variant) failed" }
    } finally {
        Pop-Location
    }
}

Remove-Item Env:CAPACITOR_VARIANT
npx vitest run --project unit --maxWorkers=4 apps/mobile/src/native
if ($LASTEXITCODE -ne 0) { throw 'variant checks failed' }
Write-Host 'android variant checks OK'
