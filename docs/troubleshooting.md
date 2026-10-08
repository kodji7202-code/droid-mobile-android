# Troubleshooting

Start on the PC with the helper's checker. It is read-only and prints a fix under every problem:

```powershell
Import-Module .\tools\pc-helper\DroidMobileHelper.psd1
Doctor -DaemonPort 3101
```

Then match your symptom below.

## Connection refused

The app says it could not reach a daemon at this address, or the status stays **Offline** or
**Connection error**.

1. Is the daemon running? On the PC: `Invoke-WebRequest http://127.0.0.1:3101/health -UseBasicParsing`
   must answer `factory-daemon ok`. If not, `Start-DroidDaemon -Port 3101` (log files are in
   `%LOCALAPPDATA%\DroidMobileHelper\logs`).
2. Is it published? `tailscale serve status` must list the HTTPS port (8443 in this guide) and
   point to `http://127.0.0.1:3101`. If not, run `Enable-TailscaleServe -Port 8443 -DaemonPort 3101`.
3. Does the phone use the same address and port? The app expects the `wss://` address printed by
   `Enable-TailscaleServe`, with the port.
4. Is Tailscale connected on the phone, on the same tailnet as the PC? Open the Tailscale app and
   check that the PC is listed. The PC must be awake.
5. A different message, **The daemon rejected this API key**, means the daemon is fine and the key
   is wrong. Enter a valid `fk-...` key.
6. With a debug build over `adb reverse`, run `adb reverse tcp:3101 tcp:3101` again after every
   reconnect of the USB cable, and use `ws://127.0.0.1:3101`.

## TLS or certificate error

The connection fails during the TLS handshake, or the browser or app mentions a certificate.

- Enable **MagicDNS** and **HTTPS certificates** on the DNS page of the Tailscale admin console.
  `Doctor` shows the "HTTPS certificates" check as FAIL while they are off. Run
  `Enable-TailscaleServe` again afterwards.
- Use the MagicDNS name (`<your-machine>.<tailnet>.ts.net`), never the `100.x` address or the
  short machine name: the certificate is issued for the full name only.
- The first request after enabling serve can take a few seconds while Tailscale gets the
  certificate. Retry.
- Check the date and time on the phone; a wrong clock makes valid certificates look invalid.
- If a reverse proxy in front of the FCM bridge shows the error, renew or fix its certificate
  ([bridge README](../server/fcm-bridge/README.md#deploy-behind-tls)).

## ws:// blocked in release

The release app says **This build only connects over wss://. Use a secure address.**

Release builds refuse `ws://` on purpose: Android blocks cleartext, and the app checks the address
before it opens a socket. Use the `wss://` address from Tailscale Serve
([setup.md](setup.md#tailscale-serve-and-https-certificates)). For a plain `ws://` daemon on a
trusted network (emulator, `adb reverse`) install a debug build (`npm run android:debug`); it
shows an insecure-endpoint banner. Debug and release builds have different signatures, so
uninstall one before you install the other ([release.md](release.md#install-on-a-phone)).

## Push not arriving

Work from the phone back to the PC.

1. **Settings > Notifications > Push notifications** must show **Registered**. If registering
   fails the error names the cause: the bridge address must start with `https://`, the secret was
   rejected (re-copy it, or rotate and register again), or the bridge is unreachable from the
   phone.
2. The Android permission must be **Allowed** and the **Approval requests** and **Finished
   turns** channels must be on, in the app and in the Android notification settings.
3. Check the bridge from a browser or `curl.exe https://<bridge>/healthz`: `{"status":"ok"}`. In
   its startup log look for `mode: real-send`; `mode: dry-run` sends nothing by design.
4. Send a test event from the PC (the secret is in the variable, not on screen):

   ```powershell
   Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3102/v1/events -Headers @{ Authorization = "Bearer $env:BRIDGE_SECRET" } -ContentType 'application/json' -Body '{"session_id":"test","hook_event_name":"Stop"}'
   ```

   `sent: 1` means the bridge handed the message to FCM (with `dryRun: True` it only counted it).
   `sent: 0` means no registered phone, or an event type the bridge ignores.

5. If the test works but real events do not, the hooks are not firing. `Doctor` shows "Droid hooks".
   Run `Install-DroidHooks`, then restart Droid sessions that were open before; Droid reads hooks
   at start. Hook failures are logged in `%LOCALAPPDATA%\DroidMobileHelper\logs\hook.log`.
6. After a bridge secret rotation every phone must register again.
7. A phone you force-stopped does not receive push until you open the app once.
8. If the screen shows **Removal pending** or **Delivery not yet stopped** after you turned push
   off, the app retries at app start and when the device is back online. Open the app with a
   connection to let it finish.
9. Check [battery restrictions](#battery-restrictions) next.

## Battery restrictions

Symptoms: turns stall when the screen is off, notifications arrive late or only when you open the
app, **Stay connected** stops by itself.

- Open **Settings > Notifications > Battery optimisation** and follow **Open battery settings**:
  choose **Unrestricted** (or **Don't optimise**). On Samsung: Battery > Background usage limits >
  Never sleeping apps > add Droid Mobile, and remove Droid Mobile from Sleeping apps or Deep
  sleeping apps.
- The screen shows **Exempt from battery optimisation** once it worked.
- Turn on **Stay connected** for long turns, and keep the notification it shows; do not swipe the
  app away from recents if your phone vendor treats that as a force stop. It costs some battery;
  turn it off to save battery.
- On Android 15 the system may pause the service after a long run. Open the app to start it again;
  an explicit **Stop** stays final.
- Some vendors add their own "protected apps" or "autostart" lists; allow Droid Mobile there too.
  See [dontkillmyapp.com](https://dontkillmyapp.com) for vendor steps.
- Push through the bridge ([notifications.md](notifications.md)) still arrives for a stopped
  process, but vendor restrictions can delay it.

## Other problems

- **Port 3100 is taken** (dev server): `--strictPort` makes Vite fail instead of picking another
  port. Stop the process you started there.
- **The daemon is not healthy after about 8 seconds** when started with `tools\dev\start-daemon.ps1`:
  read `.tmp\logs\daemon-3101.err.log`.
- **A command in this documentation fails with "running scripts is disabled"**: run PowerShell with
  `-ExecutionPolicy Bypass` for the script, as the npm scripts do.
- **`Start-DroidDaemon` says the port is held by another process**: the helper never stops a
  process it did not start. Choose another port in 3100 to 3199.
