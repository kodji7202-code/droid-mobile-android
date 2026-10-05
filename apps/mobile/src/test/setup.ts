import '@testing-library/jest-dom/vitest';
import { i18nReady } from '../i18n/init';

// Every test file waits for i18next initialization so rendered components are
// localized (no raw translation keys) regardless of which test runs first.
await i18nReady;

// jsdom does not implement matchMedia; provide a no-op stub (matches: false,
// listener API present) so useMediaQuery and the ThemeProvider work under test.
// Individual tests override it via src/test/match-media.ts stubMatchMedia.
if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList,
  });
}

// jsdom logs "not implemented" for window.scrollTo; the chat scroll hook calls it on every update.
window.scrollTo = (() => undefined) as typeof window.scrollTo;
