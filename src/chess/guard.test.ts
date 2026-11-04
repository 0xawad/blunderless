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
});
