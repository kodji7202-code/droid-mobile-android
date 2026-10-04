# Development setup

## Prerequisites

- Node.js 24, npm 11 (pinned toolchain for this project)
- git
- For native Android builds (later milestones): JDK 21 at `D:\droid-tools\jdk-21` (JDK 17
  cannot build Capacitor 8 projects), Android SDK at `%LOCALAPPDATA%\Android\Sdk`,
  Gradle 8.14.3 via the wrapper.

## Install and run

```powershell
npm install
npm run dev   # Vite dev server on http://127.0.0.1:3100 (port hardcoded in the script)
```

## Environment variables

`.env.local` at the repo root is git-ignored and holds (names only):

| Variable                        | Used by                                        |
| ------------------------------- | ---------------------------------------------- |
| `FACTORY_API_KEY`               | daemon authentication (integration tests, app) |
| `TAILSCALE_HOSTNAME`            | PC helper, `wss://` endpoints                  |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | FCM bridge                                     |
| `GOOGLE_SERVICES_JSON_PATH`     | Android build                                  |

Load it into a shell without printing values:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\dev\with-env.ps1 <command> [args...]
```

## Dev services

| Service             | Port      | Start                                      |
| ------------------- | --------- | ------------------------------------------ |
| Vite dev server     | 3100      | `npm run dev -w @droidmobile/mobile`       |
| droid daemon (test) | 3101      | `tools\dev\start-daemon.ps1`               |
| FCM bridge          | 3102      | FCM-bridge milestone (see `services.yaml`) |
| Throwaway daemons   | 3103-3109 | `tools\dev\start-daemon.ps1 -Port <p>`     |

The daemon health endpoint is `http://127.0.0.1:3101/health` (loopback only, returns
`factory-daemon ok`). Browser code must NOT probe it — the daemon sends no CORS headers;
the app checks reachability by opening the WebSocket and authenticating.

## Troubleshooting

- If port 3100 is taken, `--strictPort` makes Vite fail fast instead of drifting to another
  port; stop the process you started on 3100 (`stop-daemon.ps1` style PID lookup is
  restricted to the declared ports).
- If the daemon is not healthy after ~8 s, check `.tmp\logs\daemon-3101.err.log`.
