import { useEffect } from 'react';

const KEYBOARD_ATTRIBUTE = 'data-soft-keyboard';

/**
 * Marks the document while the soft keyboard covers the lower part of the
 * screen so the bottom navigation can make room for the terminal keys. Only a
 * focused terminal input with a viewport clearly shorter than the screen counts,
 * which keeps desktop browsers and hardware keyboards unaffected.
 */
export function useSoftKeyboardMarker(host: HTMLElement | null): void {
  useEffect(() => {
    if (!host) return;
    const root = document.documentElement;
    const update = () => {
      const focused = host.contains(document.activeElement);
      const height = window.visualViewport?.height ?? window.innerHeight;
      const open = focused && height < window.screen.height * 0.75;
      if (open) root.setAttribute(KEYBOARD_ATTRIBUTE, 'open');
      else root.removeAttribute(KEYBOARD_ATTRIBUTE);
    };
    update();
    window.addEventListener('resize', update);
    host.addEventListener('focusin', update);
    host.addEventListener('focusout', update);
    return () => {
      window.removeEventListener('resize', update);
      host.removeEventListener('focusin', update);
      host.removeEventListener('focusout', update);
      root.removeAttribute(KEYBOARD_ATTRIBUTE);
    };
  }, [host]);
}
