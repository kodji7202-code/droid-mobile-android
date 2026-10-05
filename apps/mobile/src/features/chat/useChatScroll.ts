import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Distance from the bottom within which the view counts as following the stream. */
const FOLLOW_SLACK_PX = 160;
/** Distance from the top at which the next older page is requested. */
const OLDER_TRIGGER_PX = 400;
/** Upward movement that releases following; content growth never lowers scrollY. */
const RELEASE_DELTA_PX = 4;

function scrollToBottom() {
  window.scrollTo?.(0, document.documentElement.scrollHeight);
}

interface ChatScrollOptions {
  /** Changes whenever the transcript grows or its last item changes. */
  contentSignal: unknown;
  hasMore: boolean;
  loadingOlder: boolean;
  /** False while history is loading or the view is not usable. */
  active: boolean;
  loadOlder(): void;
}

/**
 * The window scrolls. While following, new content keeps the bottom in view;
 * scrolling up releases it until the user jumps back. Reaching the top loads the
 * next older page; the browser's scroll anchoring keeps the item being read in place
 * (content-visibility rows change height as they approach the viewport, so a manual
 * offset correction would drift). Only at offset 0, where anchoring is suppressed, is
 * the height added by the older page restored by hand.
 */
export function useChatScroll(options: ChatScrollOptions) {
  const { contentSignal, hasMore, loadingOlder, active, loadOlder } = options;
  const following = useRef(true);
  const [away, setAway] = useState(false);
  const latest = useRef({ hasMore, loadingOlder, active, loadOlder });
  latest.current = { hasMore, loadingOlder, active, loadOlder };

  const setFollowing = useCallback((value: boolean) => {
    following.current = value;
    setAway(!value);
  }, []);

  useEffect(() => {
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const atBottom =
        window.innerHeight + y >= document.documentElement.scrollHeight - FOLLOW_SLACK_PX;
      if (atBottom) {
        if (!following.current) setFollowing(true);
      } else if (y < lastY - RELEASE_DELTA_PX && following.current) {
        setFollowing(false);
      }
      const state = latest.current;
      if (
        y < OLDER_TRIGGER_PX &&
        y < lastY &&
        state.active &&
        state.hasMore &&
        !state.loadingOlder
      ) {
        state.loadOlder();
      }
      lastY = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [setFollowing]);

  // At offset 0 the browser's scroll anchoring does nothing, so the prepended page
  // would push the reading position down by its own height.
  const beforeOlder = useRef<{ top: boolean; height: number } | null>(null);
  useLayoutEffect(() => {
    if (loadingOlder) {
      beforeOlder.current = {
        top: window.scrollY <= 0,
        height: document.documentElement.scrollHeight,
      };
      return;
    }
    const before = beforeOlder.current;
    beforeOlder.current = null;
    if (!before?.top || window.scrollY > 0) return;
    const grown = document.documentElement.scrollHeight - before.height;
    if (grown > 0) window.scrollTo?.(0, grown);
  }, [loadingOlder]);

  useLayoutEffect(() => {
    if (following.current) {
      scrollToBottom();
    }
  }, [contentSignal]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return undefined;
    // Rows skipped by content-visibility, lazy highlighting and fonts change the page
    // height without any transcript update; the pin must follow those too.
    const observer = new ResizeObserver(() => {
      if (following.current) scrollToBottom();
    });
    observer.observe(document.documentElement);
    return () => observer.disconnect();
  }, []);

  const jumpToLatest = useCallback(() => {
    setFollowing(true);
    scrollToBottom();
  }, [setFollowing]);

  return { away, jumpToLatest };
}
