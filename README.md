# Droid Mobile

Unofficial Android client for [Factory Droid](https://factory.ai) — a Capacitor + React +
TypeScript app that talks to the user's own `droid daemon` over WebSocket. Not affiliated
with or endorsed by Factory; only public, supported interfaces are used (see
[docs/tos.md](docs/tos.md)).

**Status:** foundation scaffold. The app currently renders a placeholder screen; features
land milestone by milestone.

## Layout (npm workspaces)

| Path                     | Package                      | Purpose                                                                                   |
| ------------------------ | ---------------------------- | ----------------------------------------------------------------------------------------- |
| `apps/mobile`            | `@droidmobile/mobile`        | Capacitor + React app (+ `android/` native shell, see [docs/android.md](docs/android.md)) |
| `packages/daemon-client` | `@droidmobile/daemon-client` | Typed adapter over `@factory/droid-sdk` (pure TS, no React)                               |
| `server/fcm-bridge`      | `@droidmobile/fcm-bridge`    | Fastify + firebase-admin push bridge                                                      |
| `tools/pc-helper`        | `@droidmobile/pc-helper`     | PowerShell + Node helpers for the PC side                                                 |
| `docs/`                  | —                            | User docs (setup, security, ToS note)                                                     |

## Getting started

Prerequisites: Node 24 (npm 11) and git. Native Android builds additionally need JDK 21 and
the Android SDK (see [docs/setup.md](docs/setup.md)).

```powershell
npm install
npm run dev   # Vite dev server on http://127.0.0.1:3100
```

## Scripts (repo root)

| Script                                         | What it does                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| `npm run typecheck`                            | `tsc --noEmit` in every workspace                                       |
| `npm run lint`                                 | ESLint (flat config) over the repo                                      |
| `npm run test`                                 | Vitest `unit` project, `--maxWorkers=4`                                 |
| `npm run test:integration`                     | Vitest `integration` project (needs the real daemon on 127.0.0.1:3101)  |
| `npm run build`                                | Workspace builds (currently the Vite production build of `apps/mobile`) |
| `npm run format`                               | Prettier write (`format:check` to verify)                               |
| `npm run android:debug`                        | Native debug APK (web build + `cap sync` + `gradlew assembleDebug`)     |
| `npm run android:release`                      | Native release APK + AAB (no signing config yet)                        |
| `npm run android:check`                        | Automated debug/release variant checks (merged manifests + config)      |
| `npm run android:emulator` / `install` / `cdp` | Emulator start / APK install / WebView CDP forward                      |

Scope a command to one workspace with `-w`, e.g. `npm run test -w @droidmobile/mobile`.
The native Android workflow is documented in [docs/android.md](docs/android.md).

## Dev services (Windows)

`tools/dev/` holds the service scripts referenced by the mission's `services.yaml`:

```powershell
# Start / stop a detached droid daemon (default port 3101, or -Port 3103..3109 for throwaways)
powershell -NoProfile -ExecutionPolicy Bypass -File tools\dev\start-daemon.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tools\dev\stop-daemon.ps1

# Load .env.local silently, then run a command
powershell -NoProfile -ExecutionPolicy Bypass -File tools\dev\with-env.ps1 <command> [args...]
```

- `start-daemon.ps1` starts `droid daemon --host 127.0.0.1 --port <p>` detached via
  WMI/CIM (survives the launching shell), logs to `.tmp\logs\daemon-<port>.*.log`, writes
  the PID file `.tmp\daemon-<port>.pid`, and health-checks `/health`.
- `stop-daemon.ps1` stops only the recorded PID (`taskkill /T`) after validating its start time
  and command line; it never kills a process inferred from a port (refuses, exit 1).
- `with-env.ps1` loads `.env.local` `KEY=VALUE` lines into the process environment without
  printing values, then runs the given command.

Port allocation: Vite 3100, test daemon 3101, FCM bridge 3102, throwaway daemons 3103-3109.

## Security notes

- `.env.local`, `secrets/`, `.tmp/` and keystores are git-ignored and must never be
  committed or printed.
- The app stores credentials only in Keystore-backed storage; error paths redact keys
  (`redactSecrets` in `packages/daemon-client`).
- See [docs/security.md](docs/security.md) and [docs/tos.md](docs/tos.md).
