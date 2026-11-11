import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { guardCheck } from './guard';

const after = (fen: string, san: string) => {
  const c = new Chess(fen);
  const m = c.move(san);
  return { fen: c.fen(), move: { to: m.to, captured: m.captured } };
};

describe('guardCheck', () => {
  it('flags a hanging knight', () => {
    // 1.e4 e5 2.Ng5?? (the knight is undefended and the queen takes it)
    const { fen, move } = after('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', 'Nh3');
    expect(guardCheck(fen, move)).toEqual([]);
    const bad = after('rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 2', 'Ng5');
    const w = guardCheck(bad.fen, bad.move);
    expect(w[0]).toMatchObject({ kind: 'hanging', piece: 'knight', square: 'g5' });
  });

  it('flags walking into mate in one', () => {
    // Fool's mate setup: 1.f3 e5 2.g4?? Qh4#
    const { fen, move } = after('rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2', 'g4');
    expect(guardCheck(fen, move)[0]).toMatchObject({ kind: 'mate' });
  });

  it('flags a defended piece attacked by a pawn', () => {
    // Ne4 is defended by the d3 pawn, but ...dxe4 still wins a knight for a pawn.
    const { fen, move } = after('rnbqkbnr/ppp1pppp/8/3p4/8/2NP4/PPP1PPPP/R1BQKBNR w KQkq - 0 2', 'Ne4');
    expect(guardCheck(fen, move)[0]).toMatchObject({ kind: 'cheap-capture', piece: 'knight', by: 'pawn' });
  });

  it('ignores an even trade you started', () => {
    // 3.Bxc6 dxc6: bishop for knight
    const { fen, move } = after('r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 2 3', 'Bxc6');
    expect(guardCheck(fen, move)).toEqual([]);
  });

  it('points at the pawn itself when it can be taken en passant', () => {
    // 1.d4 walks past the e4 pawn: ...exd3 lands on d3, but the pawn in danger stands on d4.
    const { fen, move } = after('6k1/8/8/8/4p3/8/3P4/6K1 w - - 0 1', 'd4');
    expect(guardCheck(fen, move)).toEqual([{ kind: 'hanging', square: 'd4', piece: 'pawn', by: 'pawn' }]);
  });

  it('says where the mating move lands and what plays it', () => {
    // Back rank: after a4 nothing stops ...Re1#.
    const { fen, move } = after('4r1k1/8/8/8/8/8/P4PPP/6K1 w - - 0 1', 'a4');
    expect(guardCheck(fen, move)).toEqual([{ kind: 'mate', square: 'e1', piece: 'king', by: 'rook' }]);
  });

  it('judges a capture on the board after it, not before', () => {
    // Before ...Rxe5 the black rook on e3 blocks the e1 rook's view of e5; once it
    // has taken, the file is open and the knight turns out to have been defended.
    const { fen, move } = after('6k1/8/8/8/8/4rN2/8/4RK2 w - - 0 1', 'Ne5');
    expect(guardCheck(fen, move)).toEqual([]);
  });

  it('finds every hanging piece, trying each capture on the same board', () => {
    // The queen can take the bishop on a5 or the knight on h4; neither is defended.
    const { fen, move } = after('3qk3/8/8/B7/7N/8/8/7K w - - 0 1', 'Kg1');
    const found = guardCheck(fen, move);
    expect(found.map((w) => `${w.kind} ${w.piece} ${w.square}`).sort()).toEqual(['hanging bishop a5', 'hanging knight h4']);
  });
});
