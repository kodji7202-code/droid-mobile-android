# Security policy

## Supported versions

Security fixes are made on the `main` branch and released in the next build. Only the latest
release is supported.

## Reporting a vulnerability

Please report vulnerabilities **privately**. Do not open a public issue.

1. Open the repository's **Security** tab and choose **Report a vulnerability**
   (GitHub Security Advisories):
   <https://github.com/kodji7202-code/droid-mobile-android/security/advisories/new>
2. Describe the problem, the affected component and version, and the steps to reproduce it.
   A proof of concept is welcome.
3. You can expect an acknowledgement within a few days and a status update after triage. Please
   allow reasonable time for a fix before you disclose the problem publicly. Reporters are
   credited in the release notes unless they ask not to be.

**Never post API keys, bridge secrets, pairing codes that contain a key, keystore files or
Firebase service accounts** in a report, issue, discussion or pull request. If you accidentally
exposed a credential, rotate it first ([docs/security.md](docs/security.md#key-rotation)) and then
report. Attach the redacted diagnostics export from **Settings > About & diagnostics** instead of
raw logs.

## Scope

In scope:

- The Android app in `apps/mobile` (storage of the API key and connection details, app lock,
  transport policy, notifications, deep links, the foreground service).
- The daemon adapter in `packages/daemon-client`.
- The FCM bridge in `server/fcm-bridge` (authentication, rate limiting, payload content, data at
  rest).
- The PC helper in `tools/pc-helper` and the dev scripts in `tools/dev` (settings and hook
  changes, handling of secrets, process handling).
- Leaks of secrets or personal data in the repository or its history.

Out of scope:

- Vulnerabilities in Factory's products, the `droid` CLI or the `@factory/droid-sdk`. Report them
  to Factory through their own channels.
- Vulnerabilities in Tailscale, Firebase, Android or third-party dependencies, unless Droid
  Mobile uses them in an unsafe way. Dependency advisories are welcome as a pointer.
- Problems that need a rooted device, physical access to an unlocked phone, or a PC that is
  already compromised.
- Debug builds, which deliberately allow cleartext `ws://` for development
  ([docs/security.md](docs/security.md#transport-policy)).
- Denial of service against a self-hosted bridge by someone who can already reach it without
  credentials, beyond the documented rate limits.

## Design summary

How the key is stored, the transport policy, tailnet exposure and the minimal push payload are
described in [docs/security.md](docs/security.md) and
[docs/notifications.md](docs/notifications.md).
