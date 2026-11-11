import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { copy } from '../copy';
import { analysed, T0 } from './fixtures';
import {
  buildMotifs,
  KIND_THEMES,
  MASTERED,
  MIN_KIND_EVENTS,
  MIN_THEME_ATTEMPTS,
  PUZZLE_THEMES,
  puzzlesUrl,
  RECENT_ATTEMPTS,
  themeForKind,
  themeLabel,
} from './motifs';
import { buildProfile } from './profile';
import type { CoachAttempt } from './slim';

let seq = 0;
/** `n` attempts at a theme, the first `failed` of them unsolved. Later calls are later in time. */
function tries(theme: string, n: number, failed = 0, source = 'lichess'): CoachAttempt[] {
  return Array.from({ length: n }, (_, i) => ({ puzzleId: `p${seq}`, theme, source, solved: i >= failed, at: T0 + seq++ * 1000 }));
}

describe('puzzle themes', () => {
  it('match the bundled puzzle index', () => {
    const index = JSON.parse(readFileSync('public/puzzles/index.json', 'utf8')) as Record<string, number>;
    expect([...PUZZLE_THEMES].sort()).toEqual(Object.keys(index).sort());
  });

  it('all have a display name', () => {
    for (const t of PUZZLE_THEMES) expect(copy.puzzles.themeNames[t]).toBeTruthy();
    expect(themeLabel('fork')).toBe('Forks');
    expect(themeLabel('mixed')).toBe(copy.puzzles.mixed);
    expect(themeLabel('hung-piece')).toBe('Hung a piece');
  });

  it('are mapped from every kind of mistake the review names', () => {
    expect(Object.keys(KIND_THEMES).sort()).toEqual(Object.keys(copy.kinds).sort());
    for (const themes of Object.values(KIND_THEMES)) {
      expect(themes.length).toBeGreaterThan(0);
      for (const t of themes) expect(PUZZLE_THEMES).toContain(t);
    }
    expect(Object.keys(copy.coach.motifs.kind).sort()).toEqual(Object.keys(KIND_THEMES).sort());
  });

  it('link with the theme in the query string', () => {
    expect(puzzlesUrl('fork')).toBe('/puzzles?theme=fork');
    expect(puzzlesUrl('mixed')).toBe('/puzzles?theme=mixed');
  });
});

describe('buildMotifs: performance per theme', () => {
  it('lists every theme, practised or not', () => {
    const m = buildMotifs([]);
    expect(m.themes.map((t) => t.theme)).toEqual([...PUZZLE_THEMES]);
    expect(m.themes[0]).toEqual({ theme: 'hangingPiece', label: 'Free pieces', attempts: 0, solved: 0, solvedPct: null, recentAttempts: 0, recentPct: null, lastAt: 0 });
    expect(m.mine).toEqual([]);
    expect(m.overall).toEqual({ attempts: 0, solved: 0, solvedPct: null, recentPct: null });
    expect(m.weakest).toBeNull();
  });

  it('counts attempts, solve rate and the last twenty', () => {
    const attempts = [
      ...tries('fork', 30, 10), // ten early failures, then twenty solved
      ...tries('pin', 4, 2),
      ...tries('hung-piece', 3, 2, 'mine'),
      ...tries('someNewTheme', 1),
    ];
    const m = buildMotifs(attempts);
    const fork = m.themes.find((t) => t.theme === 'fork')!;
    expect(fork).toMatchObject({ attempts: 30, solved: 20, solvedPct: 67, recentAttempts: RECENT_ATTEMPTS, recentPct: 100 });
    expect(fork.lastAt).toBe(attempts[29].at);
    expect(m.themes.find((t) => t.theme === 'pin')).toMatchObject({ attempts: 4, solved: 2, solvedPct: 50, recentAttempts: 4, recentPct: 50 });
    // Own-mistake puzzles are kept apart, by the kind of mistake.
    expect(m.mine).toEqual([expect.objectContaining({ theme: 'hung-piece', label: 'Hung a piece', attempts: 3, solved: 1, solvedPct: 33 })]);
    // An unknown theme still counts towards the overall rate.
    expect(m.overall).toEqual({ attempts: 38, solved: 24, solvedPct: 63, recentPct: 80 });
  });

  it('does not depend on the order the attempts arrive in', () => {
    const attempts = [...tries('fork', 25, 5), ...tries('pin', 12, 6)];
    expect(buildMotifs([...attempts].reverse())).toEqual(buildMotifs(attempts));
  });

  it('finds the weakest theme among those with enough attempts', () => {
    const m = buildMotifs([...tries('skewer', MIN_THEME_ATTEMPTS - 1, 9), ...tries('fork', 12, 9), ...tries('pin', 12, 3)]);
    expect(m.weakest?.theme).toBe('fork'); // the skewers are worse, but nine tries is one bad sitting
    expect(m.weakest?.recentPct).toBe(25);
  });
});

describe('buildMotifs: recommended theme', () => {
  it('is a mix when there is nothing to go on', () => {
    expect(buildMotifs([]).recommended).toEqual({
      theme: 'mixed',
      label: copy.puzzles.mixed,
      source: 'default',
      reason: copy.coach.motifs.fallback,
      to: '/puzzles?theme=mixed',
    });
    expect(buildMotifs([], buildProfile({ games: [] })).recommended.theme).toBe('mixed');
  });

  it('falls back to the weakest practised theme', () => {
    const r = buildMotifs([...tries('fork', 12, 9), ...tries('pin', 12, 3)]).recommended;
    expect(r).toEqual({
      theme: 'fork',
      label: 'Forks',
      source: 'puzzles',
      reason: 'Forks is your weakest theme: 25% solved over your last 12 tries.',
      to: '/puzzles?theme=fork',
    });
  });

  it('goes back to a mix when every practised theme is already easy', () => {
    expect(buildMotifs([...tries('fork', 20, 1), ...tries('pin', 20, 2)]).recommended.theme).toBe('mixed');
  });

  it('follows the worst error signal in your games', () => {
    const profile = buildProfile({ games: analysed(8, () => ({ kinds: ['missed-mate'] })) });
    const r = buildMotifs(tries('fork', 12, 9), profile).recommended;
    expect(r).toEqual({
      theme: 'mateIn1',
      label: 'Mate in 1',
      source: 'games',
      kind: 'missed-mate',
      reason: 'You missed a mate 8 times in your last 8 analysed games. The puzzles follow that.',
      to: '/puzzles?theme=mateIn1',
    });
  });

  it('prefers the more damaging signal to the commonest kind', () => {
    // Missed tactics are commoner, but a hung piece every game is further past its line.
    const profile = buildProfile({ games: analysed(10, () => ({ kinds: ['hung-piece', 'missed-tactic', 'missed-tactic'] })) });
    expect(profile.kinds[0].kind).toBe('missed-tactic');
    expect(profile.top[0].id).toBe('hung');
    expect(buildMotifs([], profile).recommended).toMatchObject({ theme: 'hangingPiece', kind: 'hung-piece', source: 'games' });
  });

  it('uses the commonest kind when nothing is weak, if it happened often enough', () => {
    const some = buildProfile({ games: analysed(8, (i) => ({ kinds: i < MIN_KIND_EVENTS ? ['fork'] : [] })) });
    expect(some.top).toEqual([]);
    expect(buildMotifs([], some).recommended).toMatchObject({ theme: 'fork', kind: 'fork', source: 'games' });

    const rare = buildProfile({ games: analysed(8, (i) => ({ kinds: i < MIN_KIND_EVENTS - 1 ? ['fork'] : [] })) });
    expect(buildMotifs([], rare).recommended.source).toBe('default');
  });

  it('moves on to the next theme once the first is mastered', () => {
    const profile = buildProfile({ games: analysed(8, () => ({ kinds: ['missed-mate'] })) });
    const mastered = tries('mateIn1', MASTERED.attempts, 2); // 90% over a full window
    expect(buildMotifs(mastered, profile).recommended.theme).toBe('mateIn2');
    // 19 attempts is not a full window yet.
    expect(buildMotifs(tries('mateIn1', MASTERED.attempts - 1), profile).recommended.theme).toBe('mateIn1');
    // Everything mastered: back to the first.
    const all = KIND_THEMES['missed-mate'].flatMap((t) => tries(t, MASTERED.attempts));
    expect(buildMotifs(all, profile).recommended.theme).toBe('mateIn1');
  });
});

describe('themeForKind', () => {
  it('takes the first theme without puzzle history', () => {
    expect(themeForKind('hung-piece')).toBe('hangingPiece');
    expect(themeForKind('walked-into-tactic')).toBe('defensiveMove');
    expect(themeForKind('allowed-mate')).toBe('backRankMate');
  });
});
