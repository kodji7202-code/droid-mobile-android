import { create } from 'zustand';
import { Capacitor } from '@capacitor/core';
import { biometrics } from '../platform/biometrics';
import type { BiometricOutcome } from '../platform/biometrics';

export const LOCK_ENABLED_KEY = 'droid.lock.enabled';
export const LOCK_GRACE_KEY = 'droid.lock.graceSeconds';
export const GRACE_OPTIONS_SECONDS = [0, 30, 60, 300] as const;
const DEFAULT_GRACE_SECONDS = 30;

/**
 * The system prompt runs in its own activity, so the app sees itself leave and
 * return while the user authenticates. Lifecycle events inside this window
 * after a prompt are ignored, otherwise a grace of 0 would re-lock the app
 * straight after a successful unlock.
 */
const PROMPT_LIFECYCLE_WINDOW_MS = 2000;

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
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Settings persistence is best effort; the in-memory value still applies.
  }
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
  authenticate(reason: string, cancelTitle: string): Promise<BiometricOutcome>;
  onBackground(now: number): void;
  onForeground(now: number): void;
}

let backgroundedAt: number | null = null;
let promptActive = false;
let promptEndedAt = 0;

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
    async authenticate(reason, cancelTitle) {
      promptActive = true;
      backgroundedAt = null;
      try {
        return await biometrics.authenticate(reason, cancelTitle);
      } finally {
        promptActive = false;
        promptEndedAt = Date.now();
        backgroundedAt = null;
      }
    },
    onBackground(now) {
      if (promptActive || now - promptEndedAt < PROMPT_LIFECYCLE_WINDOW_MS) return;
      backgroundedAt = now;
    },
    onForeground(now) {
      const since = backgroundedAt;
      backgroundedAt = null;
      if (promptActive || since === null || !get().enabled) return;
      if (exceedsGrace(now - since, get().graceSeconds)) get().lock();
    },
  };
});
