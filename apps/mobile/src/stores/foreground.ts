import { create } from 'zustand';

interface ForegroundStore {
  /** False while the app is in the background. */
  appActive: boolean;
  /** The session whose chat is on screen, or null on any other screen. */
  viewedSessionId: string | null;
  setAppActive(active: boolean): void;
  setViewedSessionId(id: string | null): void;
}

/** What the user is looking at right now; local notifications are skipped for it. */
export const useForegroundStore = create<ForegroundStore>((set) => ({
  appActive: true,
  viewedSessionId: null,
  setAppActive(appActive) {
    set({ appActive });
  },
  setViewedSessionId(viewedSessionId) {
    set({ viewedSessionId });
  },
}));
