import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { parseGamePgn } from '../chess/game';
import { toGameRow } from '../chesscom';
import { bookReport } from './book';
import { blunderKind, classify } from './analyze';

const plies = (pgn: string) => parseGamePgn(pgn);

describe('bookReport', () => {
  it('follows a full Italian line to the end of prep', () => {
    const r = bookReport(plies('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d3 d6 6. O-O O-O 7. h3 a6 8. a4 Ba7 9. Re1 h6'), 'white');
    expect(r.status).toBe('end-of-prep');
  });

  it('catches you leaving your own repertoire', () => {
    const r = bookReport(plies('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. Ng5'), 'white');
    expect(r).toMatchObject({ status: 'you-deviated', ply: 6, played: 'Ng5', expected: 'c3' });
    expect(r.lineId).toMatch(/^white-italian:/);
  });

  it('notes when the opponent goes off-book', () => {
    const r = bookReport(plies('1. e4 e5 2. Nf3 Nc6 3. Bc4 h6'), 'white');
    expect(r).toMatchObject({ status: 'they-deviated', ply: 5, played: 'h6' });
  });

  it('works for Black through a transposition', () => {
    // Slav via 1.Nf3 move order
    const r = bookReport(plies('1. Nf3 d5 2. c4 c6 3. d4 Nf6 4. Nc3 dxc4 5. a4 Bf5'), 'black');
    expect(r.status).not.toBe('you-deviated');
  });
});

describe('toGameRow', () => {
  const base = {
    uuid: 'abc-123',
    url: 'https://www.chess.com/game/live/1',
    pgn: '1. e4 e5 *',
    rules: 'chess',
    time_class: 'rapid',
    end_time: 1_700_000_000,
    white: { username: 'Me', rating: 750, result: 'win' },
    black: { username: 'them', rating: 760, result: 'resigned' },
  };

  it('maps a valid game', () => {
    expect(toGameRow(base, 'me')).toMatchObject({ id: 'abc-123', userColor: 'white', result: 'win', whiteElo: 750 });
  });

  it('skips variants, foreign games and junk', () => {
    expect(toGameRow({ ...base, rules: 'chess960' }, 'me')).toBeNull();
    expect(toGameRow(base, 'someone-else')).toBeNull();
    expect(toGameRow({ ...base, pgn: 42 }, 'me')).toBeNull();
    expect(toGameRow(null, 'me')).toBeNull();
  });

  it('drops a url that does not point at chess.com', () => {
    expect(toGameRow({ ...base, url: 'javascript:alert(1)' }, 'me')?.url).toBeUndefined();
  });
});

describe('blunder classification', () => {
  it('uses Lichess thresholds', () => {
    expect(classify(35, false)).toBe('blunder');
    expect(classify(22, false)).toBe('mistake');
    expect(classify(12, false)).toBe('inaccuracy');
    expect(classify(50, true)).toBe('best');
  });

  it('spots a hung piece from the reply', () => {
    // After 1.e4 e5 2.Nf3 Nc6 3.Ng5?? ... the queen can take on g5.
    const c = new Chess();
    for (const m of ['e4', 'e5', 'Nf3', 'd6', 'Ng5']) c.move(m);
    expect(blunderKind({ cp: 0 }, { cp: 300 }, c.fen(), 'c8g4', 20)).not.toBe('hung-piece');
    expect(blunderKind({ cp: 0 }, { cp: 300 }, c.fen(), 'd8g5', 20)).toBe('hung-piece');
  });

  it('does not call a recapture after an even trade a hung piece', () => {
    // 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Bxc6 dxc6: bishop for knight
    const c = new Chess();
    for (const m of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6']) c.move(m);
    expect(blunderKind({ cp: 0 }, { cp: 300 }, c.fen(), 'd7c6', 20, { to: 'c6', captured: 'n' })).not.toBe('hung-piece');
  });

  it('flags allowed mate first', () => {
    expect(blunderKind({ cp: 0 }, { mate: 1 }, new Chess().fen(), 'e2e4', 0)).toBe('allowed-mate');
  });
});
