import { useCallback, useEffect, useState } from 'react';

// Light/dark theme. Dark is the default (matching the app's original look);
// honors a saved choice, else the system preference. Toggling adds/removes the
// `light` class on <html> (see the CSS tokens in index.css) and persists it.
export function useTheme() {
  const [dark, setDark] = useState(() => {
    try {
      const stored = localStorage.getItem('theme');
      if (stored) return stored === 'dark';
    } catch {
      // ignore
    }
    if (typeof window !== 'undefined' && window.matchMedia) {
      return !window.matchMedia('(prefers-color-scheme: light)').matches;
    }
    return true;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('light', !dark);
    try {
      localStorage.setItem('theme', dark ? 'dark' : 'light');
    } catch {
      // ignore
    }
  }, [dark]);

  const toggle = useCallback(() => setDark((d) => !d), []);
  return [dark, toggle];
}
