import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOARD_THEMES, defaultPrefs, MIN_BOARD_SCALE, parseSavedPrefs, PIECE_SETS } from './prefs';

const stored = (blob: unknown) => JSON.stringify(blob);

describe('parseSavedPrefs', () => {
  it('starts a new visitor with nothing chosen', () => {
    expect(parseSavedPrefs(null)).toEqual({ saved: {}, stale: true });
  });

  it('keeps what was chosen in an entry this build wrote', () => {
    const { saved, stale } = parseSavedPrefs(stored({ pieces: 'merida', animation: 'normal', sound: false, boardScale: 0.8, v: 2, rev: 1 }));
    expect(saved).toEqual({ pieces: 'merida', animation: 'normal', sound: false, boardScale: 0.8 });
    expect(stale).toBe(false);
  });

  it('treats values an older build wrote back as defaults, not choices', () => {
    // Before rev 1 every setting was stored, chosen or not.
    const old = { boardTheme: 'ocean', pieces: 'staunty', sound: true, animation: 'normal', coach: false, coordinates: true, showDests: true, highlightLast: true, autoQueen: false, figurines: true, boardScale: 1, v: 2 };
    const { saved, stale } = parseSavedPrefs(stored(old));
    expect(saved).toEqual({ boardTheme: 'ocean', coach: false });
    expect(stale).toBe(true);
  });

  it('keeps a non-default animation from an older build', () => {
    expect(parseSavedPrefs(stored({ animation: 'slow', v: 2 })).saved).toEqual({ animation: 'slow' });
    expect(parseSavedPrefs(stored({ animation: 'off', v: 2 })).saved).toEqual({ animation: 'off' });
  });

  it('moves entries from before v2 to the default board and pieces once', () => {
    const { saved, stale } = parseSavedPrefs(stored({ boardTheme: 'walnut', pieces: 'cburnett', sound: false }));
    expect(saved).toEqual({ sound: false });
    expect(stale).toBe(true);
  });

  it('drops values it does not understand and clamps the board size', () => {
    const { saved } = parseSavedPrefs(stored({ boardTheme: 'neon', pieces: 42, animation: 'fast', sound: 'yes', boardScale: 0.1, extra: true, v: 2, rev: 1 }));
    expect(saved).toEqual({ boardScale: MIN_BOARD_SCALE });
    expect(parseSavedPrefs(stored({ boardScale: 7, v: 2, rev: 1 })).saved).toEqual({ boardScale: 1 });
    expect(parseSavedPrefs(stored({ boardScale: 'big', v: 2, rev: 1 })).saved).toEqual({});
  });

  it('survives an entry that is not an object', () => {
    for (const raw of ['', 'not json', 'null', '[]', '"prefs"', '3']) {
      expect(parseSavedPrefs(raw).saved).toEqual({});
    }
  });
});

describe('defaultPrefs', () => {
  it('turns piece animation off for people who asked for reduced motion', () => {
    expect(defaultPrefs(false).animation).toBe('normal');
    expect(defaultPrefs(true).animation).toBe('off');
    expect({ ...defaultPrefs(true), animation: 'normal' }).toEqual(defaultPrefs(false));
  });

  it('gives way to an explicit choice either way', () => {
    const { saved } = parseSavedPrefs(stored({ animation: 'normal', v: 2, rev: 1 }));
    expect({ ...defaultPrefs(true), ...saved }.animation).toBe('normal');
  });
});

describe('public/theme-init.js', () => {
  // The first-paint script cannot import this module, so it repeats the lists and defaults.
  const script = readFileSync('public/theme-init.js', 'utf8');
  const list = (name: string) => {
    const match = new RegExp(`var ${name} = \\[([^\\]]*)\\]`).exec(script);
    return (match?.[1] ?? '').split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean).sort();
  };

  it('knows the same board themes and piece sets as prefs.ts', () => {
    expect(list('BOARDS')).toEqual(BOARD_THEMES.map((b) => b.id).sort());
    expect(list('PIECES')).toEqual(PIECE_SETS.map((p) => p.id).sort());
  });

  /** Runs the script against a fake <html> and storage, and reports what it set. */
  function firstPaint(storage: Record<string, string> | 'blocked') {
    const attrs: Record<string, string> = {};
    const vars: Record<string, string> = {};
    const metas = [{ content: 'unset' }, { content: 'unset' }];
    const document = {
      documentElement: {
        setAttribute: (k: string, v: string) => void (attrs[k] = v),
        style: { setProperty: (k: string, v: string) => void (vars[k] = v) },
      },
      querySelectorAll: () => metas.map((m) => ({ setAttribute: (_k: string, v: string) => (m.content = v) })),
    };
    const localStorage = {
      getItem: (k: string) => {
        if (storage === 'blocked') throw new Error('SecurityError');
        return storage[k] ?? null;
      },
    };
    new Function('document', 'localStorage', script)(document, localStorage);
    return { theme: attrs['data-theme'], board: attrs['data-board'], pieces: attrs['data-pieces'], scale: vars['--board-scale'], chrome: metas.map((m) => m.content) };
  }

  it('sets the board, pieces and size exactly as prefs.ts will', () => {
    const entries = [
      undefined,
      '{}',
      'null',
      'not json',
      stored({ boardTheme: 'ocean', pieces: 'merida', boardScale: 0.8, v: 2, rev: 1 }),
      stored({ boardTheme: 'ocean', pieces: 'staunty', sound: true, animation: 'normal', boardScale: 1, v: 2 }),
      stored({ boardTheme: 'walnut', pieces: 'cburnett', boardScale: 0.75 }),
      stored({ boardTheme: 'neon', pieces: 42, boardScale: 0.1, v: 2, rev: 1 }),
      stored({ boardScale: 7, v: 2, rev: 1 }),
      stored({ boardScale: 'big', v: 2, rev: 1 }),
    ];
    for (const entry of entries) {
      const expected = { ...defaultPrefs(false), ...parseSavedPrefs(entry ?? null).saved };
      const painted = firstPaint(entry === undefined ? {} : { prefs: entry });
      expect({ board: painted.board, pieces: painted.pieces, scale: painted.scale }, entry).toEqual({
        board: expected.boardTheme,
        pieces: expected.pieces,
        scale: String(expected.boardScale),
      });
    }
  });

  it('applies an explicit theme and leaves the system one alone', () => {
    expect(firstPaint({ theme: 'dark' })).toMatchObject({ theme: 'dark', chrome: ['#121211', '#121211'] });
    expect(firstPaint({ theme: 'light' })).toMatchObject({ theme: 'light', chrome: ['#f5f3ee', '#f5f3ee'] });
    expect(firstPaint({})).toMatchObject({ theme: undefined, chrome: ['unset', 'unset'] });
    expect(firstPaint({ theme: 'sepia' }).theme).toBeUndefined();
  });

  it('falls back to the defaults when storage is blocked', () => {
    const d = defaultPrefs(false);
    expect(firstPaint('blocked')).toEqual({ theme: undefined, board: d.boardTheme, pieces: d.pieces, scale: String(d.boardScale), chrome: ['unset', 'unset'] });
  });
});
