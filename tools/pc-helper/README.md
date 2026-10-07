# pc-helper

PowerShell module for the PC side of Droid Mobile. It runs on Windows PowerShell 5.1 (and 7).
It starts and supervises a `droid daemon`, publishes it on your tailnet with Tailscale Serve, prints
a pairing code for the app, installs the Droid hooks that feed the push bridge, and checks that
everything works (`Doctor`).

The helper never prints your Factory API key by default. Only `New-PairingCode -IncludeApiKey`
shows it, on screen, with a warning, and it is never written to a file.

Context: [PC setup](../../docs/setup.md), [connecting the phone](../../docs/pairing.md),
[notifications](../../docs/notifications.md) and
[troubleshooting](../../docs/troubleshooting.md).

## Prerequisites

- Droid CLI (`droid.exe`) on `PATH` or at `%USERPROFILE%\bin\droid.exe` (override with `-DroidExe` or
  `DROIDMOBILE_DROID_EXE`).
- Tailscale signed in, with **MagicDNS** and **HTTPS certificates** enabled in the tailnet admin
  console (DNS page; needed by `tailscale serve --https`).
- Node.js 24 and `npm install` in the repo (the QR block of `New-PairingCode`, the hook and the
  hooks editor run on Node).
- For phone notifications: the FCM bridge from `server/fcm-bridge` (see its README) and its pairing
  secret.

## Import

```powershell
Import-Module .\tools\pc-helper\DroidMobileHelper.psd1
```

## Quick start

Run from the repository root in Windows PowerShell 5.1. Use any free port from 3100 to 3199 instead
of `3101`, and use the bridge URL and secret file of your own bridge (the secret is the one printed
once by `npm run generate-secret -w @droidmobile/fcm-bridge`; put it in `pair-secret.txt`).

```powershell
Import-Module .\tools\pc-helper\DroidMobileHelper.psd1
Start-DroidDaemon -Port 3101
Enable-TailscaleServe -Port 8443 -DaemonPort 3101
Install-DroidHooks -BridgeUrl http://127.0.0.1:3102 -BridgeSecretFile .\pair-secret.txt
New-PairingCode -BridgeUrl http://127.0.0.1:3102 -BridgeSecretFile .\pair-secret.txt
Doctor -DaemonPort 3101
```

The last two lines print the `droidmobile://pair?...` code and its QR block, then one PASS, WARN or
FAIL line per check. Skip the `Install-DroidHooks` and bridge parts if you do not want phone
notifications: `New-PairingCode` then prints only the daemon URL. A phone on another network
needs a bridge URL it can reach over HTTPS; `http://127.0.0.1:3102` works for the emulator
(`http://10.0.2.2:3102`) and for local checks only.

## State and logs

Default folder: `%LOCALAPPDATA%\DroidMobileHelper` (override with `-StateDir` or
`$env:DROIDMOBILE_HELPER_HOME`). It never holds the Factory API key. The only secret in it is the
bridge pairing secret in `bridge.json`, written by `Install-DroidHooks -BridgeUrl ...` and readable
by your Windows user only.

| File                             | Content                                                           |
| -------------------------------- | ----------------------------------------------------------------- |
| `daemon-<port>.pid`              | PID of the live `droid` daemon process                            |
| `daemon-<port>.json`             | supervisor PID and start time, daemon start time, restart counter |
| `tailscale-serve-<port>.json`    | serve status recorded before enabling, daemon port, wss URL       |
| `logs\supervisor-<port>.log`     | timestamped start, exit and restart lines                         |
| `logs\daemon-<port>.out/err.log` | daemon output (the previous run is kept as `.prev`)               |
| `bridge.json`                    | `{"url": "<bridge url>", "secret": "<pairing secret>"}` for hooks |
| `logs\hook.log`                  | one line per hook failure (no secrets, capped at 128 KiB)         |

## Commands

Every command that changes something supports `-WhatIf` and then changes nothing.

### Start-DroidDaemon

```powershell
Start-DroidDaemon -Port 3101
```

Starts `droid daemon --host 127.0.0.1 --port <Port>` under a hidden, detached supervisor, waits up
to `-HealthTimeoutSec` (20) for `GET /health` to answer `factory-daemon ok`, and prints the port and
PIDs. The supervisor restarts the daemon one second after a crash (backoff up to 15 s) and also
when `/health` fails six checks in a row; restarts show in the supervisor log. A second call
prints "already running" with the existing PID. If the port is held by anything the helper did not
start, it exits non-zero and touches nothing. The helper never acts on a process whose command line
contains `daemon --listen ipc` (the Factory desktop daemon).

Parameters: `-Port` (3100-3199, default 3101), `-StateDir`, `-DroidExe`, `-HealthTimeoutSec`,
`-PassThru`.

### Stop-DroidDaemon

```powershell
Stop-DroidDaemon -Port 3101
```

Ends the supervisor and the daemon recorded in the helper's own files (after checking start time and
command line), removes the PID file and waits up to 10 s for the port to free up. With no record and
a listener on the port it refuses; with no record and a free port it reports "Nothing to stop".

### Enable-TailscaleServe

```powershell
Enable-TailscaleServe -Port 8443 -DaemonPort 3101
```

Records `tailscale serve status` (and its JSON) in `tailscale-serve-<port>.json`, runs
`tailscale serve --bg --https=<Port> http://127.0.0.1:<DaemonPort>`, and prints
`URL: wss://<magicdns>:<Port>` (host from `Self.DNSName` of `tailscale status --json`). A second call
prints "already enabled" and keeps the original record. If the HTTPS port already has a serve
entry the helper did not create, it refuses and changes nothing.

Parameters: `-Port` (443, 8443 default, 10000), `-DaemonPort` (3100-3199, default 3101), `-StateDir`.

### Disable-TailscaleServe

```powershell
Disable-TailscaleServe -Port 8443
```

Removes only the helper's own mapping (`tailscale serve --https=<Port> off`), checks that
`tailscale serve status` equals the recorded original, and deletes the record. A second call
prints "Nothing to restore". With no record and an existing entry on the port it refuses to remove
it.

### New-PairingCode

```powershell
New-PairingCode                                   # url only
New-PairingCode -BridgeUrl http://10.0.2.2:3102 -BridgeSecretFile .\pair-secret.txt
New-PairingCode -IncludeApiKey                    # adds key=, on screen only
```

Prints `droidmobile://pair?v=1&url=<wss-url>[&bridge=<url>&bridgeSecret=<secret>]` as copyable text
and as a QR block. The URL is the recorded serve URL, or `wss://<magicdns>:<ServePort>` when no
record exists (`-Url` overrides). The bridge secret comes from `-BridgeSecretFile` (first line),
`-BridgeSecret` or `$env:DROIDMOBILE_BRIDGE_SECRET`; it is the secret printed by the bridge's
generate command, not the Factory API key. The Factory API key is added only with `-IncludeApiKey`
(read from `$env:FACTORY_API_KEY`, or prompted without echo), is shown with a warning, and is never
written to a file. The QR is rendered by `qr.mjs`, which receives the payload on stdin.

Parameters: `-Url`, `-ServePort`, `-BridgeUrl`, `-BridgeSecret`, `-BridgeSecretFile`,
`-IncludeApiKey`, `-NoQr`, `-PassThru`, `-StateDir`.

### Install-DroidHooks

```powershell
Install-DroidHooks -BridgeUrl http://127.0.0.1:3102 -BridgeSecretFile .\pair-secret.txt
Install-DroidHooks -SettingsPath $env:TEMP\scratch\settings.json -WhatIf
```

Adds a `Notification` hook and a `Stop` hook that run
`node "<repo>/tools/pc-helper/hook.mjs" --droidmobile-hook`. Droid passes the hook event as JSON on
stdin. The hook posts `session_id`, `hook_event_name` and (for `Notification`) `notification_type`
to `<bridge>/v1/events` with `Authorization: Bearer <secret>`, and nothing else: no message, path,
transcript or tool input. The bridge turns `permission_prompt` into an approvals push and
`idle_prompt` and `Stop` into a turn-finished push, and ignores other notification types.

- **Target file.** If a `hooks.json` sits next to the settings file, the entries go into that
  `hooks.json` (Droid reads it instead of the settings file's `hooks` key) and the settings file is
  not touched. Otherwise they go into the `hooks` key of the settings file. Default settings file:
  `~\.factory\settings.json` (`$env:FACTORY_HOME_OVERRIDE\.factory\settings.json` when that variable
  is set, which lets you try everything against a scratch folder first).
- **Backup.** Before the first change the target is copied to
  `<file>.droidmobile-backup-<timestamp>`; the copy is verified byte for byte. Backups are never
  overwritten or deleted.
- **Idempotent.** A second run changes nothing and makes no new backup. Your other settings and
  hooks, including your own `Stop` hooks, stay exactly as they were.
- **Refuses a broken file.** A target that is not valid JSON makes the command fail with a message
  that names the file. The file is left untouched.
- **Never blocks Droid.** The hook always exits 0 within 4 seconds, prints nothing, and logs a
  failure line to `logs\hook.log` (no secrets). If the bridge is down, you only miss a push.
- **Secret handling.** The bridge URL and secret are stored in `<StateDir>\bridge.json` (user-only
  access). They are never written to the settings file or the hook command line. At run time
  `DROIDMOBILE_BRIDGE_URL` and `DROIDMOBILE_BRIDGE_SECRET` override `bridge.json`. Without a stored
  or environment configuration the hooks do nothing.

Droid reads hooks at startup, so restart running Droid sessions afterwards.

Parameters: `-SettingsPath`, `-BridgeUrl`, `-BridgeSecret`, `-BridgeSecretFile` (or
`$env:DROIDMOBILE_BRIDGE_SECRET`), `-StateDir`, `-WhatIf`.

### Uninstall-DroidHooks

```powershell
Uninstall-DroidHooks
Uninstall-DroidHooks -SettingsPath $env:TEMP\scratch\settings.json -RemoveBridgeConfig
```

Removes only the entries that `Install-DroidHooks` added, from a neighbouring `hooks.json` and from
the settings file, after making a backup of each file it changes. Keys and hook entries that the
install created and nobody else uses are removed too, so the file returns to its original content;
hooks you added yourself, before or after the install, stay. A second run prints
`Nothing to remove` and exits 0. `-RemoveBridgeConfig` also deletes `bridge.json`.

Parameters: `-SettingsPath`, `-StateDir`, `-RemoveBridgeConfig`, `-WhatIf`.

### Get-DroidDoctor (alias Doctor)

```powershell
Doctor
Get-DroidDoctor -DaemonPort 3101 -BridgeUrl http://127.0.0.1:3102 -PassThru
```

Read-only. Prints one line per check, `[PASS]`, `[WARN]` or `[FAIL]`, and a `fix:` line under every
WARN and FAIL:

| Check               | PASS when                                       | Typical fix                               |
| ------------------- | ----------------------------------------------- | ----------------------------------------- |
| droid version       | `droid --version` prints a version              | install the Droid CLI                     |
| Node version        | Node 24 or newer                                | install Node.js 24                        |
| daemon health       | `127.0.0.1:<DaemonPort>/health` answers         | `Start-DroidDaemon -Port <n>`             |
| Tailscale status    | Tailscale is running                            | start Tailscale and sign in               |
| HTTPS certificates  | `tailscale status --json` lists a `CertDomains` | enable MagicDNS and HTTPS in the admin UI |
| Tailscale Serve     | the helper publishes the serve port             | `Enable-TailscaleServe`                   |
| bridge reachability | `<bridge>/healthz` answers 200                  | start the bridge or fix `-BridgeUrl`      |
| Droid hooks         | Notification and Stop hooks and a bridge secret | `Install-DroidHooks -BridgeUrl ...`       |

An unreachable bridge is a FAIL when a bridge URL is configured (parameter, environment or
`bridge.json`) and a WARN when only the default `http://127.0.0.1:3102` was tried. When any check
FAILs, the command ends with an error, so the exit code is non-zero (also through `-File`).
It prints no API key and no bridge secret and changes no file or process.

Parameters: `-DaemonPort`, `-ServePort`, `-BridgeUrl`, `-SettingsPath`, `-StateDir`, `-PassThru`.

## Uninstall everything

```powershell
Uninstall-DroidHooks -RemoveBridgeConfig   # hooks, backups stay; deletes bridge.json
Disable-TailscaleServe -Port 8443          # restores the recorded serve state
Stop-DroidDaemon -Port 3101                # ends supervisor and daemon, removes PID files
Remove-Item -Recurse "$env:LOCALAPPDATA\DroidMobileHelper"   # logs and records (optional)
```

The `*.droidmobile-backup-*` files next to your settings are yours to delete once you are happy
with the result. Nothing is installed outside the state folder, the hooks entries and the Tailscale
Serve entry that these commands created.

## Tests

```powershell
npm run test -w @droidmobile/pc-helper                    # unit: parsing, pairing, refusals, -WhatIf
npx vitest run --project integration tools/pc-helper      # real droid daemon on port 3109
```
