// The repertoire as one move tree keyed by position, so transpositions and
// shared move orders collapse into a single map you can walk around in.
import { fenKey } from '../chess/game';
import { START_FEN, type Line, type Repertoire } from './build';
import type { PgnShape } from './pgn';

export interface TreeMove {
  san: string;
  uci: string;
  from: string;
  to: string;
  color: 'w' | 'b';
  fenAfter: string;
  comment?: string;
  shapes?: PgnShape[];
  /** Lines that play this move from this position, in repertoire order. */
  lineIds: string[];
}

export interface TreeNode {
  fen: string;
  /** Continuations, main line first. Your side has exactly one. */
  moves: TreeMove[];
  /** Lines that end exactly here. */
  endsHere: string[];
}

export interface RepTree {
  rep: Repertoire;
  nodes: Map<string, TreeNode>;
  root: TreeNode;
}

const cache = new Map<string, RepTree>();

export function repertoireTree(rep: Repertoire): RepTree {
  const hit = cache.get(rep.id);
  if (hit) return hit;
  const nodes = new Map<string, TreeNode>();
  const node = (fen: string) => {
    const k = fenKey(fen);
    let n = nodes.get(k);
    if (!n) {
      n = { fen, moves: [], endsHere: [] };
      nodes.set(k, n);
    }
    return n;
  };
  for (const line of rep.lines) {
    line.plies.forEach((p, i) => {
      const n = node(p.fenBefore);
      let m = n.moves.find((x) => x.san === p.san);
      if (!m) {
        m = {
          san: p.san,
          uci: p.from + p.to + (p.promotion ?? ''),
          from: p.from,
          to: p.to,
          color: p.color,
          fenAfter: p.fenAfter,
          lineIds: [],
        };
        n.moves.push(m);
      }
      // The first line to annotate a move wins; later duplicates are usually blank.
      m.comment ??= p.comment;
      m.shapes ??= p.shapes;
      m.lineIds.push(line.id);
      if (i === line.plies.length - 1) node(p.fenAfter).endsHere.push(line.id);
    });
  }
  const tree = { rep, nodes, root: node(START_FEN) };
  cache.set(rep.id, tree);
  return tree;
}

export const nodeAt = (tree: RepTree, fen: string) => tree.nodes.get(fenKey(fen));

/** Your repertoire move in this position, if it has one. */
export function myMove(tree: RepTree, fen: string): TreeMove | undefined {
  const n = nodeAt(tree, fen);
  const turn = fen.split(' ')[1];
  const mine = (turn === 'w') === (tree.rep.side === 'white');
  return mine ? n?.moves[0] : undefined;
}

/** The line whose moves are exactly this path, if one ends here. */
export function lineForPath(rep: Repertoire, sans: string[]): Line | undefined {
  const id = `${rep.id}:${sans.join(' ')}`;
  return rep.lines.find((l) => l.id === id);
}

/**
 * Picks an opponent reply, favouring branches where you have the most to
 * practise. `weight` scores a line (e.g. higher for due or never-seen lines).
 */
export function pickReply(moves: TreeMove[], weight: (lineId: string) => number, rand = Math.random): TreeMove {
  let scores = moves.map((m) => m.lineIds.reduce((a, id) => a + weight(id), 0));
  if (!scores.some((x) => x > 0)) scores = moves.map(() => 1);
  let r = rand() * scores.reduce((a, b) => a + b, 0);
  for (let i = 0; i < moves.length; i++) {
    r -= scores[i];
    if (r <= 0) return moves[i];
  }
  return moves[moves.length - 1];
}
