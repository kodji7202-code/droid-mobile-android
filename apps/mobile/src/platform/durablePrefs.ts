import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

/**
 * Non-secret settings mirrored into native SharedPreferences. Chromium flushes
 * localStorage to disk only a few seconds after a write, so a process kill right
 * after a change would silently revert it. Never add a secret here.
 *
 * The keys are literals on purpose: importing them from the stores would run the
 * stores (which read localStorage on import) before `restoreDurablePrefs` ran.
 */
export const DURABLE_PREF_KEYS = [
  'droid.stayConnected',
  'droidm.lang',
  'droidm.theme',
  'droid.notifications.enabled',
  'droid.notifications.approvals',
  'droid.notifications.turns',
  'droid.lock.enabled',
  'droid.lock.graceSeconds',
] as const;

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Best effort; the in-memory value still applies.
  }
}

async function restoreOne(key: string): Promise<void> {
  try {
    const { value } = await Preferences.get({ key });
    if (value !== null && value !== undefined) {
      writeLocal(key, value);
      return;
    }
    // An install from before the native mirror existed: copy its settings up.
    const local = readLocal(key);
    if (local !== null) await Preferences.set({ key, value: local });
  } catch {
    // A failing plugin falls back to whatever localStorage holds.
  }
}

/** Native only: the native value wins and is written into localStorage. Must finish before the stores load. */
export async function restoreDurablePrefs(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await Promise.all(DURABLE_PREF_KEYS.map(restoreOne));
}

/** Persists a non-secret setting to localStorage and, on native, to the durable native mirror. */
export async function writePref(key: string, value: string): Promise<void> {
  writeLocal(key, value);
  if (!Capacitor.isNativePlatform()) return;
  try {
    await Preferences.set({ key, value });
  } catch {
    // localStorage already holds the value for this session.
  }
}
