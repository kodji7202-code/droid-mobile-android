# Setup

This page covers the PC side: the daemon, Tailscale Serve and HTTPS certificates, and the
development setup. Connecting the phone is in [pairing.md](pairing.md); push notifications are in
[notifications.md](notifications.md).

## PC setup

### Prerequisites

- Windows 10 or 11 with Windows PowerShell 5.1 (PowerShell 7 also works).
- The Droid CLI (`droid.exe`) on `PATH` or at `%USERPROFILE%\bin\droid.exe`, signed in to Factory.
- Node.js 24 (npm 11) and git. Run `npm install` once in the repository root.
- Tailscale, signed in, on the PC and on the phone (same tailnet).
- Your own Factory API key (`fk-...`).

### The short way: the PC helper

The helper module in [tools/pc-helper](../tools/pc-helper/README.md) does the steps below and
records what it changed so it can undo it:

```powershell
Import-Module .\tools\pc-helper\DroidMobileHelper.psd1
Start-DroidDaemon -Port 3101
Enable-TailscaleServe -Port 8443 -DaemonPort 3101
Doctor -DaemonPort 3101
```

`Start-DroidDaemon` runs the daemon under a hidden supervisor that restarts it after a crash.
`Enable-TailscaleServe` prints the `wss://` address for the app. `Doctor` prints one PASS, WARN or
FAIL line per check, with a fix under every problem. Every command accepts `-WhatIf`.

### Start the daemon by hand

```powershell
droid daemon --host 127.0.0.1 --port 3101
```

Keep `--host 127.0.0.1`. The daemon has no TLS of its own, so Tailscale Serve (below) is the way
to reach it from the phone. Check it with `Invoke-WebRequest http://127.0.0.1:3101/health`, which
answers `factory-daemon ok`. The repository script `tools\dev\start-daemon.ps1` starts a detached
daemon for development and tests (log files in `.tmp\logs`, PID file in `.tmp`).

### Tailscale Serve and HTTPS certificates

Release builds of the app accept `wss://` only, so the daemon needs a real TLS address. Tailscale
provides one for every machine in your tailnet.

1. In the Tailscale admin console, open the **DNS** page and turn on **MagicDNS** and **HTTPS
   certificates**. Without them `tailscale serve --https` fails and `Doctor` reports the
   "HTTPS certificates" check as FAIL.
2. Publish the daemon:

   ```powershell
   tailscale serve --bg --https=8443 http://127.0.0.1:3101
   tailscale serve status
   ```

   or, with the helper, `Enable-TailscaleServe -Port 8443 -DaemonPort 3101`. The helper first
   records `tailscale serve status`, refuses to touch a serve entry it did not create, and
   `Disable-TailscaleServe -Port 8443` restores the recorded state.

3. The address for the app is `wss://<your-machine>.<tailnet>.ts.net:8443` (the MagicDNS name of
   the PC, shown by `tailscale status`). Tailscale Serve only reaches devices in your tailnet;
   nothing is opened to the internet. See [security.md](security.md#tailnet-exposure).

To stop publishing: `tailscale serve --https=8443 off`, or `Disable-TailscaleServe -Port 8443`.

### Optional: phone notifications

Install the FCM bridge and the Droid hooks as described in [notifications.md](notifications.md).
Skip this if in-app and background notifications are enough.

## Environment variables for development

`.env.local` at the repository root is git-ignored. It holds (names only):

| Variable                        | Used by                                        |
| ------------------------------- | ---------------------------------------------- |
| `FACTORY_API_KEY`               | daemon authentication (integration tests, app) |
| `TAILSCALE_HOSTNAME`            | PC helper, `wss://` endpoints                  |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | FCM bridge                                     |
| `GOOGLE_SERVICES_JSON_PATH`     | Android build                                  |

Load it into a command without printing values:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\dev\with-env.ps1 <command> [args...]
```

## Development setup

```powershell
npm install
npm run dev -w @droidmobile/mobile   # Vite dev server on http://127.0.0.1:3100 (the port is fixed)
```

Native builds need JDK 21 at `D:\droid-tools\jdk-21` (JDK 17 cannot build Capacitor 8 projects),
the Android SDK at `%LOCALAPPDATA%\Android\Sdk` and the Gradle 8.14.3 wrapper. The full native
workflow is in [android.md](android.md).

| Service             | Port      | Start                                    |
| ------------------- | --------- | ---------------------------------------- |
| Vite dev server     | 3100      | `npm run dev -w @droidmobile/mobile`     |
| droid daemon (test) | 3101      | `tools\dev\start-daemon.ps1`             |
| FCM bridge          | 3102      | `npm run dev -w @droidmobile/fcm-bridge` |
| Throwaway daemons   | 3103-3109 | `tools\dev\start-daemon.ps1 -Port <p>`   |

The daemon's `/health` endpoint answers on loopback only and sends no CORS headers, so browser
code never calls it. The app checks reachability by opening the WebSocket and authenticating.

Quality gates: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run docs:check`.

## Troubleshooting

See [troubleshooting.md](troubleshooting.md).
