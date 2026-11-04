import { Chess, type Square } from 'chess.js';

export interface GamePly {
  san: string;
  uci: string;
  from: string;
  to: string;
  color: 'w' | 'b';
  captured?: string;
  fenBefore: string;
  fenAfter: string;
}

export const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const PIECE_NAME: Record<string, string> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
};

export const fenKey = (fen: string) => fen.split(' ').slice(0, 4).join(' ');

export function parseGamePgn(pgn: string): GamePly[] {
  const chess = new Chess();
  chess.loadPgn(pgn);
  return chess.history({ verbose: true }).map((m) => ({
    san: m.san,
    uci: m.from + m.to + (m.promotion ?? ''),
    from: m.from,
    to: m.to,
    color: m.color,
    captured: m.captured,
    fenBefore: m.before,
    fenAfter: m.after,
  }));
}

/** Plays a UCI move (e2e4, e7e8q) and returns chess.js's move, or null if illegal. */
export function playUci(chess: Chess, uci: string) {
  try {
    return chess.move({ from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square, promotion: uci[4] ?? 'q' });
  } catch {
    return null;
  }
}

export function uciToSan(fen: string, uci: string): string {
  const m = playUci(new Chess(fen), uci);
  return m?.san ?? uci;
}
