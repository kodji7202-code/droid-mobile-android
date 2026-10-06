import { create } from 'zustand';

export const STAY_CONNECTED_KEY = 'droid.stayConnected';

function read(): boolean {
  try {
    return window.localStorage.getItem(STAY_CONNECTED_KEY) === 'true';
  } catch {
    return false;
  }
}

interface StayConnectedStore {
  enabled: boolean;
  setEnabled(enabled: boolean): void;
}

/** "Stay connected": keeps the foreground service running without a turn. Non-secret, so localStorage. */
export const useStayConnectedStore = create<StayConnectedStore>((set) => ({
  enabled: read(),
  setEnabled(enabled) {
    try {
      window.localStorage.setItem(STAY_CONNECTED_KEY, String(enabled));
    } catch {
      // Best effort; the in-memory value still applies.
    }
    set({ enabled });
  },
}));
