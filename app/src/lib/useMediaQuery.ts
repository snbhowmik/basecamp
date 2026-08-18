import { useEffect, useState } from 'react';

// Used to decide whether an image is rendered at all, not merely whether
// it is visible. `display: none` still costs the download, and on the
// auth screen the institution mark is only needed on narrow viewports —
// on desktop the blue panel already carries it. Rendering conditionally
// keeps the request off the wire entirely.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

// The breakpoint at which the auth screen's blue panel appears. Kept
// here rather than duplicated per component so it cannot drift from the
// `@media (min-width: 60rem)` rule in components.css that reveals it.
export const AUTH_PANEL_QUERY = '(min-width: 60rem)';
