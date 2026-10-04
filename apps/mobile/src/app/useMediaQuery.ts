import { useEffect, useState } from 'react';

/**
 * Subscribes to a CSS media query from JS. Used to switch between the phone
 * bottom navigation bar and the >= 840 px navigation rail so only one of the
 * two exists in the DOM at a time.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };
    setMatches(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
