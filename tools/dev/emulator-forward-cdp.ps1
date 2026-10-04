# Forwards a local port (3150-3159 reserved for CDP) to the WebView DevTools socket of the
# running app and verifies the DevTools endpoint answers. Re-run after EVERY app restart
# (the socket name contains the app pid), then `agent-browser --session <s> connect <port>`.
#
# Usage (from repo root):
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\dev\emulator-forward-cdp.ps1
#   ... -Port 3151
param(
    [ValidateRange(3150, 3159)]
    [int]$Port = 3150,
    # Target serial; default to the emulator (the phone may also be attached).
    [string]$Serial = 'emulator-5554'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\env-android.ps1"

$adb = "$env:ANDROID_HOME\platform-tools\adb.exe"
$appPid = (& $adb -s $Serial shell pidof com.droidmobile.client)
if (-not $appPid) { throw 'app is not running on the emulator (install + launch it first)' }
$appPid = "$appPid".Trim()

# Removing a not-yet-existing listener is fine (first run after boot).
try { & $adb -s $Serial forward --remove "tcp:$Port" 2>&1 | Out-Null } catch { }
& $adb -s $Serial forward "tcp:$Port" "localabstract:webview_devtools_remote_$appPid"
if ($LASTEXITCODE -ne 0) { throw 'adb forward failed' }
Invoke-WebRequest "http://127.0.0.1:$Port/json/version" -UseBasicParsing | Out-Null
Write-Host "CDP on $Port (pid $appPid)"
