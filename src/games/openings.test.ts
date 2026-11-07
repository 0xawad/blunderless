import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { fenKey } from '../chess/game';
import { nameOpening, type OpeningBook } from './openings';

function play(sans: string[]) {
  const c = new Chess();
  return sans.map((san) => {
    c.move(san);
    return { fenAfter: c.fen() };
  });
}

const line = play(['e4', 'c6', 'd4', 'd5', 'e5']);
const book: OpeningBook = new Map([
  [fenKey(line[1].fenAfter), { eco: 'B10', name: 'Caro-Kann Defense' }],
  [fenKey(line[4].fenAfter), { eco: 'B12', name: 'Caro-Kann Defense: Advance Variation' }],
]);

describe('nameOpening', () => {
  it('returns the deepest match', () => {
    const r = nameOpening(play(['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Nf3']), book);
    expect(r).toEqual({ eco: 'B12', name: 'Caro-Kann Defense: Advance Variation', ply: 5 });
  });
  it('falls back to a shallower match', () => {
    expect(nameOpening(play(['e4', 'c6', 'Nc3']), book)?.eco).toBe('B10');
  });
  it('returns null for no match or empty game', () => {
    expect(nameOpening([], book)).toBeNull();
    expect(nameOpening(play(['d4', 'd5']), book)).toBeNull();
  });
});
