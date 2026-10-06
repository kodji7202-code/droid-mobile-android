# pc-helper

PowerShell module for the PC side of Droid Mobile. It runs on Windows PowerShell 5.1 (and 7).
It starts and supervises a `droid daemon`, publishes it on your tailnet with Tailscale Serve, and
prints a pairing code for the app.

Hooks and doctor commands (`Install-DroidHooks`, `Uninstall-DroidHooks`, `Get-DroidDoctor`) are
documented in the same module once added; this page covers the daemon, serve and pairing commands.

## Prerequisites

- Droid CLI (`droid.exe`) on `PATH` or at `%USERPROFILE%\bin\droid.exe` (override with `-DroidExe` or
  `DROIDMOBILE_DROID_EXE`).
- Tailscale signed in, with **MagicDNS** and **HTTPS certificates** enabled in the tailnet admin
  console (needed by `tailscale serve --https`).
- Node.js 24 and `npm install` in the repo (only for the QR block of `New-PairingCode`).

## Import

```powershell
Import-Module .\tools\pc-helper\DroidMobileHelper.psd1
```

## State and logs

Default folder: `%LOCALAPPDATA%\DroidMobileHelper` (override with `-StateDir` or
`$env:DROIDMOBILE_HELPER_HOME`). Nothing in it holds the Factory API key or a bridge secret.

| File                             | Content                                                           |
| -------------------------------- | ----------------------------------------------------------------- |
| `daemon-<port>.pid`              | PID of the live `droid` daemon process                            |
| `daemon-<port>.json`             | supervisor PID and start time, daemon start time, restart counter |
| `tailscale-serve-<port>.json`    | serve status recorded before enabling, daemon port, wss URL       |
| `logs\supervisor-<port>.log`     | timestamped start, exit and restart lines                         |
| `logs\daemon-<port>.out/err.log` | daemon output (the previous run is kept as `.prev`)               |

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

## Tests

```powershell
npm run test -w @droidmobile/pc-helper                    # unit: parsing, pairing, refusals, -WhatIf
npx vitest run --project integration tools/pc-helper      # real droid daemon on port 3109
```
