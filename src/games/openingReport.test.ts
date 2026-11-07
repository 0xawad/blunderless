import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { repertoires } from '../repertoire';
import { nodeAt, repertoireTree } from '../repertoire/tree';
import type { GameRow } from '../srs/types';
import { openingFamilies, repReport } from './openingReport';

const caro = repertoires.find((r) => r.id === 'black-caro')!;

function game(id: string, sans: string[], result: GameRow['result'] = 'win', color: GameRow['userColor'] = 'black'): GameRow {
  const c = new Chess();
  for (const s of sans) c.move(s);
  return {
    id, source: 'local', pgn: c.pgn(), white: 'a', black: 'b', userColor: color, result,
    timeClass: 'blitz', endTime: new Date(), opening: { eco: 'B10', name: 'Caro-Kann Defense: Advance Variation' },
  };
}

describe('repReport', () => {
  it('tracks adoption, your slips and their surprises', () => {
    const line = caro.lines[0];
    const sans = line.plies.map((p) => p.san);
    const tree = repertoireTree(caro);

    // A reply the repertoire doesn't cover, right after 1.e4 c6 2.d4 d5.
    const after4 = new Chess();
    for (const s of sans.slice(0, 4)) after4.move(s);
    const known = nodeAt(tree, after4.fen())!.moves.map((m) => m.san);
    const odd = after4.moves().find((m) => !known.includes(m))!;

    const games = [
      game('full', sans),
      game('surprise', [...sans.slice(0, 4), odd]),
      game('slip', ['e4', 'c6', 'd4', 'e6'], 'loss'), // ...e6 instead of ...d5
      game('french', ['e4', 'e6'], 'draw'), // reached, not adopted
      game('white', ['d4', 'd5'], 'win', 'white'), // other side: ignored
    ];
    const r = repReport(caro, games);
    expect(r.reached).toBe(4);
    expect(r.adopted).toBe(3);
    expect(r.fullPrep).toBe(1);
    expect(r.theyLeft).toBe(1);
    expect(r.youLeft).toBe(1);
    expect(r.surprises[0]).toMatchObject({ move: odd, count: 1, lastGameId: 'surprise' });
    expect(r.slips[0]).toMatchObject({ move: 'e6', expected: 'd5', sans: ['e4', 'c6', 'd4'] });
    expect(r.wins).toBe(2);
    expect(r.losses).toBe(1);
  });

  it('groups opening families with your score', () => {
    const f = openingFamilies([game('a', ['e4', 'c6']), game('b', ['e4', 'c6'], 'loss')]);
    expect(f).toEqual([{ name: 'Caro-Kann Defense', side: 'black', games: 2, score: 50 }]);
  });
});
