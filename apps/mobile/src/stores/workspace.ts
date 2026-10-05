import { create } from 'zustand';

interface WorkspaceStore {
  showHidden: boolean;
  setShowHidden: (show: boolean) => void;
  toggleHidden: () => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  expandedBySession: Record<string, string[]>;
  scrollBySession: Record<string, number>;
  toggleExpanded: (sessionKey: string, path: string) => void;
  getExpanded: (sessionKey: string) => string[];
  setScrollTop: (sessionKey: string, scrollTop: number) => void;
  getScrollTop: (sessionKey: string) => number;
  resetSession: (sessionKey: string) => void;
}

const EMPTY_EXPANDED: string[] = [];

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  showHidden: false,
  setShowHidden: (showHidden) => set({ showHidden }),
  toggleHidden: () => set((state) => ({ showHidden: !state.showHidden })),
  searchQuery: '',
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  expandedBySession: {},
  scrollBySession: {},
  toggleExpanded: (sessionKey, path) =>
    set((state) => {
      const current = state.expandedBySession[sessionKey] ?? EMPTY_EXPANDED;
      const has = current.includes(path);
      const next = has ? current.filter((p) => p !== path) : [...current, path];
      return {
        expandedBySession: {
          ...state.expandedBySession,
          [sessionKey]: next,
        },
      };
    }),
  getExpanded: (sessionKey) => get().expandedBySession[sessionKey] ?? EMPTY_EXPANDED,
  setScrollTop: (sessionKey, scrollTop) =>
    set((state) => ({
      scrollBySession: {
        ...state.scrollBySession,
        [sessionKey]: scrollTop,
      },
    })),
  getScrollTop: (sessionKey) => get().scrollBySession[sessionKey] ?? 0,
  resetSession: (sessionKey) =>
    set((state) => {
      const { [sessionKey]: _expanded, ...restExpanded } = state.expandedBySession;
      const { [sessionKey]: _scroll, ...restScroll } = state.scrollBySession;
      return {
        expandedBySession: restExpanded,
        scrollBySession: restScroll,
      };
    }),
}));
