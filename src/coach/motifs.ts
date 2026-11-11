// Puzzle performance per theme, and which theme to practise next.
import { copy } from '../copy';
import type { BlunderKind } from '../srs/types';
import type { Profile } from './profile';
import type { CoachAttempt } from './slim';

const c = copy.coach;

/** The theme ids shipped in public/puzzles/index.json (a test keeps the two in step). */
export const PUZZLE_THEMES = [
  'hangingPiece',
  'fork',
  'pin',
  'skewer',
  'discoveredAttack',
  'mateIn1',
  'mateIn2',
  'backRankMate',
  'trappedPiece',
  'defensiveMove',
] as const;
export type PuzzleTheme = (typeof PUZZLE_THEMES)[number];
export type ThemeId = PuzzleTheme | 'mixed';

/**
 * Which puzzle themes train each kind of mistake the game review names.
 * The first theme is the closest match; the later ones are where to go once
 * the first is mastered (see MASTERED).
 *
 * - hung-piece: you left something en prise. "Free pieces" trains the same
 *   board scan from the other side; defensive moves and trapped pieces are
 *   the follow-ups.
 * - allowed-mate: you did not see their mate coming. The back rank is how
 *   that usually happens at club level; then defensive moves, then mate in 1
 *   so the patterns are familiar from both sides.
 * - missed-mate: you had a mate and played something else. Mate in 1, then
 *   mate in 2, then back-rank mates.
 * - fork: you walked into one. Forks, then defensive moves.
 * - missed-tactic: the catch-all for a winning shot you did not play. Forks,
 *   pins, discovered attacks, skewers and trapped pieces cover most of them.
 * - walked-into-tactic: the catch-all for a shot you allowed. Defensive
 *   moves first, then the patterns you keep allowing.
 */
export const KIND_THEMES: Record<BlunderKind, readonly PuzzleTheme[]> = {
  'hung-piece': ['hangingPiece', 'defensiveMove', 'trappedPiece'],
  'allowed-mate': ['backRankMate', 'defensiveMove', 'mateIn1'],
  'missed-mate': ['mateIn1', 'mateIn2', 'backRankMate'],
  fork: ['fork', 'defensiveMove'],
  'missed-tactic': ['fork', 'pin', 'discoveredAttack', 'skewer', 'trappedPiece'],
  'walked-into-tactic': ['defensiveMove', 'pin', 'skewer', 'discoveredAttack'],
};

/** "Recent" for a theme means your last this-many attempts at it. */
export const RECENT_ATTEMPTS = 20;

/**
 * A theme is mastered once a full window of recent attempts is at or above
 * this rate. The trainer serves puzzles near your rating, where about half
 * are expected to be solved, so 85% over 20 means the theme is now easy and
 * the practice time is better spent on the next one.
 */
export const MASTERED = { attempts: RECENT_ATTEMPTS, pct: 85 } as const;

/** A theme needs this many attempts before its solve rate can call it your weakest. Fewer is one unlucky sitting. */
export const MIN_THEME_ATTEMPTS = 10;

/** A mistake kind has to show up this often in the profile window before it steers the puzzles. */
export const MIN_KIND_EVENTS = 3;

export interface ThemeStat {
  /** A puzzle theme id, or a blunder kind for your own-mistake puzzles. */
  theme: string;
  label: string;
  attempts: number;
  solved: number;
  /** 0-100; null with no attempts. */
  solvedPct: number | null;
  /** How many of the last RECENT_ATTEMPTS exist. */
  recentAttempts: number;
  /** Solve rate over the last RECENT_ATTEMPTS, 0-100; null with no attempts. */
  recentPct: number | null;
  /** Last attempt, ms; 0 if never. */
  lastAt: number;
}

export interface MotifRecommendation {
  theme: ThemeId;
  label: string;
  /** games = from your blunder kinds; puzzles = your weakest practised theme; default = nothing to go on. */
  source: 'games' | 'puzzles' | 'default';
  /** The blunder kind behind it, when source is 'games'. */
  kind?: BlunderKind;
  /** One sentence on why, from your own numbers. */
  reason: string;
  /** In-app link: /puzzles?theme=<id>. */
  to: string;
}

export interface Motifs {
  /** Every bundled theme in index order, practised or not. */
  themes: ThemeStat[];
  /** Your own-mistake puzzles, by the kind of mistake. Only kinds you have attempted. */
  mine: ThemeStat[];
  overall: { attempts: number; solved: number; solvedPct: number | null; recentPct: number | null };
  /** Lowest recent solve rate among themes with enough attempts. */
  weakest: ThemeStat | null;
  recommended: MotifRecommendation;
}

export const puzzlesUrl = (theme: string): string => `/puzzles?theme=${encodeURIComponent(theme)}`;

export function themeLabel(theme: string): string {
  if (theme === 'mixed') return copy.puzzles.mixed;
  return copy.puzzles.themeNames[theme] ?? copy.kinds[theme]?.label ?? theme;
}

const isTheme = (t: string): t is PuzzleTheme => (PUZZLE_THEMES as readonly string[]).includes(t);
const pct = (n: number, of: number): number | null => (of ? Math.round((n / of) * 100) : null);

interface Tally {
  attempts: number;
  solved: number;
  recent: boolean[];
  lastAt: number;
}

function stat(theme: string, t: Tally | undefined): ThemeStat {
  const recent = t?.recent ?? [];
  return {
    theme,
    label: themeLabel(theme),
    attempts: t?.attempts ?? 0,
    solved: t?.solved ?? 0,
    solvedPct: pct(t?.solved ?? 0, t?.attempts ?? 0),
    recentAttempts: recent.length,
    recentPct: pct(recent.filter(Boolean).length, recent.length),
    lastAt: t?.lastAt ?? 0,
  };
}

const isMastered = (s: ThemeStat | undefined): boolean =>
  !!s && s.recentAttempts >= MASTERED.attempts && (s.recentPct ?? 0) >= MASTERED.pct;

/** The first theme for this kind that you have not mastered yet; the first one if you have mastered them all. */
export function themeForKind(kind: BlunderKind, themes?: readonly ThemeStat[]): PuzzleTheme {
  const candidates = KIND_THEMES[kind] ?? KIND_THEMES['missed-tactic'];
  const byId = new Map(themes?.map((t) => [t.theme, t]));
  return candidates.find((t) => !isMastered(byId.get(t))) ?? candidates[0];
}

/** The kind of mistake your games say to work on: the main kind of your worst error signal, else the commonest kind. */
function kindFromProfile(profile: Profile | null | undefined): { kind: BlunderKind; count: number } | null {
  if (!profile) return null;
  const count = (k: BlunderKind) => profile.kinds.find((x) => x.kind === k)?.count ?? 0;
  for (const s of profile.top) {
    if (s.id !== 'hung' && s.id !== 'tactics' && s.id !== 'mates') continue;
    const kind = s.subject as BlunderKind | undefined;
    if (kind && KIND_THEMES[kind] && count(kind) > 0) return { kind, count: count(kind) };
  }
  const top = profile.kinds[0];
  return top && top.count >= MIN_KIND_EVENTS ? { kind: top.kind, count: top.count } : null;
}

/**
 * Puzzle performance per theme, and the theme to practise next: the one your
 * games point at, else your weakest practised theme, else a mix.
 */
export function buildMotifs(attempts: readonly CoachAttempt[], profile?: Profile | null): Motifs {
  const ordered = [...attempts].sort((a, b) => a.at - b.at);
  const lichess = new Map<string, Tally>();
  const mine = new Map<string, Tally>();
  const all: Tally = { attempts: 0, solved: 0, recent: [], lastAt: 0 };

  const add = (t: Tally, a: CoachAttempt) => {
    t.attempts++;
    if (a.solved) t.solved++;
    t.recent.push(a.solved);
    if (t.recent.length > RECENT_ATTEMPTS) t.recent.shift();
    t.lastAt = a.at;
  };
  for (const a of ordered) {
    add(all, a);
    const bucket = a.source === 'mine' ? mine : isTheme(a.theme) ? lichess : null;
    if (!bucket) continue;
    let t = bucket.get(a.theme);
    if (!t) bucket.set(a.theme, (t = { attempts: 0, solved: 0, recent: [], lastAt: 0 }));
    add(t, a);
  }

  const themes = PUZZLE_THEMES.map((id) => stat(id, lichess.get(id)));
  const mineStats = [...mine.entries()].map(([k, t]) => stat(k, t)).sort((a, b) => b.attempts - a.attempts);

  const weakest =
    themes
      .filter((t) => t.attempts >= MIN_THEME_ATTEMPTS)
      .sort((a, b) => (a.recentPct ?? 0) - (b.recentPct ?? 0) || b.attempts - a.attempts)[0] ?? null;

  let recommended: MotifRecommendation;
  const fromGames = kindFromProfile(profile);
  if (fromGames && profile) {
    const theme = themeForKind(fromGames.kind, themes);
    const what = (c.motifs.kind[fromGames.kind] ?? c.motifs.kind['missed-tactic'])(c.times(fromGames.count));
    recommended = {
      theme,
      label: themeLabel(theme),
      source: 'games',
      kind: fromGames.kind,
      reason: c.motifs.fromGames(what, profile.sample.window),
      to: puzzlesUrl(theme),
    };
  } else if (weakest && (weakest.recentPct ?? 100) < MASTERED.pct) {
    recommended = {
      theme: weakest.theme as PuzzleTheme,
      label: weakest.label,
      source: 'puzzles',
      reason: c.motifs.fromPuzzles(weakest.label, weakest.recentPct ?? 0, weakest.recentAttempts),
      to: puzzlesUrl(weakest.theme),
    };
  } else {
    recommended = { theme: 'mixed', label: themeLabel('mixed'), source: 'default', reason: c.motifs.fallback, to: puzzlesUrl('mixed') };
  }

  return {
    themes,
    mine: mineStats,
    overall: {
      attempts: all.attempts,
      solved: all.solved,
      solvedPct: pct(all.solved, all.attempts),
      recentPct: pct(all.recent.filter(Boolean).length, all.recent.length),
    },
    weakest,
    recommended,
  };
}
