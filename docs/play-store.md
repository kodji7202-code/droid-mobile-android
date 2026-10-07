# Play Store listing notes

Working notes for publishing Droid Mobile. They are drafts to paste into Play Console, not a
guarantee of approval. Check the current Play policies before you submit. Build and sign the
bundle first ([release.md](release.md)); upload `app-release.aab`.

## Identity and branding

| Field          | Value                                                                         |
| -------------- | ----------------------------------------------------------------------------- |
| App name       | Droid Mobile (30 characters at most; no "Factory", no "Droid by ..." wording) |
| Package name   | `com.droidmobile.client` (cannot change after the first upload)               |
| Category       | Tools or Productivity                                                         |
| Icon           | The bundled original artwork; it contains no Factory logo or mark             |
| Developer name | Yours. Do not imply that Factory publishes the app                            |

The store listing, screenshots and graphics must not use Factory logos, product screenshots or
trademarks, and must say that the app is unofficial ([tos.md](tos.md)).

## Short description (80 characters at most)

> Unofficial mobile client for your own Droid daemon: sessions, approvals, files.

## Full description (draft)

> Droid Mobile is an unofficial Android client for the Droid coding agent that runs on your own
> computer. It is not made or endorsed by Factory.
>
> Connect to the Droid daemon on your PC with your own API key over an encrypted `wss://`
> connection (for example through Tailscale). Then you can:
>
> - start, resume and search sessions and chat with streaming replies
> - approve or deny tool requests and answer the agent's questions
> - browse files and diffs, commit and push, and use a terminal
> - manage MCP servers, skills, slash commands, plugins, custom models and automations
> - get notifications when Droid needs you or finishes a turn
>
> Your API key stays in the Android Keystore on your phone. There is no relay server and no
> account with the developer. English and Romanian, light and dark theme, optional biometric
> lock.
>
> Requires a PC running the `droid daemon` that your phone can reach. Setup guide and source:
> link to your repository.

## Data safety form

Answer for the release build, which contains no analytics, advertising or crash-reporting SDK.

| Question                                 | Suggested answer                                                                                                                                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does the app collect or share user data? | The developer collects nothing. Data goes only to the user's own daemon (and, if enabled, the user's own bridge and Firebase).                                                                           |
| Data in transit encrypted?               | Yes, `wss://` only in release builds; the bridge address must be `https://`.                                                                                                                             |
| Can users request data deletion?         | The developer holds no data. In the app, **Sign out** removes saved connections and keys from the device; **Turn off push** unregisters.                                                                 |
| API key, session content                 | Processed on device and sent to the user's own daemon only. Not collected by the developer.                                                                                                              |
| Device or other IDs                      | Push registration uses a Firebase Cloud Messaging token (and the Firebase installation id), sent to the user's own bridge. Declare "Device or other IDs" as used for app functionality if you ship push. |
| Files and docs, photos                   | Only when the user attaches a file or picks a QR image; sent to the user's own daemon.                                                                                                                   |

If you publish without `google-services.json` push is absent and the Firebase rows do not apply.

## Permissions and declarations

| Permission                                                | Why the app needs it                                                                                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `INTERNET`, `ACCESS_NETWORK_STATE`                        | Connect to the user's daemon and bridge.                                                                                                               |
| `POST_NOTIFICATIONS`                                      | Approval requests and finished turns (asked after an explanation inside the app).                                                                      |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC`      | Keeps the daemon connection alive while a turn is running or the user turned on **Stay connected**; has a visible notification with a **Stop** button. |
| `CAMERA` (optional hardware)                              | Scan the pairing QR code. The app works without it (type the details or scan an image).                                                                |
| `USE_BIOMETRIC`, `USE_FINGERPRINT`                        | Optional app lock, added by the biometric plugin.                                                                                                      |
| `WAKE_LOCK`, `com.google.android.c2dm.permission.RECEIVE` | Added by Firebase Cloud Messaging for push delivery.                                                                                                   |

Foreground service declaration (Play Console, App content): type **Data sync** (the app keeps a
user-initiated, long-running synchronisation with the user's own server). Describe the user
action (starting a session or turning on Stay connected), the visible notification and the Stop
button. A short screen recording of **Settings > Notifications > Stay connected** helps review.

The app does not request `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`. It opens the system battery
settings and explains the steps ([notifications.md](notifications.md#battery-optimisation)).

## Other App content answers

- **Privacy policy URL**: required. State what the data safety table says: no developer-side
  collection, key only on device, optional push through the user's own bridge and Firebase.
- **Target audience**: adults (developers). Not designed for children.
- **Ads**: none. **Government app**, **financial features**, **health**: no.
- **Content rating**: questionnaire answers are all "no" except that the app can show
  user-generated or AI-generated text from the user's own agent; review the current AI-content
  questions.
- **Target SDK 36, minimum SDK 24.**
- **Testing**: Play requires a closed test with the required number of testers before production
  for new personal developer accounts; check the current rule.

## Screenshots to prepare

Phone and tablet, light and dark, from a release build connected to a demo daemon with no real
data: Connect screen, Sessions list, a chat with a tool call and an approval, file viewer with a
diff, Settings > Notifications, Settings > Language. Hide the daemon URL and never show an API
key. English and Romanian listings can reuse the same images.

## Release checklist

1. `npm run test`, `npm run typecheck`, `npm run lint`, `npm run docs:check`.
2. `npm run android:release` (runs the signing, manifest and secret checks).
3. `npm run scan:secrets`.
4. Raise `versionCode`, upload `app-release.aab`, attach the notes above, submit to a closed test
   first.
