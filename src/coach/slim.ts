// Slim projections of stored rows. The coach never holds a PGN, an eval list
// or an engine line: every row is reduced, once, to the few numbers the rules
// read. A year of blitz is thousands of games, so this is what keeps it fast.
import { winPct } from '../engine/engine';
import { ANALYSIS_VERSION } from '../games/analyze';
import { lowTime } from '../games/clock';
import type { AttemptRow, BlunderKind, BookStatus, GameAnalysis, GameRow } from '../srs/types';

export type Phase = 'opening' | 'middlegame' | 'endgame';
export const PHASES: readonly Phase[] = ['opening', 'middlegame', 'endgame'];

/**
 * A position counts as clearly winning from this win% up. Same bar as the
 * 'missed-win' class in games/analyze.ts, so the two never disagree.
 * 80% is roughly +3.8 pawns.
 */
export const CLEARLY_WINNING_PCT = 80;

/** A mistake played faster than this with time on the clock was rushed (same 3s as analyze.ts). */
const HASTY_SECONDS = 3;

/** One of your mistakes or blunders. `ply` is the 0-based index of the move, which is also the position before it. */
export interface CoachError {
  ply: number;
  kind: BlunderKind;
  /** It threw away a clearly winning position. */
  missedWin: boolean;
  /** Played in time trouble, or in a rush with time left. Only when the game has clocks. */
  clock?: 'low' | 'hasty';
}

export interface CoachAnalysis {
  /** When the analysis ran, ms. */
  at: number;
  accuracy: number;
  blunders: number;
  mistakes: number;
  errors: CoachError[];
  phases?: Record<Phase, { accuracy: number; moves: number }>;
  clock?: { low: number; hasty: number; endedLow: boolean };
  /** How many of your turns started from a clearly winning position. */
  winningTurns: number;
  /** The last position (ply index) where you were clearly winning with the move; -1 if never. */
  lastWinningPly: number;
}

export interface CoachGame {
  id: string;
  /** End time, ms. */
  at: number;
  color: 'white' | 'black';
  result: 'win' | 'loss' | 'draw';
  timeClass: string;
  /** Opponent's name, for the plan's reason sentences. */
  opp: string;
  /** Opening family: the ECO name up to the colon. */
  family?: string;
  book?: { status: BookStatus; ply: number; lineId?: string };
  /** current = analysed by this version; stale = an older analysis; none = never analysed. */
  review: 'current' | 'stale' | 'none';
  /**
   * The PGN cannot be replayed, or you made fewer than two moves: there is
   * nothing to analyse. With `review`, this mirrors needsAnalysis() in
   * games/store.ts: a game is waiting for Stockfish when it is reviewable
   * and its review is not 'current'.
   */
  unreviewable: boolean;
  /** Only for current analyses, so stale numbers never mix in. */
  a?: CoachAnalysis;
}

export interface CoachAttempt {
  puzzleId: string;
  theme: string;
  source: string;
  solved: boolean;
  /** ms */
  at: number;
}

/** A line in the drill queue. Times are ms. */
export interface CoachCard {
  lineId: string;
  repId: string;
  due: number;
  addedAt: number;
  /** 0 when never drilled. */
  lastReview: number;
  /** In long-term review (FSRS state Review), as opposed to still being learned. */
  mature: boolean;
}

/** The parts of a repertoire the coach reads. A full Repertoire fits. */
export interface PlanRepertoire {
  id: string;
  title: string;
  side: 'white' | 'black';
  lines: { id: string; label?: string; chapterTitle?: string }[];
}

/** A repertoire line as the coach names and links it. */
export interface CoachLine {
  id: string;
  repId: string;
  repTitle: string;
  /** e.g. "The Italian, Giuoco Pianissimo" */
  name: string;
  /** Position in the repertoire's line list: /learn/<repId>/<index>. */
  index: number;
}

const toMs = (d: unknown): number => {
  const t = d instanceof Date ? d.getTime() : typeof d === 'number' ? d : typeof d === 'string' ? Date.parse(d) : NaN;
  return Number.isFinite(t) ? t : 0;
};

const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0);

/** "Caro-Kann Defense: Advance Variation" -> "Caro-Kann Defense". Same rule as openingFamilies(). */
export const familyOf = (name: string): string => name.split(':')[0].trim();

/** Your moves played before `ply` (a 0-based ply index). */
export function ownMovesBefore(ply: number, color: 'white' | 'black'): number {
  return color === 'white' ? Math.ceil(ply / 2) : Math.floor(ply / 2);
}

function slimAnalysis(an: GameAnalysis, color: 'white' | 'black'): CoachAnalysis {
  const moves = Array.isArray(an.moves) ? an.moves : [];
  const evals = Array.isArray(an.evals) ? an.evals : [];
  const low = an.time ? lowTime({ base: an.time.base, inc: an.time.inc }) : 0;

  // `kind` is only ever set on your own moves, so the first one also tells us
  // which plies are yours. That matters for games started from a position
  // where Black moves first.
  let parity = color === 'white' ? 0 : 1;
  let parityKnown = false;
  const errors: CoachError[] = [];
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    if (!m?.kind) continue;
    if (!parityKnown) {
      parity = i % 2;
      parityKnown = true;
    }
    const e: CoachError = { ply: i, kind: m.kind, missedWin: m.cls === 'missed-win' };
    if (an.time && typeof m.left === 'number' && typeof m.spent === 'number') {
      if (m.left < low) e.clock = 'low';
      else if (m.spent < HASTY_SECONDS) e.clock = 'hasty';
    }
    errors.push(e);
  }

  const sign = color === 'white' ? 1 : -1;
  let winningTurns = 0;
  let lastWinningPly = -1;
  for (let i = parity; i < evals.length; i += 2) {
    if (winPct(sign * num(evals[i])) >= CLEARLY_WINNING_PCT) {
      winningTurns++;
      lastWinningPly = i;
    }
  }

  const out: CoachAnalysis = {
    at: toMs(an.analyzedAt),
    accuracy: num(an.accuracy),
    blunders: num(an.blunders),
    mistakes: num(an.mistakes),
    errors,
    winningTurns,
    lastWinningPly,
  };
  if (an.phases) {
    out.phases = {
      opening: { accuracy: num(an.phases.opening?.accuracy), moves: num(an.phases.opening?.moves) },
      middlegame: { accuracy: num(an.phases.middlegame?.accuracy), moves: num(an.phases.middlegame?.moves) },
      endgame: { accuracy: num(an.phases.endgame?.accuracy), moves: num(an.phases.endgame?.moves) },
    };
  }
  if (an.time) {
    out.clock = { low: num(an.time.lowTimeErrors), hasty: num(an.time.hastyErrors), endedLow: !!an.time.endedLow };
  }
  return out;
}

/** Reduces a stored game to what the coach reads. Never keeps the PGN, evals or engine lines. */
export function slimGame(g: GameRow): CoachGame {
  const an = g.analysis;
  const current = !!an && (an.version ?? 1) >= ANALYSIS_VERSION;
  const named = g.opening ?? an?.opening;
  const out: CoachGame = {
    id: g.id,
    at: toMs(g.endTime),
    color: g.userColor === 'black' ? 'black' : 'white',
    result: g.result === 'win' || g.result === 'draw' ? g.result : 'loss',
    timeClass: g.timeClass || 'unknown',
    opp: (g.userColor === 'black' ? g.white : g.black) ?? '',
    review: current ? 'current' : an ? 'stale' : 'none',
    unreviewable: !!g.unreadable || !!g.unanalysable,
  };
  if (named?.name) out.family = familyOf(named.name);
  if (g.book) out.book = { status: g.book.status, ply: num(g.book.ply), lineId: g.book.lineId };
  if (current) out.a = slimAnalysis(an, out.color);
  return out;
}

export function slimAttempt(a: AttemptRow): CoachAttempt {
  return { puzzleId: a.puzzleId, theme: a.theme, source: a.source, solved: !!a.solved, at: toMs(a.at) };
}

/** Looks up every line of the given repertoires by id. */
export function indexLines(reps: readonly PlanRepertoire[]): Map<string, CoachLine> {
  const map = new Map<string, CoachLine>();
  for (const r of reps) {
    r.lines.forEach((l, index) => {
      const where = [l.chapterTitle, l.label && l.label !== 'Main line' ? l.label : ''].filter(Boolean).join(', ');
      map.set(l.id, { id: l.id, repId: r.id, repTitle: r.title, name: where ? `${r.title}, ${where}` : r.title, index });
    });
  }
  return map;
}

/** Newest first. Returns the same array when it is already in order. */
export function newestFirst(games: readonly CoachGame[]): readonly CoachGame[] {
  for (let i = 1; i < games.length; i++) {
    if (games[i].at > games[i - 1].at) return [...games].sort((a, b) => b.at - a.at);
  }
  return games;
}

/** Midnight at the start of `now`'s local day, ms. */
export function startOfDay(now: Date): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
