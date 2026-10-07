# Security notes

## Your API key

- On the phone the Factory API key lives only in Android Keystore-backed secure storage. It is
  never written to web storage, URLs, logs, crash reports or backups (`android:allowBackup` is
  off). The web build keeps it in memory only.
- On the development PC the key lives only in `.env.local`. That file, `secrets/`, `.tmp/`,
  keystores, `google-services.json` and Firebase service accounts are git-ignored. Check
  `git status` before every commit and run `npm run scan:secrets` to scan the tree and history.
- The PC helper never prints the key by default. `New-PairingCode -IncludeApiKey` is the one
  exception: it shows the key on screen with a warning and writes it nowhere.
- Errors and diagnostic output redact keys, tokens and bridge secrets. **Settings > About &
  diagnostics** exports a redacted log bundle you can share.
- An optional app lock (**Settings > Security**) asks for your fingerprint, face or screen lock
  when the app opens and before connection details are shown.

## Transport policy

- Release builds use `wss://` only: no cleartext traffic in the manifest, no `http` WebView
  origin, no debuggable WebView. A `ws://` address is refused before any socket opens.
- Debug builds may use `ws://` for the emulator (`10.0.2.2`) and for `adb reverse`, and show an
  insecure-endpoint banner when they do. Never ship a debug build.
- The daemon itself listens on `127.0.0.1` without TLS. Never bind it to a public or LAN address;
  reach it through Tailscale Serve, which adds TLS.

## Tailnet exposure

Tailscale Serve publishes the daemon to your tailnet, not to the internet. Every device and
user that your tailnet policy lets reach the PC on that port can open a connection to the
daemon, and the API key is what authenticates them. Keep the tailnet small, use Tailscale ACLs
to limit who can reach the PC, and turn the entry off when you do not need it
(`Disable-TailscaleServe -Port 8443`, which restores the serve state recorded before). Do not use
Tailscale Funnel for this daemon: that would put it on the public internet.

The FCM bridge speaks plain HTTP. Phones and remote hooks must reach it over `https://`
([bridge README](../server/fcm-bridge/README.md#deploy-behind-tls)). It only holds device tokens
and a salted hash of its pairing secret. Push payloads carry the event kind and the session id
only.

## Key rotation

Rotate a secret as soon as it may have been seen by someone else.

| Secret                   | How to rotate                                                                                                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Factory API key          | Create a new key in your Factory account and revoke the old one. In the app: **Settings > Connection**, edit the connection and enter the new key. Update `.env.local` on the PC. |
| FCM bridge secret        | `npm run generate-secret -w @droidmobile/fcm-bridge -- --rotate`; then `Install-DroidHooks` with the new secret and register each phone again.                                    |
| Firebase service account | Create a new key in the Firebase console, point `FIREBASE_SERVICE_ACCOUNT_PATH` at it, delete the old key.                                                                        |
| Release keystore         | Do not replace it casually: a new key stops installed releases from updating. See [release.md](release.md).                                                                       |

Anything pasted into a chat, ticket or screenshot counts as seen. The key used while this
project was developed is rotated by its owner after development.

## Reporting a problem

Please do not post keys or tokens in issues. Describe the problem and attach the redacted
diagnostics export instead.
