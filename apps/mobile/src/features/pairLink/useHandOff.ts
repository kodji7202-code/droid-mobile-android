import { useEffect, useRef } from 'react';
import { usePairLinkStore } from './pairLinkStore';

type PairLinkState = ReturnType<typeof usePairLinkStore.getState>;

/**
 * Takes a value the confirmed link left in the store, once: on mount if it is already there
 * and whenever one arrives while the screen is open. The store field is cleared before
 * `apply` runs, so a re-render or a second mount cannot consume it again.
 */
export function useHandOff<T>(
  select: (state: PairLinkState) => T | null,
  clear: (state: PairLinkState) => void,
  apply: (value: T) => void,
): void {
  const latest = useRef({ select, clear, apply });
  useEffect(() => {
    latest.current = { select, clear, apply };
  });

  useEffect(() => {
    const take = (state: PairLinkState) => {
      const value = latest.current.select(state);
      if (value === null) return;
      latest.current.clear(state);
      latest.current.apply(value);
    };
    take(usePairLinkStore.getState());
    return usePairLinkStore.subscribe(take);
  }, []);
}
