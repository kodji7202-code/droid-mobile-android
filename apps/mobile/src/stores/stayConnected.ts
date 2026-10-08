import { create } from 'zustand';
import { writePref } from '../platform/durablePrefs';

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

/** "Stay connected": keeps the foreground service running without a turn. Non-secret, so localStorage plus the native mirror. */
export const useStayConnectedStore = create<StayConnectedStore>((set) => ({
  enabled: read(),
  setEnabled(enabled) {
    void writePref(STAY_CONNECTED_KEY, String(enabled));
    set({ enabled });
  },
}));
