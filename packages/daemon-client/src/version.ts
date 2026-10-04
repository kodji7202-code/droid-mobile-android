/**
 * Version of the bundled @factory/droid-sdk. The SDK does not export its own
 * version and the root entrypoint has no version field, so it is mirrored
 * here and kept in sync with the exact dependency pin in
 * packages/daemon-client/package.json (asserted by version.test.ts).
 * Settings > About surfaces it (VAL-ONBOARD-035, VAL-SET-021).
 */
export const SDK_PACKAGE_VERSION = '0.9.1';
