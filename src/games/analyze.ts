import { Chess, type Square } from 'chess.js';
import { PIECE_VALUE, fenKey, playUci, type GamePly } from '../chess/game';
import { getEngine, moveAccuracy, scoreToCp, winPct, type Score } from '../engine/engine';
import type { BlunderKind, GameAnalysis, KeyMoment, MoveClass, MoveReview, PhaseStats } from '../srs/types';
import { repertoires } from '../repertoire';
import type { OpeningBook } from './openings';
import { nameOpening } from './openings';
import { lowTime, type PlyClock, type TimeControl } from './clock';

const stdDev = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};

/**
 * Lichess's game accuracy: move accuracies weighted by how volatile the
 * position was around them, averaged with their harmonic mean so one big
 * blunder isn't drowned out by forty easy recaptures.
 * `wins` is White's win% for every position (moves + 1 entries).
 */
export function gameAccuracy(wins: number[], color: 'w' | 'b'): number | undefined {
  const n = wins.length - 1;
  if (n < 1) return undefined;
  const size = Math.max(2, Math.min(8, Math.floor(n / 10)));
  const windows: number[][] = [];
  for (let i = 0; i < size - 2; i++) windows.push(wins.slice(0, size));
  for (let i = 0; i + size <= wins.length; i++) windows.push(wins.slice(i, i + size));
  const accs: { acc: number; w: number }[] = [];
  for (let i = 0; i < n; i++) {
    if ((i % 2 === 0) !== (color === 'w')) continue;
    const before = color === 'w' ? wins[i] : 100 - wins[i];
    const after = color === 'w' ? wins[i + 1] : 100 - wins[i + 1];
    const w = Math.max(0.5, Math.min(12, stdDev(windows[i] ?? windows[windows.length - 1])));
    accs.push({ acc: moveAccuracy(before - after), w });
  }
  if (!accs.length) return undefined;
  const weighted = accs.reduce((a, x) => a + x.acc * x.w, 0) / accs.reduce((a, x) => a + x.w, 0);
  const harmonic = accs.length / accs.reduce((a, x) => a + 1 / Math.max(1, x.acc), 0);
  return Math.round((weighted + harmonic) / 2);
}

export const ANALYSIS_DEPTH = 12;
/**
 * Every position gets a fast search; the positions around a suspected error are then
 * searched again this deep. A shallow search is what produces false blunders, so the
 * extra time goes only where a wrong verdict would mislead. (Depth 14 everywhere was
 * measured at four times the cost of 12 on a desktop.)
 */
export const VERIFY_DEPTH = 15;
/** A first-pass win-chance drop this large gets the deeper second look. */
export const VERIFY_DROP = 10;
/** At most this many positions per game are re-searched, largest drops first. */
export const VERIFY_MAX = 12;
export const ANALYSIS_VERSION = 3;
/** With fewer moves of yours than this there is nothing to review, and no honest accuracy to report. */
export const MIN_USER_PLIES = 2;

/** How many plies of a game the user played. */
export function userPlyCount(plies: { color: 'w' | 'b' }[], userColor: 'white' | 'black'): number {
  const mine = userColor === 'white' ? 'w' : 'b';
  return plies.reduce((n, p) => n + (p.color === mine ? 1 : 0), 0);
}

/** Thrown by analyzeGame for a game with fewer than MIN_USER_PLIES moves of yours. */
export class UnanalysableError extends Error {
  constructor() {
    super('too few moves to analyse');
    this.name = 'UnanalysableError';
  }
}

export interface PositionEval {
  score: Score;
  bestmove: string;
  pv: string[];
}

/**
 * Finished engine results by position and depth, kept in memory. Games in a
 * batch share their first dozen moves over and over, and a game that was
 * interrupted is analysed again from the start; both become free. Least
 * recently used entries are dropped past `max`.
 */
export class EvalCache {
  private map = new Map<string, PositionEval>();
  private readonly max: number;

  constructor(max = 4000) {
    this.max = max;
  }

  /** Move counters do not change what the engine finds; the fifty-move clock can, so it stays in the key. */
  private key(fen: string, depth: number) {
    // Anything after the sixth field is a qualifier added by the caller (e.g. "|not:e2e4") and stays in the key.
    const [board, extra = ''] = fen.split('|');
    return `${board.split(' ').slice(0, 5).join(' ')}|${extra}|${depth}`;
  }

  get(fen: string, depth: number): PositionEval | undefined {
    const k = this.key(fen, depth);
    const hit = this.map.get(k);
    if (hit) {
      this.map.delete(k);
      this.map.set(k, hit);
    }
    return hit;
  }

  set(fen: string, depth: number, value: PositionEval) {
    const k = this.key(fen, depth);
    this.map.delete(k);
    this.map.set(k, value);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }

  get size() {
    return this.map.size;
  }

  clear() {
    this.map.clear();
  }
}

/** Shared by every analysis in this tab. */
export const evalCache = new EvalCache();

export interface AnalyzeOptions {
  /** Checked between positions, and passed to the engine so the running search stops too. Rejects with an AbortError. */
  signal?: AbortSignal;
  /** Defaults to the shared cache; null searches every position afresh. */
  cache?: EvalCache | null;
}

/**
 * Great and brilliant moves. Both need to know how good the SECOND best move was,
 * which a normal search does not tell us, so each candidate (a played move that
 * matched the engine's choice, outside the book) gets one extra shallow search
 * with the best move excluded.
 */
export const MERIT_DEPTH = 10;
/** At most this many candidates per game, so the extra pass stays a small share of the work. */
export const MERIT_MAX = 16;
/** Great: every other move gives up at least this much win chance. */
export const GREAT_GAP = 20;
/** Brilliant: a sacrifice that is clearly the best move, by at least this much. */
export const BRILLIANT_GAP = 8;

/**
 * Does this move leave the moved piece to be taken for less than it is worth?
 * True when the piece (not a pawn) lands where a cheaper enemy piece attacks it, or
 * where it is attacked and undefended, and the move did not capture as much as it risks.
 */
export function isSacrifice(fenBefore: string, uci: string): boolean {
  const chess = new Chess(fenBefore);
  const m = playUci(chess, uci);
  if (!m || m.piece === 'p' || m.piece === 'k' || chess.isCheckmate()) return false;
  const enemy = m.color === 'w' ? 'b' : 'w';
  const attackers = chess.attackers(m.to as Square, enemy);
  if (!attackers.length) return false;
  const value = PIECE_VALUE[m.promotion ?? m.piece];
  const gained = m.captured ? PIECE_VALUE[m.captured] : 0;
  if (gained >= value) return false; // took something at least as big: a trade at worst
  const cheapest = Math.min(...attackers.map((sq) => PIECE_VALUE[chess.get(sq)?.type ?? 'k'] ?? 99));
  const defended = chess.attackers(m.to as Square, m.color).length > 0;
  return !defended || cheapest < value;
}

/**
 * A capture nobody needs an engine to find: it takes something worth at least as
 * much as the piece taking it, or something that is not defended. Being the only
 * good move does not make such a move great.
 */
export function isObviousCapture(fenBefore: string, uci: string): boolean {
  const chess = new Chess(fenBefore);
  const m = playUci(chess, uci);
  if (!m?.captured) return false;
  if (PIECE_VALUE[m.captured] >= PIECE_VALUE[m.piece]) return true;
  return !chess.attackers(m.to as Square, m.color === 'w' ? 'b' : 'w').length;
}

/** Past this win chance the game is already decided and no single move deserves a medal. */
export const MERIT_MAX_WIN = 90;

/** Share of the progress bar given to the first pass. */
const FIRST_PASS = 0.8;

function abortError(): Error {
  const e = new Error('analysis aborted');
  e.name = 'AbortError';
  return e;
}

export function classify(drop: number, isBest: boolean, winBefore = 50, winAfter = 50): MoveClass {
  if (isBest) return 'best';
  // Threw away a clearly winning position: worse than a plain mistake in practice.
  if (winBefore >= 80 && winAfter < 60) return 'missed-win';
  if (drop >= 30) return 'blunder';
  if (drop >= 20) return 'mistake';
  if (drop >= 10) return 'inaccuracy';
  return 'good';
}

/** Turns a side-to-move score into White's point of view. */
const whitePov = (s: Score, fen: string) => (fen.split(' ')[1] === 'w' ? scoreToCp(s) : -scoreToCp(s));

/** Does the piece that just moved to `sq` attack two or more valuable targets? */
export function isFork(chess: Chess, sq: string): boolean {
  const fen = chess.fen().split(' ');
  fen[1] = fen[1] === 'w' ? 'b' : 'w'; // look from the forker's side
  fen[3] = '-';
  let c: Chess;
  try {
    c = new Chess(fen.join(' '));
  } catch {
    return false;
  }
  const targets = new Set<string>();
  for (const m of c.moves({ square: sq as Square, verbose: true })) {
    // With the side flipped, a check shows up as a king capture; count it once below.
    if (m.captured && m.captured !== 'k' && PIECE_VALUE[m.captured] >= 3) targets.add(m.to);
  }
  if (chess.inCheck()) targets.add('king');
  return targets.size >= 2;
}

/**
 * Why a blunder was a blunder, from the engine's best line.
 * before/after are the positions around your move; reply is the engine's best answer.
 */
export function blunderKind(
  beforeScore: Score,
  afterScore: Score, // side to move = opponent
  fenAfter: string,
  reply: string,
  winAfter: number,
  yourMove?: { to: string; captured?: string },
): BlunderKind {
  if (afterScore.mate !== undefined && afterScore.mate > 0) return 'allowed-mate';
  if (beforeScore.mate !== undefined && beforeScore.mate > 0) return 'missed-mate';

  const chess = new Chess(fenAfter);
  const you = chess.turn() === 'w' ? 'b' : 'w';
  const m = reply ? playUci(chess, reply) : null;
  // A recapture after you took something at least as big is a trade, not a hung piece.
  const trade =
    !!m?.captured && !!yourMove?.captured && m.to === yourMove.to &&
    PIECE_VALUE[yourMove.captured] >= PIECE_VALUE[m.captured];
  if (m?.captured && !trade && !chess.isAttacked(m.to as Square, you)) return 'hung-piece';
  if (m && isFork(chess, m.to)) return 'fork';
  return winAfter >= 40 ? 'missed-tactic' : 'walked-into-tactic';
}

/** Every position your repertoire knows, for both sides. */
let bookPositions: Set<string> | null = null;
function inRepertoire(fen: string): boolean {
  bookPositions ??= new Set(
    repertoires.flatMap((r) => r.lines.flatMap((l) => l.plies.flatMap((p) => [fenKey(p.fenBefore), fenKey(p.fenAfter)]))),
  );
  return bookPositions.has(fenKey(fen));
}

/** Non-pawn, non-king material on the board in pawn units. */
function pieceMaterial(fen: string): number {
  let n = 0;
  for (const ch of fen.split(' ')[0]) {
    const v = PIECE_VALUE[ch.toLowerCase()];
    if (v && v > 1) n += v;
  }
  return n;
}

/** Opening ends when you leave the book (or ply 20); endgame starts when little material is left. */
export function phaseOf(ply: number, fen: string, bookEnd: number): 'opening' | 'middlegame' | 'endgame' {
  if (ply < bookEnd) return 'opening';
  return pieceMaterial(fen) <= 13 ? 'endgame' : 'middlegame';
}

function phaseStats(accs: number[]): PhaseStats {
  return { moves: accs.length, accuracy: accs.length ? Math.round(accs.reduce((a, b) => a + b, 0) / accs.length) : 0 };
}

/**
 * Runs Stockfish over every position. onProgress gets 0..1.
 * Throws UnanalysableError for a game with fewer than MIN_USER_PLIES moves of
 * yours, and an AbortError when `opts.signal` fires.
 */
export async function analyzeGame(
  plies: GamePly[],
  userColor: 'white' | 'black',
  onProgress?: (p: number) => void,
  openings?: OpeningBook,
  clock?: { tc: TimeControl; plies: PlyClock[] } | null,
  opts: AnalyzeOptions = {},
): Promise<GameAnalysis> {
  if (userPlyCount(plies, userColor) < MIN_USER_PLIES) throw new UnanalysableError();
  const { signal } = opts;
  const cache = opts.cache === undefined ? evalCache : opts.cache;
  const engine = getEngine();
  const fens = [plies[0]?.fenBefore ?? new Chess().fen(), ...plies.map((p) => p.fenAfter)];
  const results: PositionEval[] = [];
  for (let i = 0; i < fens.length; i++) {
    if (signal?.aborted) throw abortError();
    const c = new Chess(fens[i]);
    if (c.isGameOver()) {
      const mated = c.isCheckmate();
      results.push({ score: mated ? ({ mate: 0 } as Score) : ({ cp: 0 } as Score), bestmove: '', pv: [] });
    } else {
      let hit = cache?.get(fens[i], ANALYSIS_DEPTH);
      if (!hit) {
        const r = await engine.search(fens[i], { depth: ANALYSIS_DEPTH, signal });
        hit = { score: r.score, bestmove: r.bestmove, pv: r.pv.slice(0, 6) };
        // A search the watchdog cut short is good enough for this game, not for every later one.
        if (r.depth >= ANALYSIS_DEPTH || r.score.mate !== undefined) cache?.set(fens[i], ANALYSIS_DEPTH, hit);
      }
      results.push(hit);
    }
    onProgress?.(((i + 1) / fens.length) * FIRST_PASS);
  }

  // Second pass: look deeper at the positions on either side of every suspected error.
  const quick = results.map((r, i) =>
    r.score.mate === 0 ? (fens[i].split(' ')[1] === 'w' ? -10_000 : 10_000) : whitePov(r.score, fens[i]),
  );
  const suspects = plies
    .map((p, i) => {
      const sgn = p.color === 'w' ? 1 : -1;
      return { i, drop: winPct(sgn * quick[i]) - winPct(sgn * quick[i + 1]) };
    })
    .filter((x) => x.drop >= VERIFY_DROP && results[x.i].bestmove !== plies[x.i].uci)
    .sort((a, b) => b.drop - a.drop);
  const recheck = [...new Set(suspects.flatMap((x) => [x.i, x.i + 1]))].slice(0, VERIFY_MAX).sort((a, b) => a - b);
  for (let k = 0; k < recheck.length; k++) {
    if (signal?.aborted) throw abortError();
    const i = recheck[k];
    if (!new Chess(fens[i]).isGameOver()) {
      let hit = cache?.get(fens[i], VERIFY_DEPTH);
      if (!hit) {
        const r = await engine.search(fens[i], { depth: VERIFY_DEPTH, signal });
        hit = { score: r.score, bestmove: r.bestmove, pv: r.pv.slice(0, 6) };
        if (r.depth >= VERIFY_DEPTH || r.score.mate !== undefined) cache?.set(fens[i], VERIFY_DEPTH, hit);
      }
      results[i] = hit;
    }
    onProgress?.(FIRST_PASS + ((k + 1) / recheck.length) * (1 - FIRST_PASS));
  }

  // Merit pass: for played moves that matched the engine, how much worse was the next best move?
  const second = new Map<number, number>(); // ply -> mover's win chance after the best alternative
  const candidates: number[] = [];
  for (let i = 0; i < plies.length && candidates.length < MERIT_MAX; i++) {
    const p = plies[i];
    if (results[i].bestmove !== p.uci) continue;
    const sgn = p.color === 'w' ? 1 : -1;
    const now = winPct(sgn * whitePov(results[i].score, fens[i]));
    // Nothing to celebrate when the game is already decided either way.
    if (now < 15 || now > MERIT_MAX_WIN) continue;
    const prev = plies[i - 1];
    if (prev?.captured && prev.to === p.to) continue; // taking back is not a discovery
    candidates.push(i);
  }
  for (const i of candidates) {
    if (signal?.aborted) throw abortError();
    const others = new Chess(fens[i]).moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion ?? '')).filter((u) => u !== plies[i].uci);
    if (!others.length) continue; // a forced move earns nothing
    // Cached under the excluded move, so a second look at the same game or opening costs nothing.
    const key = `${fens[i]}|not:${plies[i].uci}`;
    let alt = cache?.get(key, MERIT_DEPTH);
    if (!alt) {
      const r = await engine.search(fens[i], { depth: MERIT_DEPTH, searchmoves: others, signal });
      alt = { score: r.score, bestmove: r.bestmove, pv: [] };
      if (r.depth >= MERIT_DEPTH || r.score.mate !== undefined) cache?.set(key, MERIT_DEPTH, alt);
    }
    const sgn = plies[i].color === 'w' ? 1 : -1;
    second.set(i, winPct(sgn * whitePov(alt.score, fens[i])));
  }
  onProgress?.(1);

  // mate 0 means the side to move is mated
  const evals = results.map((r, i) =>
    r.score.mate === 0 ? (fens[i].split(' ')[1] === 'w' ? -10_000 : 10_000) : whitePov(r.score, fens[i]),
  );

  const mine = userColor === 'white' ? 'w' : 'b';
  const opening = openings ? nameOpening(plies, openings) : null;
  // Book ends at the last ply either side still followed a known opening or your repertoire.
  let bookEnd = 0;
  for (let i = 0; i < plies.length; i++) {
    if (inRepertoire(plies[i].fenAfter) || (opening && i < opening.ply)) bookEnd = i + 1;
    else break;
  }
  bookEnd = Math.min(bookEnd, 24);

  const accs = { opening: [] as number[], middlegame: [] as number[], endgame: [] as number[] };
  const moments: KeyMoment[] = [];
  let blunders = 0;
  let mistakes = 0;

  const moves: MoveReview[] = plies.map((p, i) => {
    const sign = p.color === 'w' ? 1 : -1;
    const before = winPct(sign * evals[i]);
    const after = winPct(sign * evals[i + 1]);
    const drop = Math.max(0, before - after);
    const best = results[i].bestmove;
    let cls = classify(drop, best === p.uci, before, after);
    if (i < bookEnd && drop < 10) cls = 'book';
    const review: MoveReview = { cls, drop: Math.round(drop * 10) / 10, best, pv: results[i].pv };
    const alt = second.get(i);
    if (cls === 'best' && alt !== undefined && after >= 40) {
      const gap = before - alt;
      if (gap >= BRILLIANT_GAP && isSacrifice(p.fenBefore, p.uci)) review.merit = 'brilliant';
      else if (gap >= GREAT_GAP && !isObviousCapture(p.fenBefore, p.uci)) review.merit = 'great';
    }
    const ck = clock?.plies[i];
    if (ck) {
      review.left = ck.left;
      review.spent = ck.spent;
    }
    moments.push({ ply: i, swing: Math.round((after - before) * 10) / 10, mine: p.color === mine });
    const acc = moveAccuracy(drop);
    if (p.color === mine) {
      accs[phaseOf(i, p.fenBefore, bookEnd)].push(acc);
      if (cls === 'blunder' || cls === 'mistake' || cls === 'missed-win') {
        if (cls === 'mistake') mistakes++;
        else blunders++;
        review.kind = blunderKind(
          results[i].score,
          results[i + 1].score,
          p.fenAfter,
          results[i + 1].bestmove,
          after,
          { to: p.to, captured: p.captured },
        );
      }
    }
    return review;
  });

  // The first ply after which the side that ended up winning never dropped below +1 again.
  const finalCp = evals[evals.length - 1];
  let decidedAt: number | undefined;
  if (Math.abs(finalCp) >= 150) {
    const sign = Math.sign(finalCp);
    for (let i = evals.length - 1; i >= 0; i--) {
      if (sign * evals[i] < 100) {
        decidedAt = i; // ply index of the move that crossed the line
        break;
      }
    }
  }

  const keyMoments = moments
    .filter((m) => Math.abs(m.swing) >= 15)
    .sort((a, b) => Math.abs(b.swing) - Math.abs(a.swing))
    .slice(0, 5)
    .sort((a, b) => a.ply - b.ply);

  // White's win% for every position, for the volatility-weighted accuracy.
  const wins = evals.map((cp) => winPct(cp));
  const errors = (i: number) => {
    const c = moves[i].cls;
    return plies[i].color === mine && (c === 'blunder' || c === 'mistake' || c === 'missed-win');
  };
  let time: GameAnalysis['time'];
  if (clock) {
    const low = lowTime(clock.tc);
    const myIdx = plies.map((_, i) => i).filter((i) => plies[i].color === mine);
    const spentIn = (from: number, to: number) =>
      myIdx.filter((i) => i >= from && i < to).reduce((a, i) => a + clock.plies[i].spent, 0);
    time = {
      base: clock.tc.base,
      inc: clock.tc.inc,
      lowTimeErrors: myIdx.filter((i) => errors(i) && clock.plies[i].left < low).length,
      hastyErrors: myIdx.filter((i) => errors(i) && clock.plies[i].left >= low && clock.plies[i].spent < 3 && i >= bookEnd).length,
      openingSecs: Math.round(spentIn(0, Math.max(bookEnd, 20))),
      totalSecs: Math.round(spentIn(0, plies.length)),
      endedLow: myIdx.length > 0 && clock.plies[myIdx[myIdx.length - 1]].left < low,
    };
  }

  return {
    version: ANALYSIS_VERSION,
    depth: ANALYSIS_DEPTH,
    evals,
    moves,
    // Never undefined here: the guard at the top guarantees moves of yours to score.
    accuracy: gameAccuracy(wins, mine) ?? 0,
    oppAccuracy: gameAccuracy(wins, mine === 'w' ? 'b' : 'w'),
    time,
    blunders,
    mistakes,
    phases: { opening: phaseStats(accs.opening), middlegame: phaseStats(accs.middlegame), endgame: phaseStats(accs.endgame) },
    keyMoments,
    decidedAt,
    finalPv: results[results.length - 1]?.pv.length ? results[results.length - 1].pv : undefined,
    opening: opening ?? undefined,
    analyzedAt: new Date(),
  };
}
