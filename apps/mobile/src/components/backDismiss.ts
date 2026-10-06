import { useEffect, useRef } from 'react';

/** Open overlays, innermost last; the Android back button dismisses the innermost one. */
const stack: Array<() => void> = [];

/** Dismisses the innermost open overlay. Returns false when none is open. */
export function dismissTopOverlay(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top();
  return true;
}

/** Registers an open modal so the Android back button closes it before any navigation. */
export function useBackDismiss(open: boolean, onDismiss: () => void): void {
  const latest = useRef(onDismiss);
  useEffect(() => {
    latest.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!open) return undefined;
    const entry = () => latest.current();
    stack.push(entry);
    return () => {
      const index = stack.lastIndexOf(entry);
      if (index >= 0) stack.splice(index, 1);
    };
  }, [open]);
}
