import { create } from 'zustand';

export const NOTIFICATIONS_ENABLED_KEY = 'droid.notifications.enabled';
export const NOTIFICATIONS_APPROVALS_KEY = 'droid.notifications.approvals';
export const NOTIFICATIONS_TURNS_KEY = 'droid.notifications.turns';

/** A missing value means the default (on): the Android permission is what gates a fresh install. */
function read(key: string): boolean {
  try {
    return window.localStorage.getItem(key) !== 'false';
  } catch {
    return true;
  }
}

function persist(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Best effort; the in-memory value still applies.
  }
}

interface NotificationSettingsStore {
  /** The user's master choice. Notifications show only while Android also allows them. */
  enabled: boolean;
  approvals: boolean;
  turns: boolean;
  setEnabled(enabled: boolean): void;
  setChannel(channel: 'approvals' | 'turns', enabled: boolean): void;
}

/** Master and per-channel notification switches. Non-secret, so localStorage. */
export const useNotificationSettingsStore = create<NotificationSettingsStore>((set) => ({
  enabled: read(NOTIFICATIONS_ENABLED_KEY),
  approvals: read(NOTIFICATIONS_APPROVALS_KEY),
  turns: read(NOTIFICATIONS_TURNS_KEY),
  setEnabled(enabled) {
    persist(NOTIFICATIONS_ENABLED_KEY, enabled);
    set({ enabled });
  },
  setChannel(channel, enabled) {
    persist(
      channel === 'approvals' ? NOTIFICATIONS_APPROVALS_KEY : NOTIFICATIONS_TURNS_KEY,
      enabled,
    );
    set({ [channel]: enabled });
  },
}));
