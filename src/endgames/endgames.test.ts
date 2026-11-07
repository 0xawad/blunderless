import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { ENDGAMES, ENDGAME_GROUPS, goalReached, type Endgame } from './positions';

const byId = (id: string) => ENDGAMES.find((e) => e.id === id)!;

/** Plays SAN moves from the endgame's start, judging after each ply like the page does. */
function run(eg: Endgame, sans: string[]) {
  const c = new Chess(eg.fen);
  let r: ReturnType<typeof goalReached> = null;
  for (const san of sans) {
    expect(r).toBeNull();
    c.move(san);
    r = goalReached(c, eg);
  }
  return r;
}

describe('ENDGAMES', () => {
  it('has unique ids and known groups', () => {
    expect(new Set(ENDGAMES.map((e) => e.id)).size).toBe(ENDGAMES.length);
    for (const e of ENDGAMES) expect(ENDGAME_GROUPS).toContain(e.group);
    for (const g of ENDGAME_GROUPS) expect(ENDGAMES.some((e) => e.group === g)).toBe(true);
  });

  for (const eg of ENDGAMES) {
    it(`${eg.id}: legal, your move, not over`, () => {
      const c = new Chess(eg.fen);
      expect(c.turn()).toBe(eg.side[0]);
      expect(c.isGameOver()).toBe(false);
      expect(c.inCheck()).toBe(false);
      expect(goalReached(c, eg)).toBeNull();
      expect(eg.maxMoves).toBeGreaterThan(0);
      expect(eg.tip.length).toBeGreaterThan(0);
    });
  }
});

describe('goalReached', () => {
  it('mate: win on your checkmate', () => {
    expect(run(byId('back-rank'), ['Qe8+', 'Rxe8', 'Rxe8#'])).toBe('win');
  });

  it('mate: fail when the move budget runs out', () => {
    expect(run(byId('back-rank'), ['h3', 'h6', 'g3', 'g6', 'f3'])).toBe('fail');
  });

  it('mate: fail on stalemate', () => {
    const eg: Endgame = { ...byId('kq-k'), fen: '7k/8/8/6K1/8/8/8/5Q2 w - - 0 1' };
    expect(run(eg, ['Qf7'])).toBe('fail');
  });

  it('mate: fail when you hang the queen and only kings remain', () => {
    expect(run(byId('kq-k'), ['Qa3+', 'Kc6', 'Qc5+', 'Kxc5'])).toBe('fail');
  });

  it('mate: fail when you are the one getting mated', () => {
    const eg: Endgame = { ...byId('back-rank'), fen: '3r2k1/5ppp/8/8/4Q3/8/5PPP/6K1 w - - 0 1' };
    expect(run(eg, ['Qe2', 'Rd1+', 'Qe1', 'Rxe1#'])).toBe('fail');
  });

  it('mate: fail when they promote and you leave the queen alive', () => {
    const eg: Endgame = { ...byId('q-vs-pawn'), fen: '8/8/8/8/8/8/3pk3/K5Q1 w - - 0 1' };
    // Qg1-g8 abandons d1; d1=Q stands and you are no longer ahead.
    expect(run(eg, ['Qg8', 'd1=Q+', 'Ka2'])).toBe('fail');
  });

  it('promote: win once the new queen survives the reply', () => {
    const eg = byId('pawn-race');
    const c = new Chess(eg.fen);
    for (const san of ['a5', 'h4', 'a6', 'h3', 'a7', 'h2']) c.move(san);
    c.move('a8=Q');
    expect(goalReached(c, eg)).toBeNull(); // pending their reply
    c.move('Kb2'); // a8=Q is check down the a-file
    expect(goalReached(c, eg)).toBe('win');
  });

  it('promote: a queen captured on arrival does not count', () => {
    const eg: Endgame = { ...byId('lucena'), fen: '2k5/3P4/8/8/8/K7/8/7r w - - 0 1' };
    expect(run(eg, ['d8=Q+'])).toBeNull();
    expect(run(eg, ['d8=Q+', 'Kxd8'])).toBe('fail');
  });

  it('promote: fail when the pawn is lost', () => {
    const eg: Endgame = { ...byId('kp-sixth'), fen: '8/8/8/3k4/4P3/8/8/K7 w - - 0 1' };
    expect(run(eg, ['Kb2', 'Kxe4'])).toBe('fail');
  });

  it('promote: fail when they win the race', () => {
    expect(run(byId('pawn-race'), ['Kg7', 'h4', 'Kf6', 'h3', 'Ke5', 'h2', 'Kd4', 'h1=Q', 'Kc5'])).toBe('fail');
  });

  it('draw: win when the defender takes the last pawn', () => {
    const eg = byId('square');
    expect(run(eg, ['Ke6', 'a5', 'Kd6', 'a6', 'Kc7', 'a7', 'Kb7', 'Kg2', 'Kxa7'])).toBe('win');
  });

  it('draw: win after surviving the move budget', () => {
    const eg: Endgame = { ...byId('philidor'), maxMoves: 2 };
    expect(run(eg, ['Rc6', 'Rb7', 'Rh6'])).toBeNull();
    expect(run(eg, ['Rc6', 'Rb7', 'Rh6', 'Rb8+'])).toBe('win');
  });

  it('draw: fail when they promote and keep the queen', () => {
    const eg: Endgame = { ...byId('kp-hold'), fen: '8/4P3/3K4/8/8/8/8/k7 b - - 0 1' };
    expect(run(eg, ['Kb2', 'e8=Q', 'Kc3'])).toBe('fail');
  });

  it('draw: fail when you hang your rook', () => {
    expect(run(byId('philidor'), ['Rb6', 'Rxb6'])).toBeNull();
    expect(run(byId('philidor'), ['Rb6', 'Rxb6', 'Kd7'])).toBe('fail');
  });
});
