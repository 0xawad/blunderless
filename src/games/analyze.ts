import { Chess, type Square } from 'chess.js';
import { PIECE_VALUE, fenKey, playUci, type GamePly } from '../chess/game';
import { getEngine, moveAccuracy, scoreToCp, winPct, type Score } from '../engine/engine';
import type { BlunderKind, GameAnalysis, KeyMoment, MoveClass, MoveReview, PhaseStats } from '../srs/types';
import { repertoires } from '../repertoire';
import type { OpeningBook } from './openings';
import { nameOpening } from './openings';

export const ANALYSIS_DEPTH = 12;
export const ANALYSIS_VERSION = 2;

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

/** Runs Stockfish over every position. onProgress gets 0..1. */
export async function analyzeGame(
  plies: GamePly[],
  userColor: 'white' | 'black',
  onProgress?: (p: number) => void,
  openings?: OpeningBook,
): Promise<GameAnalysis> {
  const engine = getEngine();
  const fens = [plies[0]?.fenBefore ?? new Chess().fen(), ...plies.map((p) => p.fenAfter)];
  const results: { score: Score; bestmove: string; pv: string[] }[] = [];
  for (let i = 0; i < fens.length; i++) {
    const c = new Chess(fens[i]);
    if (c.isGameOver()) {
      const mated = c.isCheckmate();
      results.push({ score: mated ? ({ mate: 0 } as Score) : ({ cp: 0 } as Score), bestmove: '', pv: [] });
    } else {
      const r = await engine.search(fens[i], { depth: ANALYSIS_DEPTH });
      results.push({ score: r.score, bestmove: r.bestmove, pv: r.pv.slice(0, 6) });
    }
    onProgress?.((i + 1) / fens.length);
  }

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
  const myAccs: number[] = [];
  const oppAccs: number[] = [];
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
    moments.push({ ply: i, swing: Math.round((after - before) * 10) / 10, mine: p.color === mine });
    const acc = moveAccuracy(drop);
    if (p.color === mine) {
      myAccs.push(acc);
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
    } else {
      oppAccs.push(acc);
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

  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 100);

  return {
    version: ANALYSIS_VERSION,
    depth: ANALYSIS_DEPTH,
    evals,
    moves,
    accuracy: avg(myAccs),
    oppAccuracy: avg(oppAccs),
    blunders,
    mistakes,
    phases: { opening: phaseStats(accs.opening), middlegame: phaseStats(accs.middlegame), endgame: phaseStats(accs.endgame) },
    keyMoments,
    decidedAt,
    opening: opening ?? undefined,
    analyzedAt: new Date(),
  };
}
