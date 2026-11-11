import { Chess } from 'chess.js';
import { PIECE_NAME, PIECE_VALUE } from './game';

export type GuardKind = 'mate' | 'hanging' | 'cheap-capture';

export interface GuardWarning {
  kind: GuardKind;
  /** The square to point at: the piece in danger, or where the mating move lands. */
  square: string;
  piece: string; // 'knight', 'queen', ...
  by?: string; // capturing piece
}

/**
 * Static safety check for the position right after your move (opponent to
 * move). No engine: it catches the stuff that loses games at 800, which is
 * mate in one, pieces left undefended, and pieces attacked by something cheaper.
 *
 * Runs inside the move handler, in the same frame as the piece drop, so it
 * parses the position once and tries each capture with move/undo on that one
 * board instead of building a new one per reply.
 */
export function guardCheck(fenAfter: string, yourMove?: { to: string; captured?: string }): GuardWarning[] {
  const chess = new Chess(fenAfter);
  const you = chess.turn() === 'w' ? 'b' : 'w';
  const replies = chess.moves({ verbose: true });

  // chess.js has already worked out check and mate to write each move's SAN.
  const mate = replies.find((m) => m.san.endsWith('#'));
  if (mate) return [{ kind: 'mate', square: mate.to, piece: 'king', by: PIECE_NAME[mate.piece] }];

  const found = new Map<string, GuardWarning & { value: number }>();
  for (const m of replies) {
    if (!m.captured) continue;

    // An en passant capture lands on an empty square; the pawn it takes stands beside the capturing pawn.
    const square = m.isEnPassant() ? m.to[0] + m.from[1] : m.to;
    const victim = PIECE_VALUE[m.captured];
    const attacker = PIECE_VALUE[m.piece];
    // You just took something at least as valuable: that's a trade, not a blunder.
    if (yourMove && square === yourMove.to && yourMove.captured && PIECE_VALUE[yourMove.captured] >= victim) continue;

    // Whether you can take back depends on the board after the capture (lines open, the victim is gone).
    chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    const defended = chess.isAttacked(m.to, you);
    chess.undo();

    let kind: GuardKind | null = null;
    if (!defended && victim >= 1) kind = 'hanging';
    else if (victim - attacker >= 2) kind = 'cheap-capture';
    if (!kind) continue;

    const prev = found.get(square);
    if (!prev || victim > prev.value) {
      found.set(square, { kind, square, piece: PIECE_NAME[m.captured], by: PIECE_NAME[m.piece], value: victim });
    }
  }

  return [...found.values()]
    .filter((w) => w.value >= (w.kind === 'hanging' ? 1 : 3))
    .sort((a, b) => b.value - a.value)
    .map(({ value: _v, ...w }) => w);
}
