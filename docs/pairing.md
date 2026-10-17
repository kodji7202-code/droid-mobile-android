# Connecting the phone

The app needs two things: the address of your daemon and your Factory API key. You can type
them or fill them from a pairing code. Set up the PC first ([setup.md](setup.md)).

## What you need

| Item       | Example                            | Where it comes from                                   |
| ---------- | ---------------------------------- | ----------------------------------------------------- |
| Daemon URL | `wss://my-pc.tail1234.ts.net:8443` | `Enable-TailscaleServe` prints it as `URL: wss://...` |
| API key    | `fk-...`                           | Your own Factory API key                              |

Release builds accept `wss://` addresses only. A `ws://` address is refused with a message before
any connection is opened. Debug builds also accept `ws://` for the emulator and `adb reverse`, and
show an "insecure" banner when they do (see [android.md](android.md)).

## Option 1: type the URL and the key

1. Open the app. On first start it shows **Connect to your daemon**.
2. Enter the **Daemon URL** and the **API key**.
3. Tap **Connect**. The app opens the WebSocket and signs in with the key. The connection is
   saved only after that succeeds.

The key field is hidden and not kept in the page; the key goes into Android Keystore-backed
storage.

## Option 2: pairing code (text or QR)

On the PC, run:

```powershell
Import-Module .\tools\pc-helper\DroidMobileHelper.psd1
New-PairingCode
```

It prints a code and a QR block of the same text:

```text
droidmobile://pair?v=1&url=wss://my-pc.tail1234.ts.net:8443
```

### The QR window on the PC

In an interactive console `New-PairingCode` also opens a large QR code in your default browser (a
temporary page in `%LOCALAPPDATA%\DroidMobile\pairing\`, readable only by your Windows account).
Scan it, then press Enter in the PowerShell window; the page is deleted. If the command is
interrupted with Ctrl+C the page is deleted too. Use `New-PairingCode -NoWindow` to skip the page
and use the QR block in the console.

### On the phone

Use one of these paths on the Connect screen:

- **Scan QR code** opens the Google Code Scanner (part of Google Play services; the app needs no
  camera permission). The first time, the scanner module may download, with a progress message.
  If the module is not available (no Google Play services, no network for the download, or the
  scan fails), the screen says so; use **Scan from image**, **Paste from clipboard** or type the
  details.
- **Scan from image** reads a QR code from a picture or screenshot.
- **Paste from clipboard** reads the clipboard and applies the code in one tap. Copy the text on
  the PC (for example into a note that syncs to the phone) and tap it.
- **Paste pairing code** is the text field for the same thing: paste into it and the code is
  applied right away.

Pasting is forgiving. Line breaks and spaces that a console adds when it wraps a long line, and
quotes or angle brackets around the code, are ignored. If the clipboard holds something else, the
app says the clipboard does not contain a valid pairing code and changes nothing.

A valid code fills the URL (and the key, when the code contains one):

- A code **with** a key connects immediately. The connection is saved only after the daemon
  accepts the key, and the key never appears on screen.
- A code **without** a key fills the URL and moves to the key field; type the key and tap
  **Connect**.

The code is checked strictly: unknown parameters, a wrong version or half a bridge pair make it
invalid, and nothing is filled.

### Opening a pairing link

The app is registered for `droidmobile://pair` links, so tapping one in a note, a chat or a
browser on the phone opens Droid Mobile. The app never acts on a link silently: it first shows a
**Pair with this daemon?** dialog with the daemon address, whether an API key is included (the key
itself is not shown) and the notification bridge, if any. **Continue** applies the link the same
way as a pasted code (a link with a key connects, a link without one fills the address and waits
for the key); **Cancel** discards it and changes nothing. With the app lock on, the dialog
appears only after you unlock the app. A release build accepts only `wss://` links. A link that
is not valid shows an error and changes nothing.

Phone camera apps such as Samsung Camera and Google Lens usually show a QR code with a custom
scheme like `droidmobile://` as plain text only, without an "open" button. Scan the QR with the
in-app **Scan QR code** instead, or copy the text and use **Paste from clipboard**. The PC helper's
QR window and the console QR carry the same text.

### What a pairing code contains

| Parameter               | Meaning                                                                           |
| ----------------------- | --------------------------------------------------------------------------------- |
| `v=1`                   | Format version (required).                                                        |
| `url=<wss address>`     | The daemon address.                                                               |
| `key=<fk-...>`          | Your Factory API key. Only present when you run `New-PairingCode -IncludeApiKey`. |
| `bridge=<https url>`    | Address of your FCM bridge (optional, needs `bridgeSecret`).                      |
| `bridgeSecret=<secret>` | The bridge pairing secret, not your Factory key (optional, needs `bridge`).       |

By default the code does **not** include your Factory API key; type the key in the app. With
`-IncludeApiKey` the helper reads the key from `$env:FACTORY_API_KEY` (or asks for it without
echo), shows it on screen with a warning and never writes it to a file. Anyone who sees that
code or QR can use your key, so only use it on a screen nobody else can see and rotate the key
if you are unsure ([security.md](security.md#key-rotation)).

With `-BridgeUrl` and `-BridgeSecretFile`, the code also carries the bridge details, and the app
offers them in **Settings > Notifications > Push notifications**
([notifications.md](notifications.md)). The bridge secret is kept only in Keystore-backed storage
until you register the phone or discard it, and is never shown.

## Several connections

**Settings > Connection** lists saved connections. You can add, edit (leave the key empty to keep
the stored one), switch the active connection, forget a connection (removes its key) or sign out
(removes everything). With the app lock on (**Settings > Security**), the connection details stay
hidden until you authenticate.

## If it does not connect

The app tells the causes apart: key rejected, daemon unreachable, URL format, ws:// in a release
build. See [troubleshooting.md](troubleshooting.md).
