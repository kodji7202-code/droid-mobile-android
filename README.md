# Droid Mobile

Droid Mobile is an Android app that lets you use the Factory Droid sessions on your own PC from
your phone. It is built with Capacitor, React and TypeScript and talks to the `droid daemon`
that runs on your PC.

> **Unofficial client.** Droid Mobile is not made, endorsed or supported by Factory. It uses
> only public, supported interfaces: the official, Apache-2.0 licensed `@factory/droid-sdk`
> (pinned to 0.9.1) and your own `droid daemon`, with your own Factory API key. There is no
> relay server, no OAuth or WorkOS reuse and no non-public API. Read the
> [terms-of-service note](docs/tos.md) before you publish or share a build.

## What you can do

- Browse, search, start, resume, rename and archive sessions; chat with streaming replies,
  tool calls, approvals and questions from the agent.
- Browse the files of a session's workspace, read diffs, commit and push, and use a terminal.
- Manage MCP servers, skills, slash commands, plugins, custom models and automations, and
  follow Mission sessions.
- Get notifications when Droid needs your approval or finishes a turn, in the app, in the
  background and (through your own FCM bridge) when the app is closed.
- English and Romanian, light and dark theme, optional biometric app lock, tablet layout.

## How it fits together

```text
Phone (Droid Mobile)                      Your PC
  wss:// over Tailscale Serve  â”€â”€â”€â”€â”€â”€â”€â–¶   tailscale serve â”€â–¶ droid daemon (127.0.0.1:<port>)
                                                                  â”‚ Droid hooks (Notification, Stop)
  FCM push (event kind + session id)  â—€â”€â”€ your FCM bridge  â—€â”€â”€â”€â”€â”€â”€â”˜
```

The phone connects straight to your daemon. Tailscale Serve gives the daemon a TLS address on
your tailnet, so release builds use `wss://` only. The optional FCM bridge only ever sees the
event kind and the session id; no prompt, file content or path leaves the PC.

## Quick start

1. **PC.** Install the Droid CLI, Node.js 24 and Tailscale (with MagicDNS and HTTPS
   certificates enabled), then start the daemon and publish it. The PC helper does it in three
   commands, see [docs/setup.md](docs/setup.md):

   ```powershell
   npm install
   Import-Module .\tools\pc-helper\DroidMobileHelper.psd1
   Start-DroidDaemon -Port 3101
   Enable-TailscaleServe -Port 8443 -DaemonPort 3101
   ```

2. **Phone.** Install the release APK (see [docs/release.md](docs/release.md)), then connect with
   the `wss://` address and your Factory API key, either typed in or from a pairing code
   (`New-PairingCode`). See [docs/pairing.md](docs/pairing.md).
3. **Notifications (optional).** Run the FCM bridge, install the hooks and register the phone,
   see [docs/notifications.md](docs/notifications.md) and
   [server/fcm-bridge/README.md](server/fcm-bridge/README.md).

If something does not connect, start with [docs/troubleshooting.md](docs/troubleshooting.md) and
`Doctor` from the helper.

## Documentation

| Document                                                   | Contents                                                              |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| [docs/setup.md](docs/setup.md)                             | PC setup: daemon, Tailscale Serve, HTTPS certificates, dev setup      |
| [docs/pairing.md](docs/pairing.md)                         | Connecting the phone: URL, key, QR or text, pairing code              |
| [docs/notifications.md](docs/notifications.md)             | Local notifications, stay connected, battery, push through the bridge |
| [docs/security.md](docs/security.md)                       | Where the key lives, transport policy, tailnet exposure, rotation     |
| [docs/tos.md](docs/tos.md)                                 | Unofficial client and Factory terms-of-service note                   |
| [docs/release.md](docs/release.md)                         | Release build, keystore, `apksigner verify`, install                  |
| [docs/android.md](docs/android.md)                         | Native build variants, emulator workflow                              |
| [docs/play-store.md](docs/play-store.md)                   | Play Store listing notes (text, data safety, permissions)             |
| [docs/limitations.md](docs/limitations.md)                 | Known limitations                                                     |
| [docs/troubleshooting.md](docs/troubleshooting.md)         | Fixes for the common problems                                         |
| [server/fcm-bridge/README.md](server/fcm-bridge/README.md) | FCM bridge: environment, API, TLS deployment, Docker                  |
| [tools/pc-helper/README.md](tools/pc-helper/README.md)     | PC helper commands: daemon, serve, hooks, pairing, `Doctor`           |

## Repository layout (npm workspaces)

| Path                     | Package                      | Purpose                                                     |
| ------------------------ | ---------------------------- | ----------------------------------------------------------- |
| `apps/mobile`            | `@droidmobile/mobile`        | Capacitor + React app with the `android/` native shell      |
| `packages/daemon-client` | `@droidmobile/daemon-client` | Typed adapter over `@factory/droid-sdk` (pure TS, no React) |
| `server/fcm-bridge`      | `@droidmobile/fcm-bridge`    | Fastify + firebase-admin push bridge                        |
| `tools/pc-helper`        | `@droidmobile/pc-helper`     | PowerShell + Node helpers for the PC side                   |
| `tools/dev`              | none                         | Build, emulator and service scripts used by the npm scripts |
| `docs/`                  | none                         | User documentation                                          |

## Build, test and release commands

Prerequisites: Node 24 (npm 11) and git. Native Android builds also need JDK 21 and the Android
SDK, see [docs/android.md](docs/android.md). Run everything from the repository root in Windows
PowerShell.

```powershell
npm install
npm run dev -w @droidmobile/mobile   # Vite dev server on http://127.0.0.1:3100 (debug flavour)
```

| Script                           | What it does                                                             |
| -------------------------------- | ------------------------------------------------------------------------ |
| `npm run typecheck`              | `tsc --noEmit` in every workspace                                        |
| `npm run lint`                   | ESLint (flat config) over the repository                                 |
| `npm run test`                   | Vitest `unit` project                                                    |
| `npm run test:integration`       | Vitest `integration` project; needs a real daemon on 127.0.0.1:3101      |
| `npm run build`                  | Workspace builds (Vite production build of the app, bridge compile)      |
| `npm run docs:check`             | Documentation gate: required sections, relative links, `npm run` scripts |
| `npm run i18n:check`             | English and Romanian bundles have the same keys and placeholders         |
| `npm run format`                 | Prettier write (`npm run format:check` to verify)                        |
| `npm run android:debug`          | Debug APK (web build, `cap sync`, `gradlew assembleDebug`)               |
| `npm run android:release`        | Signed release APK and AAB, then `android:verify-release`                |
| `npm run android:keystore`       | Create the local release keystore once (never overwrites)                |
| `npm run android:verify-release` | `apksigner`, manifest, config and secret checks on the release artifacts |
| `npm run android:check`          | Debug and release variant checks (merged manifests, Capacitor config)    |
| `npm run scan:secrets`           | Scan the tree and history for keys, service accounts and signing files   |

Scope a script to one workspace with `-w`, for example `npm run test -w @droidmobile/fcm-bridge`.
Integration tests use the real daemon from `tools\dev\start-daemon.ps1` and need
`FACTORY_API_KEY` in the environment, so load `.env.local` first:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\dev\with-env.ps1 npm run test:integration
```

`npm run format:check` currently reports a few older files that predate the Prettier setup;
format the files you touch with `npx prettier --write <file>`. The emulator scripts
(`android:emulator`, `android:install`, `android:cdp`) are described in
[docs/android.md](docs/android.md).

### Release in one command

```powershell
npm run android:release
```

Outputs `app-release.apk` and `app-release.aab` under `apps/mobile/android/app/build/outputs/`,
signed with your own key. Details, key handling and verification:
[docs/release.md](docs/release.md).

## Dev services (Windows)

`tools/dev/` holds the scripts behind the dev services:

```powershell
# Start / stop a detached droid daemon (default port 3101, throwaway daemons use 3103..3109)
powershell -NoProfile -ExecutionPolicy Bypass -File tools\dev\start-daemon.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tools\dev\stop-daemon.ps1

# Load .env.local without printing values, then run a command
powershell -NoProfile -ExecutionPolicy Bypass -File tools\dev\with-env.ps1 <command> [args...]
```

`start-daemon.ps1` starts `droid daemon --host 127.0.0.1 --port <p>` detached, logs to
`.tmp\logs\daemon-<port>.*.log`, writes `.tmp\daemon-<port>.pid` and health-checks `/health`.
`stop-daemon.ps1` stops only the recorded PID after checking its start time and command line.
Port plan: Vite 3100, test daemon 3101, FCM bridge 3102, throwaway daemons 3103 to 3109.

## Security notes

- Your Factory API key is stored only in Android Keystore-backed storage on the phone. `.env.local`,
  `secrets/`, `.tmp/`, keystores, `google-services.json` and Firebase service accounts are
  git-ignored and must never be committed, printed or pasted.
- Release builds connect over `wss://` only. See [docs/security.md](docs/security.md).
