import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { repertoires, START_FEN } from '.';
import { lineForPath, lineForWalk, myMove, nodeAt, pickReply, repertoireTree } from './tree';

describe('repertoire tree', () => {
  it('collapses every line into one tree where your side has one move per position', () => {
    for (const rep of repertoires) {
      const tree = repertoireTree(rep);
      for (const n of tree.nodes.values()) {
        const mine = (n.fen.split(' ')[1] === 'w') === (rep.side === 'white');
        if (mine) expect(n.moves.length).toBeLessThanOrEqual(1);
      }
      // Every line is reachable by walking the tree, and found again by its path.
      for (const line of rep.lines) {
        let fen = START_FEN;
        for (const p of line.plies) {
          const m = nodeAt(tree, fen)?.moves.find((x) => x.san === p.san);
          expect(m, `${line.id} @ ${p.san}`).toBeTruthy();
          fen = m!.fenAfter;
        }
        expect(lineForPath(rep, line.plies.map((p) => p.san))?.id).toBe(line.id);
      }
    }
  });

  it('knows your move: Caro after 1.e4, Italian Bc4 after 1.e4 e5 2.Nf3 Nc6', () => {
    const caro = repertoireTree(repertoires.find((r) => r.id === 'black-caro')!);
    const c = new Chess();
    c.move('e4');
    expect(myMove(caro, c.fen())?.san).toBe('c6');
    const ital = repertoireTree(repertoires.find((r) => r.id === 'white-italian')!);
    const w = new Chess();
    for (const m of ['e4', 'e5', 'Nf3', 'Nc6']) w.move(m);
    expect(myMove(ital, w.fen())?.san).toBe('Bc4');
  });

  it('picks replies by weight', () => {
    const caro = repertoireTree(repertoires.find((r) => r.id === 'black-caro')!);
    const c = new Chess();
    for (const m of ['e4', 'c6']) c.move(m);
    const replies = nodeAt(caro, c.fen())!.moves;
    expect(replies.length).toBeGreaterThan(1);
    const target = replies[replies.length - 1];
    // Only the last branch has weight: it must be chosen whatever the roll.
    const w = (id: string) => (target.lineIds.includes(id) ? 1 : 0);
    expect(pickReply(replies, w, () => 0.01).san).toBe(target.san);
    expect(pickReply(replies, w, () => 0.99).san).toBe(target.san);
  });

  it('credits a transposed walk to the line that ends in the same position', () => {
    const rep = repertoires.find((r) => r.id === 'white-italian')!;
    const tree = repertoireTree(rep);
    const sans = 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 O-O O-O d6 h3 a6 a4 Ba7 Re1'.split(' ');
    const walk = pathOf(tree, sans);
    expect(walk.length).toBe(sans.length);
    expect(lineForPath(rep, sans)).toBeUndefined();
    const { line, missed } = lineForWalk(tree, walk, [8]); // you fumbled 5.d3
    expect(line).toBeTruthy();
    expect(fenKeyOf(line!.plies.at(-1)!.fenAfter)).toBe(fenKeyOf(walk.at(-1)!.fenAfter));
    // The miss lands on the ply of that line where the same position (before d3) comes up.
    expect(missed).toHaveLength(1);
    expect(fenKeyOf(line!.plies[missed[0]].fenBefore)).toBe(fenKeyOf(walk[7].fenAfter));
  });
});

const fenKeyOf = (f: string) => f.split(' ').slice(0, 4).join(' ');
function pathOf(tree: ReturnType<typeof repertoireTree>, sans: string[]) {
  const out: { san: string; fenAfter: string }[] = [];
  let fen = START_FEN;
  for (const san of sans) {
    const m = nodeAt(tree, fen)?.moves.find((x) => x.san === san);
    if (!m) break;
    out.push(m);
    fen = m.fenAfter;
  }
  return out;
}
