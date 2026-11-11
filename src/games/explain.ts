// Plain-language explanations for a move, built from the engine's lines and
// a little static chess sense. Short sentences, no engine jargon.
import { Chess, type Square } from 'chess.js';
import { PIECE_NAME, PIECE_VALUE, playUci, type GamePly } from '../chess/game';
import { isFork } from './analyze';
import type { MoveReview } from '../srs/types';

const pieceAt = (chess: Chess, sq: string) => chess.get(sq as Square);

/** Plays a UCI line from a FEN; stops at the first illegal move. */
export function playLine(fen: string, uci: string[]): { chess: Chess; sans: string[] } {
  const chess = new Chess(fen);
  const sans: string[] = [];
  for (const u of uci) {
    const m = playUci(chess, u);
    if (!m) break;
    sans.push(m.san);
  }
  return { chess, sans };
}

/** Material (pawn units) for `color` minus the other side's. */
function balance(chess: Chess, color: 'w' | 'b'): number {
  let n = 0;
  for (const row of chess.board()) {
    for (const p of row) {
      if (!p || p.type === 'k') continue;
      n += p.color === color ? PIECE_VALUE[p.type] : -PIECE_VALUE[p.type];
    }
  }
  return n;
}

const unit = (n: number) => (n === 1 ? 'a pawn' : n === 3 ? 'a piece' : n === 5 ? 'a rook' : n === 9 ? 'the queen' : `${n} points of material`);

/** What the engine's move does from the mover's perspective. */
export function describeMove(fen: string, uci: string): string {
  const chess = new Chess(fen);
  const mover = chess.turn();
  const m = playUci(chess, uci);
  if (!m) return '';
  if (chess.isCheckmate()) return `${m.san} is checkmate.`;
  const parts: string[] = [];
  if (m.captured) {
    const defended = chess.isAttacked(m.to as Square, mover === 'w' ? 'b' : 'w');
    parts.push(defended ? `${m.san} takes the ${PIECE_NAME[m.captured]}` : `${m.san} wins a free ${PIECE_NAME[m.captured]}`);
  }
  if (chess.inCheck()) parts.push(parts.length ? 'with check' : `${m.san} gives check`);
  if (isFork(chess, m.to)) parts.push(parts.length ? 'and forks' : `${m.san} is a fork`);
  if (!parts.length) {
    // Does it create a threat? Look for an undefended enemy piece it now attacks.
    const enemy = mover === 'w' ? 'b' : 'w';
    const fen2 = chess.fen().split(' ');
    fen2[1] = mover;
    fen2[3] = '-';
    try {
      const c2 = new Chess(fen2.join(' '));
      const threats = c2
        .moves({ square: m.to as Square, verbose: true })
        .filter((x) => x.captured && x.captured !== 'k' && !chess.isAttacked(x.to as Square, enemy))
        .map((x) => PIECE_NAME[x.captured!]);
      if (threats.length) parts.push(`${m.san} attacks an undefended ${threats[0]}`);
    } catch {
      /* position with the king capturable; skip */
    }
  }
  return parts.length ? parts.join(' ') + '.' : '';
}

/** What the engine's line after the better move wins, if it wins material. */
function lineGain(fen: string, pv: string[]): string {
  const mover = new Chess(fen).turn();
  const start = new Chess(fen);
  const { chess, sans } = playLine(fen, pv.slice(0, 6));
  if (chess.isCheckmate() && chess.turn() !== mover) return `it leads to mate: ${sans.join(' ')}.`;
  // An odd count ends on your own move. If that move is a capture that can be taken
  // back, the exchange is still going: judge the line as it stood before it.
  if (sans.length % 2 === 1) {
    const last = chess.history({ verbose: true }).at(-1);
    if (last?.captured && chess.isAttacked(last.to, mover === 'w' ? 'b' : 'w')) {
      chess.undo();
      sans.pop();
    }
  }
  const gain = balance(chess, mover) - balance(start, mover);
  return gain >= 2 && sans.length ? `it wins ${unit(gain)}: ${sans.join(' ')}.` : '';
}

/** What your move allowed, read off the engine's reply line after it. */
export function describeConsequence(p: GamePly, replyPv: string[]): string {
  if (!replyPv.length) return '';
  const you = p.color;
  const start = new Chess(p.fenAfter);
  const { chess, sans } = playLine(p.fenAfter, replyPv.slice(0, 4));
  if (chess.isCheckmate() && chess.turn() === you) return `It allows ${sans.join(' ')}, checkmate.`;
  const first = playUci(new Chess(p.fenAfter), replyPv[0]);
  // `start` is the position after your move, so anything you just captured is already
  // banked. When the reply takes back on the same square that is a trade, and what
  // you took counts against what you lose (same rule as blunderKind in analyze.ts).
  const recapture = !!first?.captured && !!p.captured && first.to === p.to;
  const got = recapture ? PIECE_VALUE[p.captured!] : 0;
  const lost = balance(start, you) - balance(chess, you) - got;
  if (first?.captured && lost >= 3) {
    const victim = pieceAt(start, first.to);
    const what = victim ? `the ${PIECE_NAME[victim.type]}` : unit(lost);
    const swap = recapture && victim ? ` for a ${PIECE_NAME[p.captured!]}` : '';
    const more = lost > PIECE_VALUE[victim?.type ?? 'p'] - got ? ' and more' : '';
    return `After ${sans[0]} you lose ${what}${swap}${more}.`;
  }
  if (first && isFork(new Chess(playLine(p.fenAfter, [replyPv[0]]).chess.fen()), first.to)) {
    return `${sans[0]} forks you: two things attacked at once, and you can only save one.`;
  }
  if (lost >= 2) return `The line ${sans.join(' ')} costs you ${unit(lost)}.`;
  if (first?.san.includes('+')) return `${sans[0]} comes with check and your king gets dragged around.`;
  return '';
}

/** Full explanation for one of your reviewed moves. */
export function explainMove(p: GamePly, review: MoveReview, nextPv: string[] | undefined, bestSan: string): string {
  const parts: string[] = [];
  if (review.cls === 'best' || review.cls === 'book') return '';
  const consequence = describeConsequence(p, nextPv ?? []);
  if (consequence) parts.push(consequence);
  if (review.best && review.best !== p.uci) {
    const better = describeMove(p.fenBefore, review.best);
    // describeMove starts its sentence with the move; swap that for "it" after "Better was X:".
    const rest = better.startsWith(bestSan) ? `it${better.slice(bestSan.length)}` : better;
    // Nothing tactical to point at: say what the engine line gains, or just name the move.
    const why = better ? rest : review.pv?.[0] === review.best ? lineGain(p.fenBefore, review.pv) : '';
    parts.push(why ? `Better was ${bestSan}: ${why}` : `Better was ${bestSan}.`);
  }
  return parts.join(' ');
}
