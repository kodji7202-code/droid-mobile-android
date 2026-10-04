import { useCallback, useRef, useState } from 'react';
import type { TouchEvent } from 'react';

export const PULL_THRESHOLD_PX = 72;
const MAX_PULL_PX = 120;
const RESISTANCE = 0.5;

interface PullToRefresh {
  /** Visual pull distance in px (0 when idle). */
  distance: number;
  handlers: {
    onTouchStart(event: TouchEvent): void;
    onTouchMove(event: TouchEvent): void;
    onTouchEnd(): void;
    onTouchCancel(): void;
  };
}

/**
 * Touch-only pull-to-refresh for a list scrolled by the document: a downward
 * drag that starts while the page is at the top, released past the threshold,
 * triggers `onRefresh`. Mouse and keyboard users use the refresh button.
 */
export function usePullToRefresh(onRefresh: () => void): PullToRefresh {
  const [distance, setDistance] = useState(0);
  const startY = useRef<number | null>(null);
  const pulled = useRef(0);

  const reset = useCallback(() => {
    startY.current = null;
    pulled.current = 0;
    setDistance(0);
  }, []);

  const onTouchStart = useCallback((event: TouchEvent) => {
    const atTop = (document.scrollingElement?.scrollTop ?? window.scrollY) <= 0;
    startY.current = atTop ? event.touches[0].clientY : null;
  }, []);

  const onTouchMove = useCallback((event: TouchEvent) => {
    if (startY.current === null) {
      return;
    }
    const delta = event.touches[0].clientY - startY.current;
    if (delta <= 0) {
      pulled.current = 0;
      setDistance(0);
      return;
    }
    pulled.current = Math.min(MAX_PULL_PX, delta * RESISTANCE);
    setDistance(pulled.current);
  }, []);

  const onTouchEnd = useCallback(() => {
    const shouldRefresh = pulled.current >= PULL_THRESHOLD_PX * RESISTANCE;
    reset();
    if (shouldRefresh) {
      onRefresh();
    }
  }, [onRefresh, reset]);

  return { distance, handlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: reset } };
}
