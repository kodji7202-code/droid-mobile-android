import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { TranscriptHandle } from './Transcript';

/** Distance from the bottom within which the view counts as following the stream. */
const FOLLOW_SLACK_PX = 160;
/** Distance from the top at which the next older page is requested. */
const OLDER_TRIGGER_PX = 400;
/** Upward movement that releases following; content growth never lowers scrollY. */
const RELEASE_DELTA_PX = 4;

function scrollToBottom() {
  window.scrollTo?.(0, document.documentElement.scrollHeight);
}

interface ReadingAnchor {
  key: string;
  top: number;
}

const transcriptRows = () =>
  Array.from(document.querySelectorAll<HTMLElement>('.session-messages > li'));

/** The first mounted transcript row that reaches into the viewport, with its viewport offset. */
function measureAnchor(): ReadingAnchor | null {
  for (const element of transcriptRows()) {
    const { top, bottom } = element.getBoundingClientRect();
    const key = element.dataset.rowKey;
    if (bottom > 0 && key) return { key, top };
  }
  return null;
}

/** True once the anchor row is mounted and back at its offset. */
function restoreAnchor({ key, top }: ReadingAnchor): boolean {
  const element = transcriptRows().find((row) => row.dataset.rowKey === key);
  if (!element) return false;
  const delta = element.getBoundingClientRect().top - top;
  if (Math.abs(delta) >= 1) window.scrollTo?.(0, window.scrollY + delta);
  return true;
}

/** Frames spent waiting for a row outside the mounted window to be mounted after a jump. */
const RESTORE_FRAMES = 4;

interface ChatScrollOptions {
  /** Changes whenever the transcript grows or its last item changes. */
  contentSignal: unknown;
  hasMore: boolean;
  loadingOlder: boolean;
  /** False while history is loading or the view is not usable. */
  active: boolean;
  loadOlder(): void;
  /** Reaches rows that the virtualised transcript has not mounted. */
  transcript?: RefObject<TranscriptHandle | null>;
}

/**
 * The window scrolls. While following, new content keeps the bottom in view;
 * scrolling up releases it until the user jumps back. Reaching the top loads the
 * next older page; the first visible message is kept at its viewport offset across the prepend.
 */
export function useChatScroll(options: ChatScrollOptions) {
  const { contentSignal, hasMore, loadingOlder, active, loadOlder, transcript } = options;
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

  // The first visible message is measured while the DOM still shows the old rows (render
  // runs before the commit), then put back at the same viewport offset once the older rows
  // are in. Native anchoring is switched off: it does nothing at offset 0 and would race
  // with the manual restore elsewhere. The reader may reach the top while the request is
  // pending, so the anchor is taken when the page arrives, not when it was requested.
  const wasLoading = useRef(false);
  const anchor = useRef<ReadingAnchor | null>(null);
  if (wasLoading.current && !loadingOlder) anchor.current = measureAnchor();
  wasLoading.current = loadingOlder;

  useLayoutEffect(() => {
    const held = anchor.current;
    anchor.current = null;
    if (loadingOlder || !held) return undefined;
    // Older rows are prepended above a transcript that mounts only a window of rows, so
    // the held row may be gone: jump to where it now starts, then fine-tune once it is mounted.
    if (!restoreAnchor(held)) transcript?.current?.scrollToKey(held.key, held.top);
    let frame = 0;
    let left = RESTORE_FRAMES;
    const settle = () => {
      // Markdown, images and measured row heights settle a frame after the commit.
      const placed = restoreAnchor(held);
      left -= 1;
      if (!placed && left > 0) frame = requestAnimationFrame(settle);
    };
    frame = requestAnimationFrame(settle);
    return () => cancelAnimationFrame(frame);
  }, [loadingOlder, transcript]);

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
