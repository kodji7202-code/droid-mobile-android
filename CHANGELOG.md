# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

Nothing yet.

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

[Unreleased]: https://github.com/kodji7202-code/droid-mobile-android/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/kodji7202-code/droid-mobile-android/releases/tag/v1.0.0
