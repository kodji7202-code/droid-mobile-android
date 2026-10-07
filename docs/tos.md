# Unofficial client and Factory terms of service

Droid Mobile is an unofficial client. It is not affiliated with, endorsed by or connected to
Factory. This page records how the app stays inside the public, supported surface of Factory
Droid. It is a design note, not legal advice: read the current Factory terms yourself before you
publish or distribute a build.

## What the app uses

- The official, Apache-2.0 licensed `@factory/droid-sdk` (exact version 0.9.1, root entry point),
  talking to **your own** `droid daemon` over WebSocket.
- **Your own Factory API key** (`fk-...`), which you type in or paste. It is stored in Android
  Keystore-backed storage and sent only to your daemon.
- Firebase Cloud Messaging for the optional push path. FCM carries an event kind and a session
  id, nothing else.

## What the app does not use

- **No relay.** The phone connects to your daemon directly (through your own Tailscale tailnet).
  There is no server operated by this project between the phone and your PC.
- **No OAuth or WorkOS reuse.** The app never signs in to Factory through a browser or WebView,
  and it does not reuse tokens from the Factory desktop app or CLI. (MCP servers that need their
  own sign-in are authorised by the daemon; the app only opens the link the daemon returns. See
  [limitations.md](limitations.md#mcp-sign-in-from-the-phone).)
- **No non-public API.** No undocumented endpoints, no `droid.unstable.*` SDK calls, no scraping
  of app.factory.ai, no reverse-engineered protocol client.
- No analytics, advertising or crash-reporting services.

## Branding

- The app name is **Droid Mobile**. The icon is original artwork and uses no Factory logo or
  trademark. The Play Store name and text follow the same rule ([play-store.md](play-store.md)).
- The About screen and the store listing say that the app is unofficial.

## If Factory changes something

The daemon protocol is versioned. The app shows the daemon and protocol versions in **Settings >
About & diagnostics** and warns when they differ from what it expects. If Factory removes or
changes a method the app relies on, the affected screen degrades with a message instead of
failing silently.
