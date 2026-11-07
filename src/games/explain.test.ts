import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { parseGamePgn } from '../chess/game';
import { describeConsequence, describeMove, explainMove } from './explain';
import { classify, phaseOf } from './analyze';

describe('describeMove', () => {
  it('names a free capture', () => {
    // 1.e4 e5 2.Nf3 Nc6 3.Ng5?? Qxg5: queen wins a free knight.
    const c = new Chess();
    for (const m of ['e4', 'e5', 'Nf3', 'Nc6', 'Ng5']) c.move(m);
    expect(describeMove(c.fen(), 'd8g5')).toMatch(/wins a free knight/);
  });

  it('names mate', () => {
    const c = new Chess();
    for (const m of ['f3', 'e5', 'g4']) c.move(m);
    expect(describeMove(c.fen(), 'd8h4')).toBe('Qh4# is checkmate.');
  });

  it('names a fork', () => {
    // Knight on d5 vs king e8 and queen c7 isn't needed; use a classic: Nc7+ forking king and rook.
    const fen = 'r3k3/8/8/3N4/8/8/8/4K3 w q - 0 1';
    expect(describeMove(fen, 'd5c7')).toMatch(/fork/);
  });
});

describe('describeConsequence', () => {
  it('explains losing a piece to the reply', () => {
    const plies = parseGamePgn('1. e4 e5 2. Nf3 Nc6 3. Ng5');
    const text = describeConsequence(plies[4], ['d8g5']);
    expect(text).toMatch(/After Qxg5 you lose the knight/);
  });

  it('explains allowing mate', () => {
    const plies = parseGamePgn('1. f3 e5 2. g4');
    expect(describeConsequence(plies[2], ['d8h4'])).toMatch(/checkmate/);
  });

  it('builds a full explanation', () => {
    const plies = parseGamePgn('1. e4 e5 2. Nf3 Nc6 3. Ng5');
    const text = explainMove(plies[4], { cls: 'blunder', drop: 40, best: 'f1c4', kind: 'hung-piece' }, ['d8g5'], 'Bc4');
    expect(text).toMatch(/lose the knight/);
    expect(text).toMatch(/Better was Bc4: it/);
  });
});

describe('classification v2', () => {
  it('flags a missed win when a winning position collapses', () => {
    expect(classify(25, false, 90, 55)).toBe('missed-win');
    expect(classify(25, false, 60, 35)).toBe('mistake');
  });

  it('splits phases by book end and material', () => {
    const start = new Chess().fen();
    expect(phaseOf(3, start, 10)).toBe('opening');
    expect(phaseOf(12, start, 10)).toBe('middlegame');
    expect(phaseOf(40, '8/5k2/8/8/8/8/3R4/4K3 w - - 0 1', 10)).toBe('endgame');
  });
});
