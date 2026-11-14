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
    // A quiet developing move is called what it is, with no made-up tactic.
    expect(text).toMatch(/Better was Bc4: it develops a piece\.$/);
  });

  it('says what the better line wins when it wins material', () => {
    // 1.e4 e5 2.Nf3 Nc6 3.Ng5 Qxg5: the better move was simply to take the knight.
    const plies = parseGamePgn('1. e4 e5 2. Nf3 d6 3. Ng5 Nf6');
    const text = explainMove(plies[5], { cls: 'blunder', drop: 40, best: 'd8g5', pv: ['d8g5', 'd2d4', 'g5g6'] }, [], 'Qxg5');
    expect(text).toMatch(/Better was Qxg5: it wins a free knight/);
  });
});

describe('trades and exchanges', () => {
  it('does not call an even queen trade losing the queen', () => {
    // Berlin endgame: 8.Qxd8+ Kxd8 is queen for queen.
    const plies = parseGamePgn('1. e4 e5 2. Nf3 Nc6 3. Bb5 Nf6 4. O-O Nxe4 5. d4 Nd6 6. Bxc6 dxc6 7. dxe5 Nf5 8. Qxd8+');
    const qxd8 = plies[14];
    expect(qxd8.san).toBe('Qxd8+');
    expect(describeConsequence(qxd8, ['e8d8'])).toBe('');
    expect(describeConsequence(qxd8, ['e8d8', 'b1c3', 'c8e6', 'h2h3'])).toBe('');
  });

  it('does not call bishop for knight losing the bishop', () => {
    const plies = parseGamePgn('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bxc6');
    expect(describeConsequence(plies[6], ['d7c6'])).not.toMatch(/lose/);
    // The explanation no longer contradicts the "not a hung piece" verdict.
    const text = explainMove(plies[6], { cls: 'mistake', drop: 21, best: 'b5a4', kind: 'missed-tactic' }, ['d7c6'], 'Ba4');
    expect(text).toBe('Better was Ba4: it moves the bishop out of danger.');
  });

  it('still names a bad trade, and what you got for the piece', () => {
    // 3.Qxe5+?? Nxe5: a queen for a pawn.
    const plies = parseGamePgn('1. e4 e5 2. Qh5 Nc6 3. Qxe5+');
    expect(describeConsequence(plies[4], ['c6e5'])).toBe('After Nxe5 you lose the queen for a pawn.');
  });

  it('still names a piece lost elsewhere after you took something', () => {
    // 4.Nxe5 wins a pawn and leaves the queen to the bishop: not a recapture, so nothing is offset.
    const plies = parseGamePgn('1. e4 e5 2. Nf3 d6 3. Bc4 Bg4 4. Nxe5');
    expect(describeConsequence(plies[6], ['g4d1'])).toBe('After Bxd1 you lose the queen.');
  });

  // Black's knight on a5 is defended but has nowhere to go: b4 traps it.
  const trap = '6k1/1b5p/1pp5/n7/8/3P4/PP6/6K1 w - - 0 1';
  const kh1 = (() => {
    const c = new Chess(trap);
    const m = c.move('Kh1');
    return { san: m.san, uci: 'g1h1', from: m.from, to: m.to, color: m.color, fenBefore: m.before, fenAfter: m.after };
  })();

  it('does not claim a win from a line that stops in the middle of an exchange', () => {
    // After 3...a6 the line Ba4 Nf6 O-O Be7 Bxc6 dxc6 is level; five plies of it look like a won piece.
    const plies = parseGamePgn('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bc4');
    const pv = ['b5a4', 'g8f6', 'e1g1', 'f8e7', 'a4c6', 'd7c6'];
    const full = explainMove(plies[6], { cls: 'inaccuracy', drop: 12, best: 'b5a4', pv }, [], 'Ba4');
    expect(full).toBe('Better was Ba4: it moves the bishop out of danger.');
    // The engine's line can also simply end on the capture.
    const short = explainMove(plies[6], { cls: 'inaccuracy', drop: 12, best: 'b5a4', pv: pv.slice(0, 5) }, [], 'Ba4');
    expect(short).toBe('Better was Ba4: it moves the bishop out of danger.');
    // Same when the capture that ends the line wins more than it costs: the knight is taken, the pawn falls back.
    const cut = explainMove(kh1, { cls: 'mistake', drop: 22, best: 'b2b4', pv: ['b2b4', 'h7h6', 'b4a5'] }, [], 'b4');
    expect(cut).toBe('Better was b4.');
  });

  it('still says what a quiet move wins once the exchange is finished', () => {
    const pv = ['b2b4', 'h7h6', 'b4a5', 'b6a5'];
    const text = explainMove(kh1, { cls: 'mistake', drop: 22, best: 'b2b4', pv }, [], 'b4');
    expect(text).toBe('Better was b4: it wins material worth 2 pawns: b4 h6 bxa5 bxa5.');
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
