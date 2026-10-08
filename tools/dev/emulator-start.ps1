# Starts the droid-api36 emulator detached via WMI/CIM (survives this shell) and waits for boot.
# Cold boot is ~79 s. Afterwards delete <AVD home>\droid-api36.avd\snapshots (the emulator
# writes a ~3 GB snapshot at exit even with -no-snapshot-save). Needs an AVD named droid-api36.
#
# Usage (from repo root):
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\dev\emulator-start.ps1
#   ... -NoBootWait   (return right after spawning)
param(
    [switch]$NoBootWait
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\env-android.ps1"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$logDir = Join-Path $repoRoot '.tmp\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$adb = "$env:ANDROID_HOME\platform-tools\adb.exe"

function Test-BootCompleted {
    $out = cmd /c "`"$adb`" -s emulator-5554 shell getprop sys.boot_completed 2>nul"
    return ("$out".Trim() -eq '1')
}

$existing = & $adb devices 2>$null
if ("$existing" -match 'emulator-5554\s+device' -or (Test-BootCompleted)) {
    Write-Host 'emulator-5554 already running'
    return
}

$emuOut = Join-Path $logDir 'emu.out.log'
$emuErr = Join-Path $logDir 'emu.err.log'
# The WMI-spawned process does NOT inherit this shell's env vars, so ANDROID_AVD_HOME
# (AVD home on D:) must be set inside the spawned cmd line itself.
$inner = 'set ANDROID_AVD_HOME=' + $env:ANDROID_AVD_HOME + '&& ' + '"' + "$env:ANDROID_HOME\emulator\emulator.exe" + '" -avd droid-api36 -port 5554 -no-snapshot-save -no-snapshot-load -no-audio -no-boot-anim -gpu swiftshader_indirect -netdelay none -netspeed full > "' + $emuOut + '" 2> "' + $emuErr + '"'
$cmdLine = 'cmd /s /c "' + $inner + '"'
$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmdLine; CurrentDirectory = $logDir }
if ($r.ReturnValue -ne 0) { throw "Win32_Process.Create returned $($r.ReturnValue)" }
Write-Host "emulator cmd pid $($r.ProcessId)"
if ($NoBootWait) { return }

$deadline = (Get-Date).AddSeconds(240)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    if (Test-BootCompleted) {
        Write-Host 'emulator-5554 booted'
        return
    }
}
Write-Host "ERROR: emulator did not finish booting within 240 s; last log lines:"
if (Test-Path $emuErr) { Get-Content $emuErr -Tail 15 }
if (Test-Path $emuOut) { Get-Content $emuOut -Tail 15 }
exit 1
