import { fenKey, type GamePly } from '../chess/game';
import { repertoires, type Line, type Side } from '../repertoire';
import type { BookReport } from '../srs/types';

interface SideIndex {
  /** Positions where it's your move -> the move your repertoire plays. */
  yours: Map<string, { san: string; lineId: string }>;
  /** Every position your repertoire reaches. */
  known: Set<string>;
  /** Positions where a line ends (prep is over, any move is fine). */
  leaves: Set<string>;
  /** Positions that have a continuation in some line. */
  interior: Set<string>;
}

const cache = new Map<Side, SideIndex>();

function indexFor(side: Side): SideIndex {
  const hit = cache.get(side);
  if (hit) return hit;
  const idx: SideIndex = { yours: new Map(), known: new Set(), leaves: new Set(), interior: new Set() };
  for (const r of repertoires.filter((x) => x.side === side)) {
    for (const line of r.lines) indexLine(idx, line, side);
  }
  cache.set(side, idx);
  return idx;
}

function indexLine(idx: SideIndex, line: Line, side: Side) {
  line.plies.forEach((p, i) => {
    const before = fenKey(p.fenBefore);
    idx.known.add(before);
    idx.interior.add(before);
    idx.known.add(fenKey(p.fenAfter));
    if ((p.color === 'w') === (side === 'white') && !idx.yours.has(before)) {
      idx.yours.set(before, { san: p.san, lineId: line.id });
    }
    if (i === line.plies.length - 1) idx.leaves.add(fenKey(p.fenAfter));
  });
  // A short line can end inside a longer one (transpositions). Only positions
  // with no continuation anywhere count as the end of your prep.
}

function isLeaf(idx: SideIndex, key: string): boolean {
  return idx.leaves.has(key) && !idx.interior.has(key);
}

/** Walks a game against your repertoire and reports where the book ran out. */
export function bookReport(plies: GamePly[], side: Side): BookReport {
  const idx = indexFor(side);
  const mine = side === 'white' ? 'w' : 'b';

  for (let i = 0; i < plies.length; i++) {
    const p = plies[i];
    const before = fenKey(p.fenBefore);
    if (isLeaf(idx, before)) return { status: 'end-of-prep', ply: i };

    if (p.color === mine) {
      const want = idx.yours.get(before);
      if (!want) return { status: 'end-of-prep', ply: i };
      if (want.san !== p.san) {
        return { status: 'you-deviated', ply: i, played: p.san, expected: want.san, lineId: want.lineId };
      }
    } else if (!idx.known.has(fenKey(p.fenAfter))) {
      return { status: 'they-deviated', ply: i, played: p.san };
    }
  }
  return { status: 'end-of-prep', ply: plies.length };
}
