# FCM bridge

Small HTTP service that connects Droid hooks on your PC to the Droid Mobile app on your phone.
Droid calls the bridge when a turn finishes or a tool needs permission. The bridge forwards an
opaque Firebase Cloud Messaging (FCM) push to every registered phone. The push carries only the
event kind and the session id. No prompt text, file content, path or tool input ever leaves the PC.

- Fastify 5 (TypeScript), `firebase-admin` through modular imports only (`firebase-admin/app`,
  `firebase-admin/messaging`).
- One pairing secret per installation. It is generated once, shown once and stored only as a
  salted scrypt hash.
- Devices are kept in a small JSON file under `BRIDGE_DATA_DIR`.
- Speaks plain HTTP. Put it behind a TLS reverse proxy for anything beyond `127.0.0.1` (see
  [Deploy behind TLS](#deploy-behind-tls)).

## Quick start (development)

Dev port is **3102**.

```powershell
# 1. Create the pairing secret (printed once; copy it now)
npm run generate-secret -w @droidmobile/fcm-bridge

# 2a. Real sends (needs a Firebase service account key)
$env:FIREBASE_SERVICE_ACCOUNT_PATH = 'D:\path\to\service-account.json'
npm run dev -w @droidmobile/fcm-bridge -- --port 3102

# 2b. Dry run: everything works, no FCM call is made, no service account needed
$env:BRIDGE_DRY_RUN = '1'
npm run dev -w @droidmobile/fcm-bridge -- --port 3102

# Health check
curl.exe http://127.0.0.1:3102/healthz
```

Production style: `npm run build -w @droidmobile/fcm-bridge`, then
`node server/fcm-bridge/dist/server.js` with the environment below.

## Environment

Configuration comes only from the environment. Invalid values stop the process with exit code 1
and a message that names the variable. The command line may override two of them:
`--port <n>` (same as `PORT`) and `--dry-run` (same as `BRIDGE_DRY_RUN=1`).

| Variable                        | Default     | Meaning                                                                                                                                                                            |
| ------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                          | `3102`      | TCP port to listen on (1-65535).                                                                                                                                                   |
| `BRIDGE_HOST`                   | `127.0.0.1` | Address to bind. Use `0.0.0.0` only inside a container or behind a firewall.                                                                                                       |
| `BRIDGE_DATA_DIR`               | `./data`    | Directory for every file the bridge writes (`devices.json`, `pairing.json`). Created if missing. Relative paths resolve against the working directory.                             |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | none        | Path to the Firebase service account JSON. Required unless dry-run is on. The file is validated at start (missing or invalid file exits non-zero); its contents are never printed. |
| `BRIDGE_DRY_RUN`                | `false`     | `1`/`true`/`yes`/`on` enables dry-run: events are validated and counted but nothing is sent to FCM. `0`/`false`/`no`/`off` sends for real.                                         |
| `BRIDGE_RATE_LIMIT_MAX`         | `100`       | Maximum requests per client address per window. `GET /healthz` is never limited.                                                                                                   |
| `BRIDGE_RATE_LIMIT_WINDOW_MS`   | `60000`     | Length of the rate limit window in milliseconds.                                                                                                                                   |
| `BRIDGE_BODY_LIMIT_BYTES`       | `65536`     | Largest accepted request body (256 to 1048576, so at most 1 MiB). Larger bodies get 413.                                                                                           |
| `BRIDGE_TRUST_PROXY`            | `false`     | Set to `1` behind a reverse proxy so the rate limit uses the real client address from `X-Forwarded-For` instead of the proxy address.                                              |
| `BRIDGE_LOG_LEVEL`              | `info`      | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`.                                                                                                                    |

The startup log states the active mode: `mode: dry-run (no FCM calls are made)` or
`mode: real-send (messages are delivered through FCM)`.

## Pairing secret

Every `/v1/*` request must carry `Authorization: Bearer <secret>`. `GET /healthz` needs no
credential.

```powershell
# Generate (fails if one exists, so the secret can never be shown twice)
npm run generate-secret -w @droidmobile/fcm-bridge

# Rotate: replaces the secret; the old one stops working immediately, no restart needed
npm run generate-secret -w @droidmobile/fcm-bridge -- --rotate
```

The command prints the 43-character secret once. `pairing.json` in `BRIDGE_DATA_DIR` keeps only a
random salt and the scrypt hash, so the secret cannot be recovered. After a rotation, re-pair every
phone (new pairing code) and update the hook configuration on the PC. Restarting the bridge never
prints or regenerates the secret. Until a secret exists, every `/v1` request answers 401 and the
bridge logs a warning at start.

Pairing code for the app: `droidmobile://pair?v=1&url=<daemon wss url>&bridge=<bridge url>&bridgeSecret=<secret>`.
The bridge URL the phone uses must be `https://` outside of local development.

## API

All bodies are JSON. Errors are JSON as well:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Invalid request: deviceId",
    "fields": [{ "field": "deviceId", "message": "must match ^[A-Za-z0-9._-]{1,64}$" }]
  }
}
```

The checks run in this order: rate limit (429), authentication (401), body size (413), JSON parse
(400), field validation (400). An unauthenticated request with an invalid body therefore gets 401.
Error messages never echo tokens or secrets.

| Status | `error.code`        | When                                                                                   |
| ------ | ------------------- | -------------------------------------------------------------------------------------- |
| 400    | `invalid_json`      | Body is not valid JSON (any content type).                                             |
| 400    | `invalid_request`   | A field is missing or invalid; `fields` names each offending field.                    |
| 401    | `unauthorized`      | Credential missing or wrong (identical body for both).                                 |
| 404    | `not_found`         | Unknown route, or `DELETE` of an unknown device.                                       |
| 413    | `payload_too_large` | Body larger than `BRIDGE_BODY_LIMIT_BYTES`.                                            |
| 429    | `rate_limited`      | More than `BRIDGE_RATE_LIMIT_MAX` requests in the window; has `Retry-After` (seconds). |
| 500    | `internal_error`    | Unexpected failure (for example the data directory is not writable).                   |

### `GET /healthz`

No credential. Returns `200 {"status":"ok"}`. Never rate limited, never reveals configuration.

### `POST /v1/devices`

Registers a phone or replaces its token. Idempotent per `deviceId`.

```json
{ "deviceId": "s25-1a2b", "fcmToken": "<FCM registration token>", "label": "Galaxy S25" }
```

| Field      | Rule                                                    |
| ---------- | ------------------------------------------------------- |
| `deviceId` | Required string matching `^[A-Za-z0-9._-]{1,64}$`.      |
| `fcmToken` | Required non-empty string (at most 4096 characters).    |
| `label`    | Optional string, at most 64 characters (default empty). |

Responses: `201 {"deviceId","label","created":true}` for a new device, `200 {..."created":false}`
when the token of an existing `deviceId` was replaced. The token is never returned.

### `DELETE /v1/devices/:id`

`204` (no body) when the device existed, `404` otherwise. The app calls this when push is turned
off or the connection is forgotten.

### `POST /v1/events`

Called by the PC's Droid hooks. The body uses the Droid hook field names; unknown fields are
accepted and ignored (and never forwarded).

```json
{
  "session_id": "<daemon session id>",
  "hook_event_name": "Notification",
  "notification_type": "permission_prompt"
}
```

| Field               | Rule                                                    |
| ------------------- | ------------------------------------------------------- |
| `session_id`        | Required non-empty string (at most 256 characters).     |
| `hook_event_name`   | Required: `Notification` or `Stop`.                     |
| `notification_type` | Required string for `Notification`; ignored for `Stop`. |

Mapping:

| Hook event                           | Push `kind`         | Android channel | Priority |
| ------------------------------------ | ------------------- | --------------- | -------- |
| `Notification` / `permission_prompt` | `permission_prompt` | `approvals`     | `high`   |
| `Notification` / `idle_prompt`       | `idle_prompt`       | `turns`         | `high`   |
| `Stop`                               | `stop`              | `turns`         | `high`   |
| `Notification` / any other type      | (ignored)           | none            | none     |

An ignored event answers `200` with `sent` 0 and makes no FCM call.

Response `200`:

```json
{ "sent": 1, "failed": 0, "removed": 0, "dryRun": false }
```

`sent` counts devices a message was handed to (in dry-run: devices that would receive it).
`failed` counts per-device errors, `removed` counts devices dropped because FCM reported their
token as unregistered.

### FCM message

One message per device (`token` is set, nothing else identifies the device):

```json
{
  "token": "<device token>",
  "data": { "kind": "stop", "sessionId": "<session_id>" },
  "notification": {
    "title": "Droid Mobile",
    "body": "Open the app to see what needs your attention."
  },
  "android": {
    "priority": "high",
    "ttl": 3600000,
    "notification": { "channelId": "turns", "tag": "turn:<session_id>" }
  }
}
```

`data` has exactly the keys `kind` and `sessionId`. Title and body are fixed strings that never
depend on the hook input. The Android notification `tag` is `turn:<session_id>` for `stop` and
`idle_prompt` and `approvals:<session_id>` for `permission_prompt`: the app posts and withdraws its
own notifications under the same tags, so a push and a local notification for one event show once. Messages expire after one hour (`ttl`). A failure for one device
(malformed token, FCM error) is logged and never blocks the others. Tokens FCM reports as
`registration-token-not-registered` (or invalid) are removed from the store and the removal is
logged with the device id and a masked token.

## Data and logs

`BRIDGE_DATA_DIR` holds the only files the bridge writes:

| File           | Content                                                                                                                                                                                                                                                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `devices.json` | `{"version":1,"devices":[{"deviceId","fcmToken","label","registeredAt","updatedAt"}]}`. Written atomically after every change, so registrations survive restarts and concurrent requests. FCM tokens are stored in clear text because FCM needs them; protect the directory (the file is created with mode 0600). A corrupt file stops the start instead of being overwritten. |
| `pairing.json` | Salted scrypt verifier of the pairing secret (`salt`, `hash`, parameters).                                                                                                                                                                                                                                                                                                     |

Logs are one JSON object per line on stdout (`level`, `time`, `msg`, `reqId`). `npm run dev`
and the `tools/dev/with-env.ps1` loader print a few plain-text banner lines before the first log
line; start `node dist/server.js` directly when you need a stdout that is pure JSON. Each request
produces one `request completed` line with method, path, status and duration. The `Authorization`
header, pairing secret, request bodies, full FCM tokens and service account contents are never
logged; tokens appear only masked (`abcd...wxyz(163)`).

The process exits cleanly on `SIGTERM`/`SIGINT` (within 5 seconds).

## Hook configuration

`tools/pc-helper` (`Install-DroidHooks`) writes the hooks for you. By hand, a Droid hook
command must POST the hook fields with the pairing secret, for example (`hooks` key of a Factory
settings file):

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "<command that POSTs the stdin fields session_id and hook_event_name to https://bridge.example.com/v1/events with the Bearer secret>"
          }
        ]
      }
    ],
    "Notification": [
      { "hooks": [{ "type": "command", "command": "<same, including notification_type>" }] }
    ]
  }
}
```

Equivalent request:

```powershell
curl.exe -X POST http://127.0.0.1:3102/v1/events `
  -H "Authorization: Bearer $env:BRIDGE_SECRET" -H "Content-Type: application/json" `
  -d '{"session_id":"abc","hook_event_name":"Stop"}'
```

## Deploy behind TLS

The bridge speaks **plain HTTP only**. Remote hooks and the app must reach it over `https://`,
so terminate TLS in a reverse proxy in front of it, bind the bridge to loopback (or a private
network) and set `BRIDGE_TRUST_PROXY=1` so rate limiting sees the real client address.

Caddy (automatic certificates):

```caddyfile
bridge.example.com {
    reverse_proxy 127.0.0.1:3102
}
```

nginx:

```nginx
server {
    listen 443 ssl;
    server_name bridge.example.com;
    ssl_certificate     /etc/letsencrypt/live/bridge.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/bridge.example.com/privkey.pem;
    client_max_body_size 64k;

    location / {
        proxy_pass http://127.0.0.1:3102;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Host $host;
    }
}
```

Do not publish port 3102 itself. Use `https://bridge.example.com` as the bridge URL in the pairing
code and in the hook configuration.

## Docker

> The Dockerfile has only been checked statically. Docker is not installed on the development PC,
> so the image build and run are **untested**.

Node 24 base image pinned to an exact tag, multi-stage build, production dependencies only,
non-root `node` user, `EXPOSE 3102`, a `/healthz` health check. The image contains no service
account key, `.env` file or pairing secret: they are supplied at run time.

```sh
docker build -t droidmobile/fcm-bridge server/fcm-bridge

# Create the pairing secret once (printed once; data lives in the named volume)
docker run --rm -v fcm-bridge-data:/data droidmobile/fcm-bridge node dist/cli.js generate-secret

docker run -d --name fcm-bridge --restart unless-stopped \
  -p 127.0.0.1:3102:3102 \
  -v fcm-bridge-data:/data \
  -v /srv/fcm-bridge/service-account.json:/run/fcm/service-account.json:ro \
  -e FIREBASE_SERVICE_ACCOUNT_PATH=/run/fcm/service-account.json \
  -e BRIDGE_TRUST_PROXY=1 \
  droidmobile/fcm-bridge
```

The container binds `0.0.0.0` inside (`BRIDGE_HOST`); publish it on loopback only and put the TLS
proxy in front.

## Development

```powershell
npm run typecheck -w @droidmobile/fcm-bridge
npm run lint -w @droidmobile/fcm-bridge
npm run test -w @droidmobile/fcm-bridge
```

Tests use Fastify `inject` and an injected stub sender; they never touch the network.
