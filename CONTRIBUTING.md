# Contributing to Droid Mobile

Thanks for your interest. Droid Mobile is an unofficial Android client for Factory's Droid
coding agent. Bug reports, documentation fixes, translations and pull requests are welcome.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). To report a
vulnerability, follow [SECURITY.md](SECURITY.md) and do not open a public issue.

## Ground rules

- **Public interfaces only.** The app talks to the user's own `droid daemon` through the
  Apache-2.0 `@factory/droid-sdk`. Changes that need a private Factory API, a relay server or
  Factory's own sign-in will not be accepted ([docs/tos.md](docs/tos.md)).
- **No secrets, ever.** Never commit or paste API keys, bridge secrets, keystores,
  `google-services.json`, Firebase service accounts, real Tailscale machine names or personal paths
  in code, tests, docs, issues or screenshots. Use placeholders such as
  `my-pc.tailnet-name.ts.net`. `.env.local`, `secrets/` and `.tmp/` are git-ignored; keep it so.
- **English everywhere.** Code, comments, commit messages, docs, scripts and templates are in
  English. The one exception is the Romanian UI bundle `apps/mobile/src/i18n/ro.json` (and the
  Android `values-ro` resources) plus test fixtures that exercise it.
- **Pinned dependencies.** Dependencies use exact versions. Add one only when it is clearly
  needed and explain why in the pull request.

## Setup

Requirements: Node.js 24 (npm 11) and git. Windows 10/11 with PowerShell 5.1 or later is the
supported development platform, because the PC helper and several tests run `powershell.exe`.
Native Android work also needs JDK 21 and the Android SDK ([docs/android.md](docs/android.md)).

```powershell
git clone https://github.com/kodji7202-code/droid-mobile-android.git
cd droid-mobile-android
npm ci
npm run dev -w @droidmobile/mobile   # web build on http://127.0.0.1:3100 (the port is fixed)
```

Copy [`.env.example`](.env.example) to `.env.local` if you need to run integration tests, build a
signed release or run the FCM bridge against Firebase.

## Branches and commits

- Branch from `main`: `fix/short-description`, `feat/short-description` or `docs/short-description`.
- Keep a pull request focused on one change. Large changes: open an issue first.
- Commit messages are short, imperative and sentence case, for example
  `Fix push removal retry after a failed token invalidation`. Explain the why in the body when it
  is not obvious. Do not rewrite history that is already pushed.

## Running the checks

Run these from the repository root before you open a pull request. CI runs the same commands on
`windows-latest`.

```powershell
npm run typecheck     # tsc --noEmit in every workspace
npm run lint          # ESLint, including the "no hard-coded UI strings" rule
npm run test          # Vitest unit project (~1,700 tests)
npm run i18n:check    # en.json and ro.json have the same keys and placeholders
npm run docs:check    # required sections, relative links, npm scripts mentioned in the docs
npm run build         # production build of the app and the bridge
npm run bundle:budget # initial JavaScript must stay within the gzip budget
npm run scan:secrets  # scans the tree and history for keys and signing material
npx prettier --check <files you changed>
```

Integration tests talk to a real daemon and use your own Factory key (they cost a little
credit). Start a throwaway daemon and load `.env.local`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\dev\start-daemon.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tools\dev\with-env.ps1 npm run test:integration
powershell -NoProfile -ExecutionPolicy Bypass -File tools\dev\stop-daemon.ps1
```

Native unit tests (JVM, no emulator):

```powershell
. .\tools\dev\env-android.ps1
cd apps\mobile\android
.\gradlew.bat testDebugUnitTest
```

CI does not run Gradle. If your change touches the native shell, run the command above and
`npm run android:check`.

## Translations (i18n rules)

All user-visible text lives in `apps/mobile/src/i18n/en.json` and `apps/mobile/src/i18n/ro.json`.

- Every key must exist in **both** files. `npm run i18n:check` fails otherwise. The only allowed
  difference is Romanian's extra plural categories (`_few`, `_many`).
- Placeholders such as `{{name}}` and `{{count}}` must match in both languages.
- Do not hard-code UI strings in components. The ESLint rule `local/no-hardcoded-strings`
  reports them; use `t('...')` instead.
- Keep Romanian text out of the repository everywhere except the Romanian bundle, the Android
  `values-ro` resources and tests that verify them.
- To add a language, add a bundle with the same keys, register it in
  `apps/mobile/src/i18n/init.ts`, add the Android `values-xx/strings.xml` and extend the tests.

## Code style

- TypeScript strict mode; prefer the existing patterns in the folder you touch.
- Format files you change with `npx prettier --write <file>`. `npm run format:check` still reports
  a few older files that predate the Prettier setup; do not reformat unrelated files.
- Add a comment only when the reason is not obvious from the code.
- Add or update tests for behaviour changes. UI components are tested with Testing Library;
  the adapter in `packages/daemon-client` has unit and integration tests.
- Update the documentation in `docs/` when you change behaviour, and keep
  [docs/limitations.md](docs/limitations.md) truthful.

## Screenshots and demo data

Use a scratch Factory home (`FACTORY_HOME_OVERRIDE`) and a throwaway demo project, so no real
sessions, paths, hostnames or keys appear in screenshots.

## Pull requests

Fill in the pull request template, link the issue, describe how you tested the change and
attach screenshots for UI changes. A maintainer reviews every pull request; please be patient and
keep the discussion respectful.

## License

By contributing you agree that your contribution is licensed under the
[Apache License 2.0](LICENSE).
