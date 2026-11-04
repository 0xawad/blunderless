import { Chess, type Square } from 'chess.js';
import { PIECE_NAME, PIECE_VALUE } from './game';

export type GuardKind = 'mate' | 'hanging' | 'cheap-capture';

export interface GuardWarning {
  kind: GuardKind;
  square: string;
  piece: string; // 'knight', 'queen', ...
  by?: string; // capturing piece
}

/**
 * Static safety check for the position right after your move (opponent to
 * move). No engine: it catches the stuff that loses games at 800, which is
 * mate in one, pieces left undefended, and pieces attacked by something cheaper.
 */
export function guardCheck(fenAfter: string, yourMove?: { to: string; captured?: string }): GuardWarning[] {
  const chess = new Chess(fenAfter);
  const you = chess.turn() === 'w' ? 'b' : 'w';
  const found = new Map<string, GuardWarning & { value: number }>();

  for (const m of chess.moves({ verbose: true })) {
    const c = new Chess(fenAfter);
    c.move(m);
    if (c.isCheckmate()) return [{ kind: 'mate', square: m.to, piece: 'king', by: PIECE_NAME[m.piece] }];
    if (!m.captured) continue;

    const victim = PIECE_VALUE[m.captured];
    const attacker = PIECE_VALUE[m.piece];
    // You just took something at least as valuable: that's a trade, not a blunder.
    if (yourMove && m.to === yourMove.to && yourMove.captured && PIECE_VALUE[yourMove.captured] >= victim) continue;

    const defended = c.isAttacked(m.to as Square, you);
    let kind: GuardKind | null = null;
    if (!defended && victim >= 1) kind = 'hanging';
    else if (victim - attacker >= 2) kind = 'cheap-capture';
    if (!kind) continue;

    const prev = found.get(m.to);
    if (!prev || victim > prev.value) {
      found.set(m.to, { kind, square: m.to, piece: PIECE_NAME[m.captured], by: PIECE_NAME[m.piece], value: victim });
    }
  }

  return [...found.values()]
    .filter((w) => w.value >= (w.kind === 'hanging' ? 1 : 3))
    .sort((a, b) => b.value - a.value)
    .map(({ value: _v, ...w }) => w);
}
