import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** Just enough of a browser for theme.ts: storage, the dark-mode media query, <html> and the theme-color tags. */
function browser({ osDark = false, saved }: { osDark?: boolean; saved?: string } = {}) {
  const storage = new Map<string, string>(saved ? [['theme', saved]] : []);
  const html = new Map<string, string>();
  const metas = [{ content: '' }, { content: '' }];
  const media = { matches: osDark, listeners: [] as (() => void)[] };
  const windowListeners: Record<string, (e: { key: string | null }) => void> = {};

  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  });
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return media.matches;
    },
    addEventListener: (_type: string, l: () => void) => media.listeners.push(l),
  }));
  vi.stubGlobal('document', {
    documentElement: {
      setAttribute: (k: string, v: string) => void html.set(k, v),
      removeAttribute: (k: string) => void html.delete(k),
    },
    querySelectorAll: () => metas.map((m) => ({ setAttribute: (_k: string, v: string) => (m.content = v) })),
  });
  vi.stubGlobal('window', { addEventListener: (type: string, l: (e: { key: string | null }) => void) => (windowListeners[type] = l) });

  return {
    storage,
    /** data-theme on <html>, or undefined when following the system. */
    attr: () => html.get('data-theme'),
    chrome: () => metas.map((m) => m.content),
    osSwitches(dark: boolean) {
      media.matches = dark;
      media.listeners.forEach((l) => l());
    },
    otherTabPicks(theme: string | null) {
      if (theme) storage.set('theme', theme);
      else storage.delete('theme');
      windowListeners.storage({ key: 'theme' });
    },
  };
}

const LIGHT = '#f5f5f4';
const DARK = '#141415';

/** A fresh copy of the module, as a page load would get. */
async function load() {
  vi.resetModules();
  return import('./theme');
}

afterEach(() => vi.unstubAllGlobals());

describe('theme store', () => {
  it('reads the saved choice, and "system" when there is none or it is unusable', async () => {
    browser({ saved: 'dark' });
    expect((await load()).readTheme()).toBe('dark');
    browser({ saved: 'sepia' });
    expect((await load()).readTheme()).toBe('system');
    browser();
    expect((await load()).readTheme()).toBe('system');
  });

  it('saves and applies an explicit choice', async () => {
    const b = browser({ osDark: true });
    const { setTheme } = await load();
    setTheme('light');
    expect(b.storage.get('theme')).toBe('light');
    expect(b.attr()).toBe('light');
    expect(b.chrome()).toEqual([LIGHT, LIGHT]);
    setTheme('dark');
    expect(b.attr()).toBe('dark');
    expect(b.chrome()).toEqual([DARK, DARK]);
  });

  it('stores "system" as no entry and follows the OS when it changes', async () => {
    const b = browser({ saved: 'dark' });
    const { setTheme } = await load();
    setTheme('system');
    expect(b.storage.has('theme')).toBe(false);
    expect(b.attr()).toBeUndefined();
    expect(b.chrome()).toEqual([LIGHT, LIGHT]);
    b.osSwitches(true);
    expect(b.attr()).toBeUndefined();
    expect(b.chrome()).toEqual([DARK, DARK]);
  });

  it('keeps an explicit choice when the OS changes', async () => {
    const b = browser();
    const { setTheme } = await load();
    setTheme('light');
    b.osSwitches(true);
    expect(b.attr()).toBe('light');
    expect(b.chrome()).toEqual([LIGHT, LIGHT]);
  });

  it('takes on a choice made in another tab without writing it back', async () => {
    const b = browser();
    const { applyTheme, readTheme } = await load();
    applyTheme(readTheme());
    b.otherTabPicks('dark');
    expect(b.attr()).toBe('dark');
    expect(b.chrome()).toEqual([DARK, DARK]);
    b.otherTabPicks(null);
    expect(b.attr()).toBeUndefined();
    expect(b.storage.has('theme')).toBe(false);
  });

  it('imports and works where there is no browser at all', async () => {
    const { readTheme, setTheme } = await load();
    expect(readTheme()).toBe('system');
    expect(() => setTheme('dark')).not.toThrow();
  });
});

describe('page background colours', () => {
  // The same two hexes are written in five places that cannot import each other.
  const read = (path: string) => readFileSync(path, 'utf8');
  const tokens = read('src/styles/tokens.css');

  it('match the --bg tokens everywhere they are repeated', () => {
    expect(tokens).toMatch(new RegExp(`:root \\{[^}]*--bg: ${LIGHT};`));
    expect(tokens).toMatch(new RegExp(`:root\\[data-theme='dark'\\] \\{[^}]*--bg: ${DARK};`));
    for (const file of ['src/theme.ts', 'public/theme-init.js', 'index.html']) {
      expect(read(file), file).toContain(LIGHT);
      expect(read(file), file).toContain(DARK);
    }
    const manifest = JSON.parse(read('public/manifest.webmanifest'));
    expect([manifest.background_color, manifest.theme_color]).toEqual([LIGHT, LIGHT]);
  });
});
