# Dot-source me: Android/Gradle toolchain environment for this shell session.
# JDK 21 is REQUIRED (JDK 17 fails the Capacitor 8 / AGP 8.13 toolchain check).
# Caches and AVD home live on D: (C: has only ~6 GB free).
$env:JAVA_HOME = 'D:\droid-tools\jdk-21'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:GRADLE_USER_HOME = 'D:\droid-tools\gradle-home'
$env:ANDROID_AVD_HOME = 'D:\droid-tools\avd'
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\cmdline-tools\latest\bin;$env:ANDROID_HOME\emulator;$env:Path"
