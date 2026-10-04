# Installs an APK on the running emulator (default: the debug APK) and launches the app.
#
# Usage (from repo root):
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\dev\emulator-install.ps1
#   ... -ApkPath <path>   (e.g. the release APK)
#   ... -NoLaunch
param(
    [string]$ApkPath = "$PSScriptRoot\..\..\apps\mobile\android\app\build\outputs\apk\debug\app-debug.apk",
    # Target serial; default to the emulator (the phone may also be attached).
    [string]$Serial = 'emulator-5554',
    [switch]$NoLaunch
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\env-android.ps1"

$adb = "$env:ANDROID_HOME\platform-tools\adb.exe"
$ApkPath = (Resolve-Path $ApkPath).Path
& $adb -s $Serial install -r $ApkPath
if ($LASTEXITCODE -ne 0) { throw 'adb install failed' }
if (-not $NoLaunch) {
    & $adb -s $Serial shell am start -W -n com.droidmobile.client/.MainActivity
}
