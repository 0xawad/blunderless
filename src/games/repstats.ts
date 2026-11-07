import { parseGamePgn, fenKey, type GamePly } from '../chess/game';
import { repertoires, type Repertoire } from '../repertoire';
import type { GameRow } from '../srs/types';

export interface RepStats {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** average number of your moves that stayed in this repertoire */
  avgBookMoves: number;
  /** how often you (not the opponent) were the one who left the book */
  youLeftFirst: number;
}

const positionCache = new Map<string, Set<string>>();
function positionsOf(rep: Repertoire): Set<string> {
  let s = positionCache.get(rep.id);
  if (!s) {
    s = new Set(rep.lines.flatMap((l) => l.plies.map((p) => fenKey(p.fenAfter))));
    positionCache.set(rep.id, s);
  }
  return s;
}

/** How many leading plies of the game stay inside this repertoire. */
function depthIn(plies: GamePly[], rep: Repertoire): number {
  const known = positionsOf(rep);
  let d = 0;
  for (const p of plies) {
    if (!known.has(fenKey(p.fenAfter))) break;
    d++;
  }
  return d;
}

/** Which repertoire each game belongs to (deepest match on your side), with aggregate stats. */
export function repertoireStats(games: GameRow[]): Map<string, RepStats> {
  const out = new Map<string, RepStats>();
  for (const g of games) {
    let plies: GamePly[];
    try {
      plies = parseGamePgn(g.pgn);
    } catch {
      continue;
    }
    const candidates = repertoires.filter((r) => r.side === g.userColor);
    let best: { rep: Repertoire; depth: number } | null = null;
    for (const rep of candidates) {
      const d = depthIn(plies, rep);
      if (d >= 2 && (!best || d > best.depth)) best = { rep, depth: d };
    }
    if (!best) continue;
    const s = out.get(best.rep.id) ?? { games: 0, wins: 0, losses: 0, draws: 0, avgBookMoves: 0, youLeftFirst: 0 };
    s.games++;
    if (g.result === 'win') s.wins++;
    else if (g.result === 'loss') s.losses++;
    else s.draws++;
    s.avgBookMoves += Math.ceil(best.depth / 2);
    if (g.book?.status === 'you-deviated') s.youLeftFirst++;
    out.set(best.rep.id, s);
  }
  for (const s of out.values()) s.avgBookMoves = Math.round((s.avgBookMoves / s.games) * 10) / 10;
  return out;
}
