# Security notes

- The Factory API key lives only in `.env.local` (dev PC) and, at runtime, in the app's
  Keystore-backed storage. Never commit, print, log, screenshot or paste it.
- `.env.local`, `secrets/`, keystores, `google-services.json`, Firebase service accounts
  and `.tmp/` are git-ignored. Check `git status` before every commit.
- Errors and diagnostics must redact keys and tokens (`redactSecrets` in
  `packages/daemon-client`); test ids and localized strings never contain secrets.
- Transport policy: release builds use `wss://` only (no cleartext, no debuggable WebView);
  debug builds may use `ws://` over loopback (`adb reverse`, emulator `10.0.2.2`) and show
  an insecure-endpoint banner.
- The test daemon is unauthenticated on loopback; never expose it beyond the machine
  without TLS (`wss://` via Tailscale Serve is the supported path).
- The API key used during development is rotated by the user after the mission.
