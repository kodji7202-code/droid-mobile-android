/**
 * Debug builds may use cleartext `ws://` daemons; release builds are `wss://`
 * only (transport policy, architecture.md section 2). `VITE_DROID_BUILD` is
 * set by tools/dev/build-android.ps1 to the Capacitor variant; without it the
 * Vite dev server counts as debug and every other build as release.
 */
export function isDebugBuild(): boolean {
  const flavor = import.meta.env.VITE_DROID_BUILD;
  if (flavor === 'debug') return true;
  if (flavor === 'release') return false;
  return import.meta.env.DEV;
}
