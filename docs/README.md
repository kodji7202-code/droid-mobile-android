# Documentation

Start with the [project README](../README.md) for an overview, then use this index. Droid Mobile
is an **unofficial** client and is not affiliated with Factory ([tos.md](tos.md)).

## Getting started

| Document                                 | Contents                                                              |
| ---------------------------------------- | --------------------------------------------------------------------- |
| [setup.md](setup.md)                     | PC setup: daemon, Tailscale Serve, HTTPS certificates, dev setup      |
| [pairing.md](pairing.md)                 | Connecting the phone: URL, key, QR or text, pairing code              |
| [notifications.md](notifications.md)     | Local notifications, stay connected, battery, push through the bridge |
| [troubleshooting.md](troubleshooting.md) | Fixes for the common problems                                         |
| [limitations.md](limitations.md)         | Known limitations                                                     |

## Security and legal

| Document                         | Contents                                                          |
| -------------------------------- | ----------------------------------------------------------------- |
| [security.md](security.md)       | Where the key lives, transport policy, tailnet exposure, rotation |
| [tos.md](tos.md)                 | Unofficial client and Factory terms-of-service note               |
| [../SECURITY.md](../SECURITY.md) | How to report a vulnerability privately                           |

## Building and releasing

| Document                       | Contents                                                  |
| ------------------------------ | --------------------------------------------------------- |
| [android.md](android.md)       | Native build variants, emulator workflow                  |
| [release.md](release.md)       | Release build, keystore, `apksigner verify`, install      |
| [play-store.md](play-store.md) | Play Store listing notes (text, data safety, permissions) |

## Component guides

| Document                                                         | Contents                                                    |
| ---------------------------------------------------------------- | ----------------------------------------------------------- |
| [../server/fcm-bridge/README.md](../server/fcm-bridge/README.md) | FCM bridge: environment, API, TLS deployment, Docker        |
| [../tools/pc-helper/README.md](../tools/pc-helper/README.md)     | PC helper commands: daemon, serve, hooks, pairing, `Doctor` |

## Contributing

[../CONTRIBUTING.md](../CONTRIBUTING.md) explains the setup, the checks and the translation
rules. Release history is in [../CHANGELOG.md](../CHANGELOG.md).

The screenshots in [images/](images/) were taken from the web build against a real daemon with a
scratch Factory home and a throwaway demo project, so they contain no real sessions, keys or
hostnames.
