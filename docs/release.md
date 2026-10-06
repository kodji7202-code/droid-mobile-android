# Release build and signing

Droid Mobile is an unofficial client. Release builds are signed with a key you generate
locally; nothing here uploads anything.

## One command

```powershell
npm run android:release
```

It runs, in order: the `google-services.json` copy from `secrets/`, the one-time keystore
creation (skipped when it exists), the web build with `VITE_DROID_BUILD=release`,
`cap sync` with `CAPACITOR_VARIANT=release`, `gradlew assembleRelease bundleRelease` and
finally `tools/dev/verify-release.ps1`. No password is typed or passed on the command line.

Outputs (same release key):

| Artifact | Path                                                                   |
| -------- | ---------------------------------------------------------------------- |
| APK      | `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`    |
| AAB      | `apps/mobile/android/app/build/outputs/bundle/release/app-release.aab` |

Prerequisites are the ones in [android.md](android.md) (JDK 21, Android SDK with
build-tools) plus Node 24.

## Signing material

`tools/dev/new-release-keystore.ps1` (`npm run android:keystore`) creates, once:

- `secrets/release.keystore`: PKCS12, RSA 4096, alias `droidmobile-release`, valid ~27 years.
- `secrets/keystore.properties`: `storeFile`, `storePassword`, `keyAlias`, `keyPassword`
  (a random password generated on your machine).

`secrets/` is git-ignored, as are `*.keystore`, `*.jks`, `keystore.properties` and
`google-services.json`. The script never overwrites an existing keystore: replacing the key
would stop already installed releases from updating. **Back both files up.**
Set `DROID_KEYSTORE_PROPERTIES` to use a properties file somewhere else. Gradle refuses to
build a release artifact when no signing configuration is found; it never falls back to the
debug key.

## Firebase config

`build-android.ps1` copies `secrets/google-services.json` (or the path in
`GOOGLE_SERVICES_JSON_PATH` from `.env.local`) to `apps/mobile/android/app/` before every
build. The copy is git-ignored. `verify-release.ps1` checks that its `package_name` equals the
application id.

## What `verify-release.ps1` checks

Run it alone with `npm run android:verify-release`. It prints PASS/FAIL per check and
exits non-zero on any failure. Only booleans, counts and certificate fingerprints are printed.

- `apksigner verify` (v2 and v3, one signer, not the debug certificate), `zipalign -c 4`.
- `jarsigner -verify` for the AAB and equality of the AAB and APK signer SHA-256.
- Application id `com.droidmobile.client`, min SDK 24, target SDK 36, label `Droid Mobile`.
- No `usesCleartextTraffic`, no `debuggable`, `allowBackup="false"`.
- `assets/capacitor.config.json`: `https` scheme, no `server.cleartext` or `server.url`,
  WebView debugging off.
- No file in the APK with `factory` in its name.
- No API key, `fk-` token, service-account key id or PEM private key in any entry
  of the APK or AAB.

## Install on a phone

Debug and release builds share the application id but not the signature, so uninstall first:

```powershell
adb -s <serial> uninstall com.droidmobile.client
adb -s <serial> install apps\mobile\android\app\build\outputs\apk\release\app-release.apk
```

## Release transport policy

Release builds only connect over `wss://`. A `ws://` address (typed or from a pairing
code) is refused with a message before any socket is opened. A convenient secure path to a
desktop daemon is Tailscale Serve (for example `tailscale serve --bg --https=8443
http://127.0.0.1:3101`, then `wss://<your-machine>.<tailnet>.ts.net:8443`). Debug builds
keep `ws://` for the emulator and `adb reverse`; see [android.md](android.md).

## Repository hygiene

`npm run scan:secrets` scans the tracked tree and every revision for API-key shaped tokens (outside unit-test fixtures), service-account JSON, PEM private keys, the key stored in `.env.local`, and signing or Firebase files. It prints counts only and exits non-zero on any match.
