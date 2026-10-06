# One-time: generates the local release keystore and keystore.properties under secrets/
# (git-ignored). Refuses to overwrite an existing keystore: replacing the key would make
# every previously installed release APK un-updatable.
#
# Usage (from repo root):
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\dev\new-release-keystore.ps1
param(
    [string]$Alias = 'droidmobile-release',
    [string]$DistinguishedName = 'CN=Droid Mobile Release, O=Droid Mobile (unofficial), C=RO'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\env-android.ps1"

$repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$secrets = Join-Path $repo 'secrets'
$keystore = Join-Path $secrets 'release.keystore'
$props = Join-Path $secrets 'keystore.properties'

if ((Test-Path $keystore) -or (Test-Path $props)) {
    Write-Host "Release keystore already exists in $secrets; nothing to do."
    return
}
New-Item -ItemType Directory -Force $secrets | Out-Null

$bytes = New-Object byte[] 24
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
# Hex keeps the password free of characters that need escaping in .properties files.
$password = -join ($bytes | ForEach-Object { $_.ToString('x2') })

# PKCS12 uses one password for store and key; keytool reads it from the environment so
# it never appears on a command line.
$env:DROID_KS_PASS = $password
try {
    & keytool -genkeypair -v -storetype PKCS12 -keystore $keystore -alias $Alias `
        -keyalg RSA -keysize 4096 -validity 10000 -dname $DistinguishedName `
        -storepass:env DROID_KS_PASS -keypass:env DROID_KS_PASS | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'keytool failed' }
} finally {
    Remove-Item Env:DROID_KS_PASS -ErrorAction SilentlyContinue
}

@(
    'storeFile=release.keystore'
    "storePassword=$password"
    "keyAlias=$Alias"
    "keyPassword=$password"
) | Set-Content -Path $props -Encoding ascii

Write-Host "Created $keystore and $props (both git-ignored). Back them up: losing the key means releases can no longer be updated in place."
