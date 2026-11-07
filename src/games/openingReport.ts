// How your repertoire holds up in real games: do you actually play it, where
// do you drift off it, and which replies catch you outside your prep.
import { fenKey, parseGamePgn, type GamePly } from '../chess/game';
import { formatLine, repertoires, type Repertoire } from '../repertoire';
import { nodeAt, repertoireTree } from '../repertoire/tree';
import type { GameRow } from '../srs/types';

export interface Spot {
  /** Moves leading to the position, e.g. "1.e4 c6 2.d4 d5" */
  before: string;
  sans: string[];
  move: string;
  /** Your repertoire's move there, for your own deviations */
  expected?: string;
  count: number;
  lastGameId: string;
}

export interface RepReport {
  repId: string;
  /** Games that reached a position only this repertoire covers */
  reached: number;
  /** ...and you played the repertoire move there */
  adopted: number;
  wins: number;
  draws: number;
  losses: number;
  /** Of adopted games: who left the book first */
  youLeft: number;
  theyLeft: number;
  fullPrep: number;
  avgBookMoves: number;
  surprises: Spot[];
  slips: Spot[];
  /** Most recent adopted games first */
  gameIds: string[];
}

export interface FamilyRow {
  name: string;
  side: 'white' | 'black';
  games: number;
  score: number; // 0-100
}

const parsed = new Map<string, GamePly[] | null>();
function pliesOf(g: GameRow): GamePly[] | null {
  if (!parsed.has(g.id)) {
    try {
      parsed.set(g.id, parseGamePgn(g.pgn));
    } catch {
      parsed.set(g.id, null);
    }
  }
  return parsed.get(g.id)!;
}

/** Positions where this repertoire has your move and no other repertoire of the same side reaches. */
const ownCache = new Map<string, Set<string>>();
function ownPositions(rep: Repertoire): Set<string> {
  const hit = ownCache.get(rep.id);
  if (hit) return hit;
  const mine = repertoireTree(rep);
  const others = repertoires.filter((r) => r.side === rep.side && r.id !== rep.id).map(repertoireTree);
  const own = new Set<string>();
  for (const [k, n] of mine.nodes) {
    const myTurn = (n.fen.split(' ')[1] === 'w') === (rep.side === 'white');
    if (myTurn && n.moves.length && !others.some((o) => o.nodes.has(k))) own.add(k);
  }
  ownCache.set(rep.id, own);
  return own;
}

function bump(map: Map<string, Spot>, key: string, make: () => Omit<Spot, 'count' | 'lastGameId'>, gameId: string) {
  const s = map.get(key);
  if (s) s.count++;
  else map.set(key, { ...make(), count: 1, lastGameId: gameId });
}

/** Games must be newest first so lastGameId is the most recent one. */
export function repReport(rep: Repertoire, games: GameRow[]): RepReport {
  const tree = repertoireTree(rep);
  const own = ownPositions(rep);
  const mine = rep.side === 'white' ? 'w' : 'b';
  const r: RepReport = {
    repId: rep.id, reached: 0, adopted: 0, wins: 0, draws: 0, losses: 0,
    youLeft: 0, theyLeft: 0, fullPrep: 0, avgBookMoves: 0, surprises: [], slips: [], gameIds: [],
  };
  const surprises = new Map<string, Spot>();
  const slips = new Map<string, Spot>();
  let bookMoves = 0;

  for (const g of games) {
    if (g.userColor !== rep.side) continue;
    const plies = pliesOf(g);
    if (!plies) continue;
    const entry = plies.findIndex((p) => p.color === mine && own.has(fenKey(p.fenBefore)));
    if (entry === -1) continue;
    r.reached++;
    const want = nodeAt(tree, plies[entry].fenBefore)!.moves[0];
    if (plies[entry].san !== want.san) continue;
    r.adopted++;
    r.gameIds.push(g.id);
    if (g.result === 'win') r.wins++;
    else if (g.result === 'draw') r.draws++;
    else r.losses++;

    // Follow the game through the tree from the start until someone leaves it.
    let left: 'you' | 'they' | null = null;
    for (let i = 0; i < plies.length; i++) {
      const p = plies[i];
      const node = nodeAt(tree, p.fenBefore);
      if (!node || !node.moves.length) break; // end of prep
      const hit = node.moves.find((m) => m.san === p.san);
      if (hit) {
        if (p.color === mine) bookMoves++;
        continue;
      }
      const sans = plies.slice(0, i).map((x) => x.san);
      const before = formatLine(plies.slice(0, i));
      const key = `${fenKey(p.fenBefore)} ${p.san}`;
      if (p.color === mine) {
        left = 'you';
        bump(slips, key, () => ({ before, sans, move: p.san, expected: node.moves[0].san }), g.id);
      } else {
        left = 'they';
        bump(surprises, key, () => ({ before, sans, move: p.san }), g.id);
      }
      break;
    }
    if (left === 'you') r.youLeft++;
    else if (left === 'they') r.theyLeft++;
    else r.fullPrep++;
  }

  const top = (m: Map<string, Spot>) => [...m.values()].sort((a, b) => b.count - a.count).slice(0, 4);
  r.surprises = top(surprises);
  r.slips = top(slips);
  r.avgBookMoves = r.adopted ? Math.round((bookMoves / r.adopted) * 10) / 10 : 0;
  return r;
}

/** Every opening family you've played (from the ECO name), most played first. */
export function openingFamilies(games: GameRow[]): FamilyRow[] {
  const rows = new Map<string, FamilyRow & { points: number }>();
  for (const g of games) {
    if (!g.opening) continue;
    const name = g.opening.name.split(':')[0].trim();
    const key = `${g.userColor}|${name}`;
    const row = rows.get(key) ?? { name, side: g.userColor, games: 0, score: 0, points: 0 };
    row.games++;
    row.points += g.result === 'win' ? 1 : g.result === 'draw' ? 0.5 : 0;
    rows.set(key, row);
  }
  return [...rows.values()]
    .map(({ points, ...r }) => ({ ...r, score: Math.round((points / r.games) * 100) }))
    .sort((a, b) => b.games - a.games);
}
