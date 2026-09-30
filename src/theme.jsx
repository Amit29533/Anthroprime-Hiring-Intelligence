import React, { useEffect, useState } from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';

const KEY = 'ecod-theme-v1';
const choices = ['system', 'light', 'dark'];
export function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem(KEY);
      return choices.includes(saved) ? saved : 'system';
    } catch {
      return 'system';
    }
  });
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = theme === 'system' ? (media?.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
    };
    apply();
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* Theme still works without storage. */
    }
    media?.addEventListener?.('change', apply);
    return () => media?.removeEventListener?.('change', apply);
  }, [theme]);
  useEffect(() => {
    const sync = (event) => {
      if (event.key === KEY) setTheme(choices.includes(event.newValue) ? event.newValue : 'system');
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  return [theme, setTheme];
}

export function ThemeToggle({ theme, onChange }) {
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  const next = theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system';
  return (
    <button
      type="button"
      className="theme-toggle"
      title={`Theme: ${theme}. Switch to ${next}`}
      aria-label={`Theme: ${theme}. Switch to ${next}`}
      onClick={() => onChange(next)}
    >
      <Icon size={18} aria-hidden="true" />
    </button>
  );
}
