# Dot-source me: Android/Gradle toolchain environment for this shell session.
# JDK 21 is REQUIRED (JDK 17 fails the Capacitor 8 / AGP 8.13 toolchain check).
#
# Optional tools folder (DROIDMOBILE_TOOLS_DIR, default D:\droid-tools) with these subfolders:
#   jdk-21\       JDK 21 (used as JAVA_HOME when present; otherwise your JAVA_HOME is kept)
#   gradle-home\  GRADLE_USER_HOME (keeps the Gradle cache off the system drive)
#   avd\          ANDROID_AVD_HOME (emulator images)
# Without that folder the defaults of your machine apply and JAVA_HOME must already be JDK 21.
$toolsDir = if ($env:DROIDMOBILE_TOOLS_DIR) { $env:DROIDMOBILE_TOOLS_DIR } else { 'D:\droid-tools' }
if (Test-Path "$toolsDir\jdk-21\bin\java.exe") { $env:JAVA_HOME = "$toolsDir\jdk-21" }
if (Test-Path "$toolsDir\gradle-home") { $env:GRADLE_USER_HOME = "$toolsDir\gradle-home" }
if (Test-Path "$toolsDir\avd") { $env:ANDROID_AVD_HOME = "$toolsDir\avd" }
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk" }
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$javaBin = if ($env:JAVA_HOME) { "$env:JAVA_HOME\bin;" } else { '' }
$env:Path = "$javaBin$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\cmdline-tools\latest\bin;$env:ANDROID_HOME\emulator;$env:Path"
