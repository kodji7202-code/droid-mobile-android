# Known limitations

## MCP sign-in from the phone

Some MCP servers need an OAuth sign-in. When you start that sign-in from the phone
(**Extensions > MCP servers**), the daemon returns an authorization link and the app opens that
page in the phone's browser. The sign-in completes only if the daemon's OAuth callback address
is reachable from that browser. That address normally points to the PC (a loopback address of the
daemon), so a browser on the phone usually cannot reach it. If the page ends in an error or never
finishes, sign in to that server from the desktop instead.

While a sign-in is pending, the app keeps it across the short trip to the browser, even when
Android drops the app's connection to the daemon meanwhile, and shows a **Signing in** panel when
you come back. You can cancel a pending sign-in there. The app does not use Factory's own
OAuth for itself; see [tos.md](tos.md).

## Daemon and PC

- The daemon must be running and reachable. The phone cannot start it; the PC must be on and the
  daemon supervised (`Start-DroidDaemon`).
- The PC helper is for Windows PowerShell 5.1 or 7. On other systems start `droid daemon` and
  Tailscale Serve by hand ([setup.md](setup.md)).
- Sessions with no messages are not listed by the daemon until the first message. More than 100
  sessions modified in the same second cannot be paged completely (daemon API limit).
- Archived sessions cannot be resumed until you unarchive them.
- Terminals belong to the connection that created them. After a reconnect the app lists them again
  and shows the saved output; the PC shell is `cmd.exe`.
- Worktree sessions are created by the daemon under `~/.factory/worktrees` and the app never
  removes them. Folder trust, once granted, cannot be withdrawn from the app.
- Mission sessions can use many credits. The app asks for confirmation before it creates one.
  Mission Control shows the state of a Mission; it does not replace the desktop for long runs.

## Android

- Release builds connect over `wss://` only, so a plain `ws://` daemon works only in a debug
  build ([security.md](security.md#transport-policy)).
- Android may pause the app in the background. Turn on **Stay connected** and exempt the app from
  battery optimisation ([notifications.md](notifications.md)); some vendors add their own
  restrictions ([troubleshooting.md](troubleshooting.md#battery-restrictions)).
- The `droidmobile://pair` code is pasted or scanned inside the app. It is not registered as a
  link that other apps can open.
- The app is tied to the Firebase project whose `google-services.json` was present at build time.
  A different Firebase project needs its own build.
- Language support: English and Romanian.

## Push bridge

- The bridge speaks plain HTTP; the phone only registers with an `https://` address, so you must
  provide TLS ([notifications.md](notifications.md#fcm-bridge-deployment)).
- The bridge keeps device tokens in a JSON file and suits one person or a small team, not a
  public service.
- The Docker image has only been checked statically; the build and run are untested on the
  development PC.
- Push shows a fixed text ("Open the app to see what needs your attention"). It never contains
  prompt or file content by design.
- Droid reads hooks at start: sessions that were running before `Install-DroidHooks` need a
  restart to send push.

## Not included

- No iOS app, no relay or cloud account, and no way to use Factory features that need Factory's
  own sign-in.
- No analytics or crash reporting. When something breaks, use **Settings > About & diagnostics**
  to export a redacted log and look at it yourself.
