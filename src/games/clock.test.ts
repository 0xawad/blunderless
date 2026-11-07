import { describe, expect, it } from 'vitest';
import { fmtClock, parseClocks, parseTimeControl, plyClocks } from './clock';
import { gameAccuracy } from './analyze';

const PGN = `[Event "Live Chess"]
[TimeControl "180+2"]

1. e4 {[%clk 0:03:01]} 1... e5 {[%clk 0:02:55.5]} 2. Nf3 {[%clk 0:02:50]} 2... Nc6 {[%clk 0:02:56.5]} 1-0`;

describe('clocks', () => {
  it('reads time control and per-move clocks', () => {
    expect(parseTimeControl(PGN)).toEqual({ base: 180, inc: 2 });
    expect(parseTimeControl('[TimeControl "1/86400"]')).toBeNull();
    expect(parseClocks(PGN)).toEqual([181, 175.5, 170, 176.5]);
  });

  it('works out time spent per move', () => {
    const c = plyClocks(PGN, 4)!;
    expect(c[0]).toEqual({ left: 180, spent: 1 });
    expect(c[1]).toEqual({ left: 180, spent: 6.5 });
    expect(c[2]).toEqual({ left: 181, spent: 13 });
    expect(c[3]).toEqual({ left: 175.5, spent: 1 });
    expect(plyClocks(PGN, 5)).toBeNull();
  });

  it('formats clocks', () => {
    expect(fmtClock(65)).toBe('1:05');
    expect(fmtClock(4.25)).toBe('4.3s');
  });
});

describe('gameAccuracy', () => {
  it('is near 100 for a flawless game and punishes one big blunder', () => {
    const flat = new Array(41).fill(50);
    expect(gameAccuracy(flat, 'w')).toBeGreaterThanOrEqual(99);
    const blunder = flat.map((w, i) => (i >= 21 ? 10 : w)); // White drops 40% on move 21
    const acc = gameAccuracy(blunder, 'w')!;
    expect(acc).toBeLessThan(80);
    // Black did nothing wrong.
    expect(gameAccuracy(blunder, 'b')).toBeGreaterThanOrEqual(99);
  });
});
