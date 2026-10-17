# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

Nothing yet.

## [1.0.1] - 2026-10-17

Pairing fixes. Version code 2, so it installs over 1.0.0 and keeps your saved connections.

### Fixed

- **QR scanner**: **Scan QR code** now uses the Google Code Scanner (Google Play services) instead
  of a camera preview that stayed hidden behind the app. The app needs no camera permission. When
  the scanner module is missing or still downloading, the screen shows progress or a clear
  message that points to **Scan from image**, **Paste** or manual entry.
- **Pasting a pairing code** accepts what you actually copy from a console: line breaks and
  spaces from a wrapped line, and quotes or angle brackets around the code, are tolerated.

### Added

- **Paste buttons** on the Connect screen and in **Settings > Notifications > Push
  notifications** read the clipboard and show a message when it does not hold a valid pairing
  code.
- **Auto-connect**: a pairing code that contains the API key connects right away. A code
  without a key fills the address and waits for you to enter the key.
- **`droidmobile://pair` link**: the app now opens pairing links, always behind a confirmation
  dialog that shows the daemon (and whether a key or bridge is included) before anything is
  saved. Camera apps such as Samsung Camera and Google Lens usually show a custom-scheme QR
  code as plain text only, so scan with the in-app scanner or use **Paste**
  ([docs/pairing.md](docs/pairing.md#opening-a-pairing-link)).
- **PC QR window**: `New-PairingCode` opens a large QR code in your browser from a temporary
  page that only your Windows account can read, and deletes the page after you press Enter. Use
  `-NoWindow` to skip it.

### Changed

- The `release verification` script also checks that the APK `versionName` and `versionCode`
  match `apps/mobile/package.json`.

## [1.0.0] - 2026-10-08

First complete version of Droid Mobile, an unofficial Android client for Factory's Droid coding
agent. It connects to your own `droid daemon` through the Apache-2.0 `@factory/droid-sdk`.

### Foundation

- Connect screen with a daemon URL and Factory API key, pairing by code, QR scan, QR from image or
  pasted text; several saved connections.
- API key kept in Android Keystore-backed storage; optional biometric or screen-lock app lock.
- Transport policy: release builds accept `wss://` only; debug builds may use `ws://`.
- English and Romanian UI, light and dark theme, tablet two-pane layouts for Sessions,
  Workspace and Settings, accessibility support and performance budgets.
- Signed release APK and AAB pipeline with verification (`apksigner`, manifest and secret
  checks).

### Agent experience

- Session list with search, create, rename, archive and resume, including worktree sessions and
  spec mode.
- Chat with streaming replies, tool calls, diffs and attachments; model, reasoning effort and
  autonomy selection; interrupt; context usage.
- Permission approvals and agent questions as dialogs, with approve once, always approve and deny.

### Workspace

- File tree, search and viewer with syntax highlighting.
- Git status, diff, commit, branches and push.
- Terminal with an extra-key row.

### Extensions and Missions

- MCP servers (including OAuth sign-in), skills, custom slash commands, plugins and
  marketplaces, custom models and automations.
- Missions UI to view and start Mission sessions (not yet exercised with real long runs; see
  `docs/limitations.md`).

### Background delivery

- Local notifications for approvals and finished turns, with separate channels and an
  **Approve** action.
- **Stay connected** foreground service that keeps long turns alive with the screen off, with
  battery optimisation guidance.
- Optional push through a self-hosted FCM bridge (`server/fcm-bridge`) with pairing, hook
  installation by the PC helper, de-duplication with local notifications, deep links and a
  truthful turn-off flow. Push carries only the event kind and the session id.

### PC tools

- `tools/pc-helper` PowerShell module: supervised daemon, Tailscale Serve, pairing codes, Droid
  hooks and `Doctor`.

[Unreleased]: https://github.com/kodji7202-code/droid-mobile-android/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/kodji7202-code/droid-mobile-android/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/kodji7202-code/droid-mobile-android/releases/tag/v1.0.0
