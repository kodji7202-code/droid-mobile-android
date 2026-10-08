# Notifications

Droid Mobile can tell you when Droid needs your approval or has finished a turn. There are three
layers. Use the ones you need.

| Layer                       | Works when                                            | Needs                                          |
| --------------------------- | ----------------------------------------------------- | ---------------------------------------------- |
| Local notifications         | The app is in the background but its process is alive | Android notification permission                |
| Stay connected              | You switch the app away for a long time               | The foreground service and a battery exemption |
| Push through the FCM bridge | The app is closed or Android froze it                 | Your own FCM bridge, hooks on the PC, Firebase |

## Local notifications

Open **Settings > Notifications**.

- Turn on **Notifications**. The app explains why, then Android asks for the notification
  permission (Android 13 and later). If you refuse, the screen offers **Open notification
  settings**.
- Two channels appear in the Android settings and can be tuned there: **Approval requests**
  (high importance, shown on top of other apps, with an **Approve** action) and **Finished turns**
  (quiet). A third channel, **Background connection**, belongs to the foreground service.
- A notification for the session you are looking at is not shown, and notifications are withdrawn
  once you answer or see the request. Tapping one opens that session.
- Channel names follow the app language. If Android refuses a notification, the app tries again
  later.
- The local approval notification and the push for the same session share one tag
  (`approvals:<sessionId>`). If a push for that session arrives after the local notification, it
  replaces it, and the replacement has no **Approve** button. Open the app to answer.
- Local notifications are built on the phone and can name the tool or command that waits for
  approval. Push notifications from the bridge never do.

## Stay connected (foreground service)

Android can stop a backgrounded app and with it the connection to your daemon. **Stay connected**
runs a small foreground service of type "data sync" that keeps the app process alive. It also
runs on its own while a turn or an approval is pending. A low-priority notification with a
**Stop** button is shown while it runs. Tapping **Stop** switches stay connected off and the app
does not restart the service until it is needed again.

While the service runs (Stay connected on, or a turn running), the app keeps its page visible to
Android's web engine, so long turns can finish and notify with the screen off. When the service
stops, the page is throttled or frozen as usual.

On Android 15 the system limits how long a "data sync" service may run. When that limit is
reached the service pauses and starts again the next time you open the app. Tapping **Stop** is
final and is not undone by this restart. The app also checks on resume that the service matches
what is running.

The toggle is in **Settings > Notifications**. Stay connected costs some battery; turn it off to
save battery when you do not need it.

The app keeps its non-secret settings (stay connected, language, theme, notification switches,
app lock) in native storage as well, so they survive Android closing the app right after you
change them.

## Battery optimisation

Open **Settings > Notifications > Battery optimisation**. The screen shows whether Droid Mobile
is exempt and walks you through **Open battery settings**: choose **Unrestricted** (or **Don't
optimise**; on Samsung: Battery > Background usage limits > Never sleeping apps > add Droid
Mobile). Without the exemption, Android may pause the app, stall running turns and delay or drop
notifications. See also [troubleshooting.md](troubleshooting.md#battery-restrictions).

## Push through the FCM bridge

Push reaches the phone even when the app is closed. The path is:

```text
Droid hook on the PC  ──▶  FCM bridge (your PC or server)  ──▶  Firebase Cloud Messaging  ──▶  phone
```

Only the event kind (`permission_prompt`, `idle_prompt`, `stop`) and the session id are sent,
with a fixed title and text. No prompt text, file content, path or tool input leaves the PC. The
payload is described in [the bridge README](../server/fcm-bridge/README.md#fcm-message).

### FCM bridge deployment

1. **Firebase.** Create a Firebase project and add an Android app with the id
   `com.droidmobile.client`. Put its `google-services.json` in `secrets/` before you build the
   release ([release.md](release.md)); the build copies it into the app. Create a service
   account key for the project; the bridge reads it through `FIREBASE_SERVICE_ACCOUNT_PATH`. Both
   files are git-ignored and secret.
2. **Bridge.** Create the pairing secret once, then run the bridge:

   ```powershell
   $env:BRIDGE_DATA_DIR = "$env:LOCALAPPDATA\DroidMobileBridge"   # use the same value every time
   npm run generate-secret -w @droidmobile/fcm-bridge             # prints the secret once; copy it now
   npm run build -w @droidmobile/fcm-bridge
   $env:FIREBASE_SERVICE_ACCOUNT_PATH = 'D:\path\to\service-account.json'
   node server/fcm-bridge/dist/server.js
   ```

   Save the printed secret in a file such as `pair-secret.txt` for the helper commands below.
   Set `$env:BRIDGE_DRY_RUN = '1'` to try everything without sending. Without
   `BRIDGE_DATA_DIR` the bridge uses `./data` relative to the folder it is started in, so
   `generate-secret` (run by npm inside `server/fcm-bridge`) and `node server/fcm-bridge/...`
   (run from the repository root) would look at different folders. The environment table, API,
   rate limits and logs are in [the bridge README](../server/fcm-bridge/README.md).

3. **TLS.** The bridge speaks plain HTTP. The app only registers with an `https://` bridge
   address, so put a TLS reverse proxy (Caddy or nginx) in front of it, as in
   [Deploy behind TLS](../server/fcm-bridge/README.md#deploy-behind-tls), or run the Docker image
   on your own server ([Docker notes](../server/fcm-bridge/README.md#docker), untested on the
   development PC).
4. **Hooks on the PC.** The helper adds a `Notification` and a `Stop` hook that post to the
   bridge. Hooks on the same PC may use `http://127.0.0.1:3102`:

   ```powershell
   Install-DroidHooks -BridgeUrl http://127.0.0.1:3102 -BridgeSecretFile .\pair-secret.txt
   ```

   The helper backs up your settings file first and only edits what it added. Restart running
   Droid sessions afterwards, because Droid reads hooks at start. `Uninstall-DroidHooks` removes
   them. Details: [the helper README](../tools/pc-helper/README.md#install-droidhooks).

5. **Register the phone.** Create a pairing code that carries the bridge details:

   ```powershell
   New-PairingCode -BridgeUrl https://bridge.example.com -BridgeSecretFile .\pair-secret.txt
   ```

   In the app open **Settings > Notifications > Push notifications**, paste or scan the code and
   choose **Register this phone**. You can also type the bridge URL and the pairing secret by
   hand. **Turn off push** unregisters the phone from the bridge.

   **Turn off on this phone only** invalidates this phone's FCM token without contacting the
   bridge. The screen is truthful about progress: **Removal pending** means the bridge still has
   the registration and the app will remove it; **Delivery not yet stopped** means the token
   could not be invalidated yet. In both cases the app retries automatically at app start and
   when the device comes back online, and sign-out keeps retrying the cleanup.

6. **Check.** `Doctor -BridgeUrl https://bridge.example.com` checks that the bridge answers
   `/healthz` and that the hooks are installed.

### Rotating the bridge secret

`npm run generate-secret -w @droidmobile/fcm-bridge -- --rotate` replaces the secret and the old
one stops working at once. Update `Install-DroidHooks` with the new secret and register each phone
again. See [security.md](security.md#key-rotation).

## What if push does not arrive

See [troubleshooting.md](troubleshooting.md#push-not-arriving).
