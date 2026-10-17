import { create } from 'zustand';
import { isDebugBuild } from '../../platform/buildFlavor';
import type { PairingPayload } from '../connect/pairing';
import { parsePairLink, summarizePairLink } from './pairLink';
import type { PairLinkError, PairLinkSummary } from './pairLink';

export interface PendingPairLink {
  payload: PairingPayload;
  summary: PairLinkSummary;
}

export interface PairLinkNotice {
  /** Distinguishes two identical errors in a row. */
  seq: number;
  error: PairLinkError;
}

interface PairLinkStore {
  /** The link waiting for the user's decision. Memory only, never rendered raw. */
  pending: PendingPairLink | null;
  notice: PairLinkNotice | null;
  /** A confirmed link for the Connect screen to apply through its own connect path. */
  forConnect: PairingPayload | null;
  /** A confirmed key-less link for Settings > Connection to open the add form with. */
  forAddForm: { url: string } | null;
  receive(rawUri: string): void;
  dismiss(): void;
  clearNotice(): void;
  handOffToConnect(payload: PairingPayload): void;
  clearForConnect(): void;
  handOffToAddForm(url: string): void;
  clearForAddForm(): void;
}

/** The cold-start URL and the warm delivery of the same intent arrive within milliseconds. */
const DUPLICATE_WINDOW_MS = 1000;

// Kept outside the store so no subscriber or devtools snapshot can see the raw URI.
let pendingUri: string | null = null;
let lastUri: string | null = null;
let lastAt = 0;
let noticeSeq = 0;

export const usePairLinkStore = create<PairLinkStore>((set) => ({
  pending: null,
  notice: null,
  forConnect: null,
  forAddForm: null,
  receive(rawUri) {
    const now = Date.now();
    if (rawUri === pendingUri || (rawUri === lastUri && now - lastAt < DUPLICATE_WINDOW_MS)) {
      return;
    }
    const parsed = parsePairLink(rawUri, isDebugBuild());
    if (parsed.kind === 'ignored') return;
    lastUri = rawUri;
    lastAt = now;
    if (parsed.kind === 'error') {
      noticeSeq += 1;
      set({ notice: { seq: noticeSeq, error: parsed.error } });
      return;
    }
    pendingUri = rawUri;
    set({ pending: { payload: parsed.payload, summary: summarizePairLink(parsed.payload) } });
  },
  dismiss() {
    pendingUri = null;
    lastAt = Date.now();
    set({ pending: null });
  },
  clearNotice: () => set({ notice: null }),
  handOffToConnect: (payload) => set({ forConnect: payload }),
  clearForConnect: () => set({ forConnect: null }),
  handOffToAddForm: (url) => set({ forAddForm: { url } }),
  clearForAddForm: () => set({ forAddForm: null }),
}));

/** Test seam: forgets the duplicate-suppression memory. */
export function resetPairLinkMemory(): void {
  pendingUri = null;
  lastUri = null;
  lastAt = 0;
}
