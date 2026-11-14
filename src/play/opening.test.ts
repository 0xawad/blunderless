import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { playUci } from '../chess/game';
import { repertoires } from '../repertoire';
import { DRAW_ACCEPT_WIN, DRAW_MIN_PLIES, bookReply, drawAnswer } from './opening';

const uciOf = (p: { from: string; to: string; promotion?: string }) => p.from + p.to + (p.promotion ?? '');

const START = new Chess().fen();

describe('bookReply', () => {
  it('gives nothing when it is your move', () => {
    expect(bookReply(START, 'white')).toBeNull();
  });

  it('opens with a first move your Black repertoire prepares for', () => {
    // You are Black, so the engine (White) moves first, with a move your prep covers.
    const firsts = new Set(repertoires.filter((r) => r.side === 'black').flatMap((r) => r.lines.map((l) => uciOf(l.plies[0]))));
    for (let i = 0; i < 20; i++) {
      const uci = bookReply(START, 'black', () => i / 20);
      expect(uci).not.toBeNull();
      expect(firsts.has(uci!)).toBe(true);
    }
  });

  it('always returns a legal move, and follows a White line move by move', () => {
    const line = repertoires.find((r) => r.side === 'white')!.lines[0];
    const chess = new Chess();
    let followed = 0;
    for (const ply of line.plies) {
      if (chess.turn() === 'b') {
        const uci = bookReply(chess.fen(), 'white', () => 0);
        expect(uci).not.toBeNull();
        expect(playUci(new Chess(chess.fen()), uci!)).not.toBeNull();
        followed++;
      }
      playUci(chess, uciOf(ply));
    }
    expect(followed).toBeGreaterThan(2);
  });

  it('stops as soon as the position is out of your prep', () => {
    // 1.h4 is in nobody's repertoire as White here.
    const chess = new Chess();
    playUci(chess, 'h2h4');
    expect(bookReply(chess.fen(), 'white')).toBeNull();
  });

  it('can vary: different draws can give different first moves when the prep branches', () => {
    const seen = new Set<string | null>();
    for (let i = 0; i < 2000; i++) seen.add(bookReply(START, 'black', () => i / 2000));
    const firsts = new Set(repertoires.filter((r) => r.side === 'black').flatMap((r) => r.lines.map((l) => uciOf(l.plies[0]))));
    expect(seen.size).toBe(firsts.size);
  });
});

describe('drawAnswer', () => {
  it('will not consider a draw early in the game', () => {
    expect(drawAnswer(DRAW_MIN_PLIES - 1, 90)).toBe('too-early');
  });

  it('accepts when you are level or better, and declines when it is better', () => {
    expect(drawAnswer(DRAW_MIN_PLIES, DRAW_ACCEPT_WIN)).toBe('accept');
    expect(drawAnswer(60, 80)).toBe('accept');
    expect(drawAnswer(60, DRAW_ACCEPT_WIN - 1)).toBe('decline');
    expect(drawAnswer(60, 10)).toBe('decline');
  });
});
