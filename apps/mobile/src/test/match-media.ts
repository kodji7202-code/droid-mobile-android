/**
 * jsdom always reports `matches: false` for matchMedia. Tests stub it to force
 * a value (e.g. the >= 840 px rail query); the returned function restores the
 * original implementation.
 */
export function stubMatchMedia(matches: boolean): () => void {
  const original = window.matchMedia;
  const stub = ((query: string) =>
    ({
      matches,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList) as typeof window.matchMedia;
  window.matchMedia = stub;
  return () => {
    window.matchMedia = original;
  };
}
