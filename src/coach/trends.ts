// Are your real games getting better? A per-game series, a rolling mean,
// "your last ten against the ten before", and results split three ways.
import { copy } from '../copy';
import { PROFILE_WINDOW } from './profile';
import { newestFirst, type CoachGame } from './slim';

const c = copy.coach.trends;

/** The rolling mean covers this game and up to nine before it: enough to smooth one bad game, short enough to still move. */
export const ROLLING_WINDOW = 10;

/** "Last 10 against the 10 before." With fewer games the two halves shrink together, down to MIN_DELTA_WINDOW. */
export const DELTA_WINDOW = 10;

/** Under five games a side, one result is a fifth of the average, so no trend is reported. */
export const MIN_DELTA_WINDOW = 5;

/** The series keeps your most recent analysed games only: a chart of more is unreadable, and the hook result stays small. */
export const SERIES_CAP = 100;

/**
 * Changes smaller than these are called steady, not a trend. Over ten games
 * the averages wobble by about this much on their own: 2 accuracy points,
 * 0.3 blunders or mistakes a game, and 15 score points (one and a half
 * results out of ten).
 */
export const FLAT = { accuracy: 2, blunders: 0.3, mistakes: 0.3, score: 15 } as const;

export type TrendMetric = 'accuracy' | 'blunders' | 'mistakes' | 'score';

export interface TrendPoint {
  gameId: string;
  /** End time, ms. */
  at: number;
  result: 'win' | 'loss' | 'draw';
  color: 'white' | 'black';
  accuracy: number;
  blunders: number;
  mistakes: number;
  /** Rolling means over this game and up to ROLLING_WINDOW - 1 before it. */
  accuracyAvg: number;
  blundersAvg: number;
  mistakesAvg: number;
}

export interface TrendDelta {
  metric: TrendMetric;
  label: string;
  /** Mean over the recent window. Accuracy and score are 0-100; blunders and mistakes are per game. */
  recent: number;
  previous: number;
  /** recent - previous */
  delta: number;
  /** Whether the change is good for you, not which way the number moved. */
  trend: 'better' | 'worse' | 'flat';
  trendLabel: string;
}

export interface BreakdownRow {
  key: string;
  label: string;
  /** Opening rows only: the colour you had. */
  side?: 'white' | 'black';
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** 0-100 */
  score: number;
  /** How many of the games have a current analysis; the next two fields average over those. */
  analysed: number;
  accuracy: number | null;
  /** Blunders per analysed game. */
  blunders: number | null;
}

export interface TrendSummary {
  games: number;
  accuracy: number;
  blunders: number;
  mistakes: number;
  /** 0-100 */
  score: number;
}

export interface Trends {
  /** Analysed games, oldest first, at most SERIES_CAP. */
  series: TrendPoint[];
  /** Averages over the same window the profile reads; null with no analysed games. */
  summary: TrendSummary | null;
  /** Recent window against the one before; null until there are enough analysed games. */
  deltas: { window: number; items: TrendDelta[] } | null;
  /** What the deltas compare, or how many games are still needed. */
  deltasText: string;
  /** Most played first. Games without a named opening are left out. */
  byOpening: BreakdownRow[];
  byColour: BreakdownRow[];
  byTimeClass: BreakdownRow[];
  totals: { games: number; analysed: number; score: number };
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const pts = (g: CoachGame) => (g.result === 'win' ? 1 : g.result === 'draw' ? 0.5 : 0);

interface Tally {
  key: string;
  label: string;
  side?: 'white' | 'black';
  games: number;
  wins: number;
  draws: number;
  losses: number;
  analysed: number;
  acc: number;
  blunders: number;
}

function tally(map: Map<string, Tally>, key: string, label: string, g: CoachGame, side?: 'white' | 'black') {
  let t = map.get(key);
  if (!t) map.set(key, (t = { key, label, side, games: 0, wins: 0, draws: 0, losses: 0, analysed: 0, acc: 0, blunders: 0 }));
  t.games++;
  if (g.result === 'win') t.wins++;
  else if (g.result === 'draw') t.draws++;
  else t.losses++;
  if (g.a) {
    t.analysed++;
    t.acc += g.a.accuracy;
    t.blunders += g.a.blunders;
  }
}

const rows = (map: Map<string, Tally>): BreakdownRow[] =>
  [...map.values()]
    .map(({ acc, blunders, ...t }) => ({
      ...t,
      score: Math.round(((t.wins + t.draws / 2) / t.games) * 100),
      accuracy: t.analysed ? Math.round(acc / t.analysed) : null,
      blunders: t.analysed ? round1(blunders / t.analysed) : null,
    }))
    .sort((a, b) => b.games - a.games);

function mean(xs: readonly CoachGame[], f: (g: CoachGame) => number): number {
  return xs.reduce((s, g) => s + f(g), 0) / xs.length;
}

function delta(metric: TrendMetric, recent: number, previous: number): TrendDelta {
  const d = recent - previous;
  const higherIsBetter = metric === 'accuracy' || metric === 'score';
  const trend = Math.abs(d) < FLAT[metric] ? 'flat' : d > 0 === higherIsBetter ? 'better' : 'worse';
  const r = metric === 'accuracy' || metric === 'score' ? Math.round : round1;
  return { metric, label: c.metrics[metric], recent: r(recent), previous: r(previous), delta: r(d), trend, trendLabel: c.trend[trend] };
}

export function buildTrends(input: readonly CoachGame[]): Trends {
  const games = newestFirst(input);
  const byOpening = new Map<string, Tally>();
  const byColour = new Map<string, Tally>();
  const byTime = new Map<string, Tally>();
  const analysed: CoachGame[] = []; // newest first
  let points = 0;

  for (const g of games) {
    points += pts(g);
    if (g.a) analysed.push(g);
    if (g.family) tally(byOpening, `${g.color}|${g.family}`, g.family, g, g.color);
    tally(byColour, g.color, c.colours[g.color], g);
    const speed = c.timeClasses[g.timeClass];
    tally(byTime, speed ? g.timeClass : 'other', speed ?? c.otherTime, g);
  }

  // Series, oldest first, with a rolling mean kept as running sums.
  const series: TrendPoint[] = [];
  const sum = { acc: 0, blunders: 0, mistakes: 0 };
  for (let i = analysed.length - 1, k = 0; i >= 0; i--, k++) {
    const g = analysed[i];
    const a = g.a!;
    sum.acc += a.accuracy;
    sum.blunders += a.blunders;
    sum.mistakes += a.mistakes;
    if (k >= ROLLING_WINDOW) {
      const out = analysed[i + ROLLING_WINDOW].a!;
      sum.acc -= out.accuracy;
      sum.blunders -= out.blunders;
      sum.mistakes -= out.mistakes;
    }
    const size = Math.min(k + 1, ROLLING_WINDOW);
    if (i < SERIES_CAP) {
      series.push({
        gameId: g.id,
        at: g.at,
        result: g.result,
        color: g.color,
        accuracy: a.accuracy,
        blunders: a.blunders,
        mistakes: a.mistakes,
        accuracyAvg: round1(sum.acc / size),
        blundersAvg: round1(sum.blunders / size),
        mistakesAvg: round1(sum.mistakes / size),
      });
    }
  }

  const span = Math.min(DELTA_WINDOW, Math.floor(analysed.length / 2));
  let deltas: Trends['deltas'] = null;
  if (span >= MIN_DELTA_WINDOW) {
    const recent = analysed.slice(0, span);
    const previous = analysed.slice(span, span * 2);
    deltas = {
      window: span,
      items: [
        delta('accuracy', mean(recent, (g) => g.a!.accuracy), mean(previous, (g) => g.a!.accuracy)),
        delta('blunders', mean(recent, (g) => g.a!.blunders), mean(previous, (g) => g.a!.blunders)),
        delta('mistakes', mean(recent, (g) => g.a!.mistakes), mean(previous, (g) => g.a!.mistakes)),
        delta('score', mean(recent, pts) * 100, mean(previous, pts) * 100),
      ],
    };
  }

  const recentGames = analysed.slice(0, PROFILE_WINDOW);
  const summary: TrendSummary | null = recentGames.length
    ? {
        games: recentGames.length,
        accuracy: Math.round(mean(recentGames, (g) => g.a!.accuracy)),
        blunders: round1(mean(recentGames, (g) => g.a!.blunders)),
        mistakes: round1(mean(recentGames, (g) => g.a!.mistakes)),
        score: Math.round(mean(recentGames, pts) * 100),
      }
    : null;

  return {
    series,
    summary,
    deltas,
    deltasText: deltas ? c.delta(span) : c.deltaNeed(analysed.length, MIN_DELTA_WINDOW * 2),
    byOpening: rows(byOpening),
    byColour: rows(byColour).sort((a, b) => (a.key === 'white' ? -1 : b.key === 'white' ? 1 : 0)),
    byTimeClass: rows(byTime),
    totals: { games: games.length, analysed: analysed.length, score: games.length ? Math.round((points / games.length) * 100) : 0 },
  };
}
