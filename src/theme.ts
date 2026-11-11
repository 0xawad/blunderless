// One theme store for the whole app. The rail button and Settings read the
// same state, so they cannot drift apart, and it follows the OS while the
// choice is 'system'. public/theme-init.js applies the saved choice before
// first paint with the same rules: change them together.
import { useSyncExternalStore } from 'react';

export type Theme = 'system' | 'light' | 'dark';

export interface ThemeState {
  /** What the user picked. */
  theme: Theme;
  /** Whether the page is dark right now ('system' resolved against the OS). */
  dark: boolean;
}

const KEY = 'theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';
/** Browser chrome colour per scheme: --bg in src/styles/tokens.css (also in index.html and public/theme-init.js). */
const CHROME = { light: '#f5f3ee', dark: '#121211' } as const;

const systemDark = () => typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches;
const resolve = (theme: Theme): ThemeState => ({ theme, dark: theme === 'dark' || (theme === 'system' && systemDark()) });

/** The saved choice. 'system' is stored as no entry at all. */
export function readTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

let state = resolve(readTheme());
const listeners = new Set<() => void>();

function paint() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (state.theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', state.theme);
  const color = state.dark ? CHROME.dark : CHROME.light;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', color));
}

/** Takes on `theme` without saving it, repaints, and tells subscribers if anything changed. */
function adopt(theme: Theme) {
  const next = resolve(theme);
  const changed = next.theme !== state.theme || next.dark !== state.dark;
  if (changed) state = next;
  paint();
  if (changed) listeners.forEach((l) => l());
}

/** Picks a theme: saves it, applies it to the document and updates every useTheme() caller. */
export function setTheme(theme: Theme) {
  try {
    if (theme === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    /* private mode: the choice lasts for this visit */
  }
  adopt(theme);
}

/** The older name for setTheme, kept for callers written before the store. */
export const applyTheme = setTheme;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getState = () => state;

/** The current theme, and whether that means dark right now. Re-renders on any change, including the OS switching. */
export function useTheme(): ThemeState {
  return useSyncExternalStore(subscribe, getState, getState);
}

if (typeof window !== 'undefined') {
  // The OS switched between light and dark: only changes anything while following it.
  if (typeof matchMedia === 'function') matchMedia(DARK_QUERY).addEventListener?.('change', () => adopt(state.theme));
  // Another tab picked a theme.
  window.addEventListener('storage', (e) => {
    if (e.key === KEY || e.key === null) adopt(readTheme());
  });
}
