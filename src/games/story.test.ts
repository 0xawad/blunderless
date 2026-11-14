import { describe, expect, it } from 'vitest';
import { parseGamePgn } from '../chess/game';
import { describeConsequence, explainMove, mateFor } from './explain';
import { gameStory } from './story';
import type { GameAnalysis, MoveReview } from '../srs/types';

const plies = parseGamePgn('1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5');

function analysis(evals: number[], over: Partial<Record<number, Partial<MoveReview>>> = {}, extra: Partial<GameAnalysis> = {}): GameAnalysis {
  return {
    version: 3,
    depth: 14,
    evals,
    moves: plies.map((_, i) => ({ cls: 'good', drop: 0, best: 'e2e4', ...over[i] }) as MoveReview),
    accuracy: 80,
    blunders: 0,
    mistakes: 0,
    analyzedAt: new Date(),
    ...extra,
  };
}

describe('gameStory', () => {
  it('says you threw a win away, and names the move', () => {
    // White (you) is winning after move 3, then 4.Ng5 gives it all back.
    const a = analysis([20, 30, 30, 40, 40, 600, 600, -300, -300], { 6: { cls: 'blunder', drop: 55, kind: 'hung-piece' } }, { blunders: 1 });
    const s = gameStory(a, plies, 'white', 'loss');
    expect(s.verdict).toMatch(/winning around move 3/);
    expect(s.verdict).toMatch(/4\.Ng5/);
    expect(s.cause).toMatch(/hung a piece/);
  });

  it('calls a clean win a clean win', () => {
    const a = analysis([20, 40, 60, 90, 120, 200, 260, 400, 500]);
    const s = gameStory(a, plies, 'white', 'win');
    expect(s.verdict).toMatch(/controlled win/i);
    expect(s.cause).toMatch(/No blunders/);
  });

  it('credits the opponent when no move of yours lost it', () => {
    const a = analysis([20, 0, -20, -40, -80, -120, -200, -260, -400]);
    expect(gameStory(a, plies, 'white', 'loss').verdict).toMatch(/No single move lost this/);
  });

  it('reports your win chances from your side when you are Black', () => {
    const a = analysis([20, 0, 0, 0, 0, 0, 0, 0, -500]);
    const s = gameStory(a, plies, 'black', 'win');
    expect(s.chances[s.chances.length - 1]).toBeGreaterThan(80);
  });
});

describe('explanations for both sides', () => {
  const g = parseGamePgn('1. e4 e5 2. Nf3 Nc6 3. Ng5');

  it('says "they" for an opponent move', () => {
    expect(describeConsequence(g[4], ['d8g5'], false)).toBe('After Qxg5 they lose the knight.');
    expect(describeConsequence(g[4], ['d8g5'])).toBe('After Qxg5 you lose the knight.');
  });

  it('describes a best move only when there is something concrete to say', () => {
    const take = parseGamePgn('1. e4 d5 2. exd5');
    expect(explainMove(take[2], { cls: 'best', drop: 0, best: 'e4d5' }, [], 'exd5')).toMatch(/exd5 (takes|wins)/);
    expect(explainMove(g[0], { cls: 'best', drop: 0, best: 'e2e4' }, [], 'e4')).toBe('');
  });

  it('mentions a quicker mate that was missed', () => {
    const text = explainMove(g[4], { cls: 'good', drop: 0, best: 'f1c4' }, [], 'Bc4', { mateBefore: 2 });
    expect(text).toMatch(/You had mate in 2, starting with Bc4/);
  });
});

describe('honest descriptions', () => {
  it('calls taking back a recapture, not a free piece', () => {
    // 1.e4 d5 2.exd5 Qxd5: the queen takes back the pawn.
    const g2 = parseGamePgn('1. e4 d5 2. exd5 Qxd5');
    const withPrev = explainMove(g2[3], { cls: 'best', drop: 0, best: 'd8d5' }, [], 'Qxd5', { prev: g2[2] });
    expect(withPrev).toBe('Qxd5 takes back.');
    expect(withPrev).not.toMatch(/free/);
  });

  it('does not call a move a fork when the pieces it attacks are defended and cheaper', () => {
    // 3...Bb4+ checks the king and "attacks" the defended c3 knight: a pin, not a fork.
    const g3 = parseGamePgn('1. d4 Nf6 2. c4 e6 3. Nc3 Bb4');
    expect(explainMove(g3[5], { cls: 'best', drop: 0, best: 'f8b4' }, [], 'Bb4')).not.toMatch(/fork/);
  });

  it('still names a real fork', () => {
    // Nc7+ hits the king and the a8 rook.
    const text = explainMove(parseGamePgn('1. e4 e5 2. Nf3 Nc6 3. Nc3 Nf6 4. Nb5 a6 5. Nxc7+')[8], { cls: 'best', drop: 0, best: 'b5c7' }, [], 'Nxc7+');
    expect(text).toMatch(/fork/);
  });
});

describe('mateFor', () => {
  it('reads folded mate scores for the side to move', () => {
    expect(mateFor(9980, 'w')).toBe(2);
    expect(mateFor(-9970, 'b')).toBe(3);
    expect(mateFor(9980, 'b')).toBeUndefined();
    expect(mateFor(350, 'w')).toBeUndefined();
    expect(mateFor(undefined, 'w')).toBeUndefined();
  });
});
