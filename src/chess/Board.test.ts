import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { Board, describeChange, describePosition, parseTypedMove } from './Board';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// After 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5: White can castle short.
const ITALIAN = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
// White pawn on a7 about to promote, with a capture on b8 available too.
const PROMOTE = '1n2k3/P7/8/8/8/8/8/4K3 w - - 0 1';
// Knights on b1 and f3 can both go to d2.
const TWO_KNIGHTS = '4k3/8/8/8/8/5N2/8/1N2K3 w - - 0 1';

const ok = (from: string, to: string, promotion?: string) => (promotion ? { ok: true, from, to, promotion } : { ok: true, from, to });
const illegal = { ok: false, reason: 'illegal' };

describe('parseTypedMove', () => {
  it('reads coordinates', () => {
    expect(parseTypedMove(START, 'e2e4')).toEqual(ok('e2', 'e4'));
    expect(parseTypedMove(START, ' E2-E4 ')).toEqual(ok('e2', 'e4'));
    expect(parseTypedMove(START, 'g1f3')).toEqual(ok('g1', 'f3'));
    expect(parseTypedMove(ITALIAN, 'e1g1')).toEqual(ok('e1', 'g1'));
  });

  it('reads algebraic notation, forgiving case and decorations', () => {
    expect(parseTypedMove(START, 'Nf3')).toEqual(ok('g1', 'f3'));
    expect(parseTypedMove(START, 'nf3')).toEqual(ok('g1', 'f3'));
    expect(parseTypedMove(START, 'NF3')).toEqual(ok('g1', 'f3'));
    expect(parseTypedMove(START, 'e4!?')).toEqual(ok('e2', 'e4'));
    expect(parseTypedMove(ITALIAN, 'Bxf7+')).toEqual(ok('c4', 'f7'));
    expect(parseTypedMove(ITALIAN, 'bf7')).toEqual(ok('c4', 'f7'));
  });

  it('reads a lower-case b as the b-pawn before the bishop', () => {
    // The b-pawn can take on c4 and the f1 bishop can go there too.
    const fen = '4k3/8/8/8/2p5/1P6/8/4KB2 w - - 0 1';
    expect(parseTypedMove(fen, 'bc4')).toEqual(ok('b3', 'c4'));
    expect(parseTypedMove(fen, 'bxc4')).toEqual(ok('b3', 'c4'));
    expect(parseTypedMove(fen, 'Bc4')).toEqual(ok('f1', 'c4'));
    expect(parseTypedMove(fen, 'Bxc4')).toEqual(ok('f1', 'c4'));
  });

  it('reads castling with letters or zeros', () => {
    for (const typed of ['O-O', 'o-o', '0-0', 'OO']) expect(parseTypedMove(ITALIAN, typed)).toEqual(ok('e1', 'g1'));
    const long = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    for (const typed of ['O-O-O', 'o-o-o', '0-0-0']) expect(parseTypedMove(long, typed)).toEqual(ok('e1', 'c1'));
    expect(parseTypedMove(START, 'O-O')).toEqual(illegal);
  });

  it('takes the promotion piece when one is named', () => {
    expect(parseTypedMove(PROMOTE, 'a8=N')).toEqual(ok('a7', 'a8', 'n'));
    expect(parseTypedMove(PROMOTE, 'a8q')).toEqual(ok('a7', 'a8', 'q'));
    expect(parseTypedMove(PROMOTE, 'a7a8r')).toEqual(ok('a7', 'a8', 'r'));
    expect(parseTypedMove(PROMOTE, 'axb8=B')).toEqual(ok('a7', 'b8', 'b'));
  });

  it('leaves an unnamed promotion for the caller to ask about', () => {
    expect(parseTypedMove(PROMOTE, 'a8')).toEqual(ok('a7', 'a8'));
    expect(parseTypedMove(PROMOTE, 'a7a8')).toEqual(ok('a7', 'a8'));
    expect(parseTypedMove(PROMOTE, 'axb8')).toEqual(ok('a7', 'b8'));
    expect(parseTypedMove(PROMOTE, 'ab8')).toEqual(ok('a7', 'b8'));
  });

  it('rejects a promotion piece on a move that does not promote', () => {
    expect(parseTypedMove(START, 'e2e4q')).toEqual(illegal);
  });

  it('says when a piece move could be two moves', () => {
    expect(parseTypedMove(TWO_KNIGHTS, 'Nd2')).toEqual({ ok: false, reason: 'ambiguous' });
    expect(parseTypedMove(TWO_KNIGHTS, 'nd2')).toEqual({ ok: false, reason: 'ambiguous' });
    expect(parseTypedMove(TWO_KNIGHTS, 'Nbd2')).toEqual(ok('b1', 'd2'));
    expect(parseTypedMove(TWO_KNIGHTS, 'f3d2')).toEqual(ok('f3', 'd2'));
  });

  it('rejects illegal moves and anything that is not a move', () => {
    for (const typed of ['', '   ', 'Ke2', 'e5', 'e2e5', 'Qh5', 'hello', '--', 'zzze2e4', 'e2e4 e7e5', 'Nf3; drop']) {
      expect(parseTypedMove(START, typed), typed).toEqual(illegal);
    }
    expect(parseTypedMove('not a fen', 'e4')).toEqual(illegal);
  });

  it('only returns moves chess.js accepts', () => {
    for (const [fen, typed] of [[START, 'nc3'], [ITALIAN, 'O-O'], [ITALIAN, 'd4'], [PROMOTE, 'a8=Q'], [TWO_KNIGHTS, 'Nfd2']] as const) {
      const move = parseTypedMove(fen, typed);
      expect(move.ok, typed).toBe(true);
      if (move.ok) expect(() => new Chess(fen).move({ from: move.from, to: move.to, promotion: move.promotion })).not.toThrow();
    }
  });
});

describe('describePosition', () => {
  it('lists each side, most valuable first', () => {
    expect(describePosition('4k3/8/8/8/8/8/P6P/R3K2R w KQ - 0 1')).toEqual([
      'White: king e1; rooks a1, h1; pawns a2, h2.',
      'Black: king e8.',
    ]);
  });

  it('covers the whole starting position', () => {
    const [white, black] = describePosition(START);
    expect(white).toBe('White: king e1; queen d1; rooks a1, h1; bishops c1, f1; knights b1, g1; pawns a2, b2, c2, d2, e2, f2, g2, h2.');
    expect(black).toBe('Black: king e8; queen d8; rooks a8, h8; bishops c8, f8; knights b8, g8; pawns a7, b7, c7, d7, e7, f7, g7, h7.');
  });

  it('says so when a side has nothing', () => {
    expect(describePosition('8/8/8/8/8/8/8/4K3 w - - 0 1')[1]).toBe('Black: no pieces.');
  });
});

describe('describeChange', () => {
  const play = (fen: string, san: string) => {
    const chess = new Chess(fen);
    const m = chess.move(san);
    return [chess.fen(), [m.from, m.to]] as const;
  };
  const said = (fen: string, san: string) => describeChange(fen, ...play(fen, san));

  it('says the move and whose turn it is', () => {
    expect(said(START, 'Nf3')).toBe('White knight to f3. Black to move.');
    expect(said(ITALIAN, 'Bxf7+')).toBe('White bishop takes pawn on f7. Check. Black to move.');
  });

  it('names castling, promotion and en passant', () => {
    expect(said(ITALIAN, 'O-O')).toBe('White castles kingside. Black to move.');
    expect(said('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1', 'O-O-O')).toBe('Black castles queenside. White to move.');
    expect(said(PROMOTE, 'axb8=Q+')).toBe('White pawn takes knight on b8. Promotes to queen. Check. Black to move.');
    // The pawn taken en passant stands on d5, not on the d6 square the capture lands on.
    expect(said('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', 'exd6')).toBe('White pawn takes pawn on d5. Black to move.');
  });

  it('announces how the game ended', () => {
    expect(said('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 'Ra8#')).toBe('White rook to a8. Checkmate.');
    expect(said('7k/5K2/8/6Q1/8/8/8/8 w - - 0 1', 'Qg6')).toBe('White queen to g6. Stalemate.');
    expect(said('4k3/8/8/8/8/8/p7/1K6 w - - 0 1', 'Kxa2')).toBe('White king takes pawn on a2. Draw.');
  });

  it('works without knowing the last move', () => {
    const [fen] = play(START, 'e4');
    expect(describeChange(START, fen)).toBe('White pawn to e4. Black to move.');
  });

  it('falls back to whose turn it is when the positions are not one move apart', () => {
    expect(describeChange(ITALIAN, START, ['e2', 'e4'])).toBe('White to move.');
    expect(describeChange(START, ITALIAN)).toBe('White to move.');
    expect(describeChange('not a fen', START)).toBe('White to move.');
    expect(describeChange(START, 'not a fen')).toBe('');
  });
});

describe('Board markup', () => {
  // No DOM here, so this is the first render only: what assistive technology is given to work with.
  const render = (props: Partial<Parameters<typeof Board>[0]>) =>
    renderToStaticMarkup(createElement(Board, { fen: START, orientation: 'white', ...props }));

  it('names the board and describes the position in text', () => {
    const html = render({});
    expect(html).toMatch(/^<div class="board-wrap"[^>]* role="group" aria-label="Chess board">/);
    expect(html).toContain('<p class="sr-only">White: king e1; queen d1;');
    expect(html).toContain('<p class="sr-only">Black: king e8; queen d8;');
    expect(html).toContain('<p class="sr-only">White to move.</p>');
    expect(html).toContain('<div class="sr-only" role="status"></div>');
    // chessground's own elements say nothing useful to a screen reader.
    expect(html).toContain('<div class="board" aria-hidden="true"></div>');
  });

  it('takes a more specific name', () => {
    expect(render({ label: 'Preview board' })).toContain('aria-label="Preview board"');
  });

  it('offers a move field only on a board that can be played on', () => {
    const field = '<label for=';
    expect(render({})).not.toContain(field);
    expect(render({ onMove: () => {} })).not.toContain(field);
    expect(render({ interactive: true })).not.toContain(field);
    const playable = render({ interactive: true, onMove: () => {} });
    expect(playable).toContain(field);
    expect(playable).toContain('placeholder="Type a move: Nf3 or e2e4"');
    // Off screen until it has focus.
    expect(playable).toContain('<form class="board-typed sr-only"');
  });

  it('shows the resize grip only when asked, hidden from assistive technology', () => {
    expect(render({})).not.toContain('board-grip');
    expect(render({ resizable: true })).toContain('<div class="board-grip" title="Drag to resize the board" aria-hidden="true"></div>');
  });
});
