import { Chess, type Square } from 'chess.js';
import { PIECE_VALUE, playUci, type GamePly } from '../chess/game';
import { getEngine, moveAccuracy, scoreToCp, winPct, type Score } from '../engine/engine';
import type { BlunderKind, GameAnalysis, MoveClass, MoveReview } from '../srs/types';

export const ANALYSIS_DEPTH = 12;

export function classify(drop: number, isBest: boolean): MoveClass {
  if (isBest) return 'best';
  if (drop >= 30) return 'blunder';
  if (drop >= 20) return 'mistake';
  if (drop >= 10) return 'inaccuracy';
  return 'good';
}

/** Turns a side-to-move score into White's point of view. */
const whitePov = (s: Score, fen: string) => (fen.split(' ')[1] === 'w' ? scoreToCp(s) : -scoreToCp(s));

/** Does the piece that just moved to `sq` attack two or more valuable targets? */
function isFork(chess: Chess, sq: string): boolean {
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

/** Runs Stockfish over every position. onProgress gets 0..1. */
export async function analyzeGame(
  plies: GamePly[],
  userColor: 'white' | 'black',
  onProgress?: (p: number) => void,
): Promise<GameAnalysis> {
  const engine = getEngine();
  const fens = [plies[0]?.fenBefore ?? new Chess().fen(), ...plies.map((p) => p.fenAfter)];
  const results: { score: Score; bestmove: string }[] = [];
  for (let i = 0; i < fens.length; i++) {
    const c = new Chess(fens[i]);
    if (c.isGameOver()) {
      const mated = c.isCheckmate();
      results.push({ score: mated ? ({ mate: 0 } as Score) : ({ cp: 0 } as Score), bestmove: '' });
    } else {
      results.push(await engine.search(fens[i], { depth: ANALYSIS_DEPTH }));
    }
    onProgress?.((i + 1) / fens.length);
  }

  // mate 0 means the side to move is mated
  const evals = results.map((r, i) =>
    r.score.mate === 0 ? (fens[i].split(' ')[1] === 'w' ? -10_000 : 10_000) : whitePov(r.score, fens[i]),
  );

  const mine = userColor === 'white' ? 'w' : 'b';
  const accs: number[] = [];
  let blunders = 0;
  let mistakes = 0;

  const moves: MoveReview[] = plies.map((p, i) => {
    const sign = p.color === 'w' ? 1 : -1;
    const before = winPct(sign * evals[i]);
    const after = winPct(sign * evals[i + 1]);
    const drop = Math.max(0, before - after);
    const best = results[i].bestmove;
    const cls = classify(drop, best === p.uci);
    const review: MoveReview = { cls, drop: Math.round(drop * 10) / 10, best };
    if (p.color === mine) {
      accs.push(moveAccuracy(drop));
      if (cls === 'blunder' || cls === 'mistake') {
        if (cls === 'blunder') blunders++;
        else mistakes++;
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

  return {
    depth: ANALYSIS_DEPTH,
    evals,
    moves,
    accuracy: accs.length ? Math.round(accs.reduce((a, b) => a + b, 0) / accs.length) : 100,
    blunders,
    mistakes,
    analyzedAt: new Date(),
  };
}
