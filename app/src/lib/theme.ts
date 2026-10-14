import { useEffect, useState } from 'react';

// Light/dark preference, stored and applied the same way frappe-ui's own
// useColorScheme does (same localStorage key and DOM attribute, on purpose —
// see index.html's pre-paint script, which has to duplicate this contract
// in plain JS since it runs before any module loads).
export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'theme';
const ATTR = 'data-theme';

function systemTheme(): ResolvedTheme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function getTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === 'dark' || saved === 'light' ? saved : 'system';
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === 'system' ? systemTheme() : theme;
}

// Module-scope listeners, notified on every write below — a same-tab set
// never fires a 'storage' event (only other tabs get those), so this is
// what makes a toggle in one open component repaint anything else reading
// the theme in the same page.
const listeners = new Set<() => void>();
function notify() { listeners.forEach((l) => l()); }

export function setTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme);
  if (theme === 'system') {
    document.documentElement.removeAttribute(ATTR);
  } else {
    document.documentElement.setAttribute(ATTR, theme);
  }
  notify();
}

// Read-only subscription to what the page is actually painted in right now
// (never 'system' — that's resolved). Used by anything that must pick a
// per-scheme asset, like the SRM logo's colour-on-white vs white-on-blue
// variant in AppShell.
export function useResolvedTheme(): ResolvedTheme {
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(getTheme()));

  useEffect(() => {
    const recompute = () => setResolved(resolveTheme(getTheme()));
    listeners.add(recompute);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', recompute);
    const onStorage = (e: StorageEvent) => { if (e.key === STORAGE_KEY) recompute(); };
    window.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(recompute);
      mq.removeEventListener('change', recompute);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return resolved;
}

// The full read/write hook, for the toggle itself (Account page).
export function useTheme(): { theme: Theme; resolved: ResolvedTheme; setTheme: (t: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const resolved = useResolvedTheme();

  useEffect(() => {
    const recompute = () => setThemeState(getTheme());
    listeners.add(recompute);
    return () => { listeners.delete(recompute); };
  }, []);

  return { theme, resolved, setTheme };
}
