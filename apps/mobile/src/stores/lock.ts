import { create } from 'zustand';
import { Capacitor } from '@capacitor/core';
import { biometrics } from '../platform/biometrics';
import { writePref } from '../platform/durablePrefs';
import type { BiometricOutcome } from '../platform/biometrics';

export const LOCK_ENABLED_KEY = 'droid.lock.enabled';
export const LOCK_GRACE_KEY = 'droid.lock.graceSeconds';
export const GRACE_OPTIONS_SECONDS = [0, 30, 60, 300] as const;
const DEFAULT_GRACE_SECONDS = 30;

function readEnabled(): boolean {
  try {
    return window.localStorage.getItem(LOCK_ENABLED_KEY) === 'true';
  } catch {
    return false;
  }
}

function readGrace(): number {
  try {
    const stored = window.localStorage.getItem(LOCK_GRACE_KEY);
    const value = stored === null ? NaN : Number(stored);
    return (GRACE_OPTIONS_SECONDS as readonly number[]).includes(value)
      ? value
      : DEFAULT_GRACE_SECONDS;
  } catch {
    return DEFAULT_GRACE_SECONDS;
  }
}

function persist(key: string, value: string): void {
  void writePref(key, value);
}

/** True when the app has been away from the foreground longer than the grace period. */
export function exceedsGrace(awayMs: number, graceSeconds: number): boolean {
  return awayMs > graceSeconds * 1000;
}

interface LockStore {
  enabled: boolean;
  graceSeconds: number;
  /** Starts locked on native when the lock is enabled, so no screen renders before unlocking. */
  locked: boolean;
  setEnabled(enabled: boolean): void;
  setGraceSeconds(seconds: number): void;
  lock(): void;
  unlock(): void;
  /** Runs the system prompt; lifecycle events caused by the prompt are ignored. */
  authenticate(reason: string, cancelTitle: string, title?: string): Promise<BiometricOutcome>;
  onBackground(now: number): void;
  onForeground(now: number): void;
}

let backgroundedAt: number | null = null;
/**
 * The system prompt runs in its own activity, so the app sees itself leave and
 * return while the user authenticates. Only transitions while the prompt is
 * showing are ignored; a background after it closed is a genuine one, even
 * seconds after an unlock.
 */
let promptActive = false;
/** Set when the app went to the background while the prompt was showing and has not returned since. */
let backgroundedDuringPrompt: number | null = null;
/** The app returned during the prompt after an away long enough to be real inactivity. */
let awayBeyondGraceDuringPrompt = false;
/** Prompt-caused leave/return transitions finish well inside this window. */
const PROMPT_TRANSITION_FLOOR_MS = 1500;

export const useLockStore = create<LockStore>((set, get) => {
  const enabled = readEnabled();
  return {
    enabled,
    graceSeconds: readGrace(),
    locked: enabled && Capacitor.isNativePlatform(),
    setEnabled(next) {
      persist(LOCK_ENABLED_KEY, String(next));
      set({ enabled: next, locked: next ? get().locked : false });
    },
    setGraceSeconds(seconds) {
      persist(LOCK_GRACE_KEY, String(seconds));
      set({ graceSeconds: seconds });
    },
    lock() {
      if (get().enabled) set({ locked: true });
    },
    unlock() {
      set({ locked: false });
    },
    async authenticate(reason, cancelTitle, title) {
      promptActive = true;
      backgroundedAt = null;
      backgroundedDuringPrompt = null;
      awayBeyondGraceDuringPrompt = false;
      let outcome: BiometricOutcome | null = null;
      try {
        outcome = await biometrics.authenticate(reason, cancelTitle, title);
        return outcome;
      } finally {
        promptActive = false;
        // Home pressed over the prompt: the prompt closes without the app ever
        // returning, so that background is genuine.
        backgroundedAt = outcome === 'success' ? null : backgroundedDuringPrompt;
        backgroundedDuringPrompt = null;
        if (awayBeyondGraceDuringPrompt) get().lock();
        awayBeyondGraceDuringPrompt = false;
      }
    },
    onBackground(now) {
      if (promptActive) {
        backgroundedDuringPrompt ??= now;
        return;
      }
      backgroundedAt = now;
    },
    onForeground(now) {
      if (promptActive) {
        const left = backgroundedDuringPrompt;
        backgroundedDuringPrompt = null;
        const limitMs = Math.max(get().graceSeconds * 1000, PROMPT_TRANSITION_FLOOR_MS);
        if (left !== null && get().enabled && now - left > limitMs) {
          awayBeyondGraceDuringPrompt = true;
        }
        return;
      }
      const since = backgroundedAt;
      backgroundedAt = null;
      if (promptActive || since === null || !get().enabled) return;
      if (exceedsGrace(now - since, get().graceSeconds)) get().lock();
    },
  };
});
