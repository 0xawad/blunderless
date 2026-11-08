import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { materialOf } from './game';

describe('materialOf', () => {
  it('is level at the start', () => {
    expect(materialOf(new Chess().fen())).toEqual({ captured: { w: [], b: [] }, diff: 0 });
  });

  it('tracks captures and the balance', () => {
    const c = new Chess();
    // 1.e4 d5 2.exd5 Qxd5 3.Nc3 Qxg2?? 4.Bxg2
    for (const m of ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qxg2', 'Bxg2']) c.move(m);
    const m = materialOf(c.fen());
    expect(m.captured.w).toEqual(['q', 'p']);
    expect(m.captured.b).toEqual(['p', 'p']);
    expect(m.diff).toBe(9 + 1 - 2);
  });

  it('does not count a promotion as a capture', () => {
    // White has two queens (one promoted) and is missing a pawn.
    const m = materialOf('4k3/8/8/8/8/8/PPPPPPP1/QQ2K3 w - - 0 1');
    expect(m.captured.b).toEqual(['r', 'r', 'b', 'b', 'n', 'n', 'p']);
    expect(m.captured.w).toEqual(['q', 'r', 'r', 'b', 'b', 'n', 'n', 'p', 'p', 'p', 'p', 'p', 'p', 'p', 'p']);
  });
});
