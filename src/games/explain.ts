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

const unit = (n: number) => (n === 1 ? 'a pawn' : n === 3 ? 'a piece' : n === 5 ? 'a rook' : n === 9 ? 'the queen' : `material worth ${n} pawns`);

/**
 * A fork worth the name: the piece on `sq` attacks two or more things that each
 * matter, i.e. the king, a piece worth more than the forker, or a piece nobody defends.
 * (isFork in analyze.ts is looser: it classifies blunders and counts defended pieces too.)
 */
function realFork(chess: Chess, sq: string): boolean {
  const forker = chess.get(sq as Square);
  if (!forker) return false;
  const enemy = forker.color === 'w' ? 'b' : 'w';
  const fen = chess.fen().split(' ');
  fen[1] = forker.color;
  fen[3] = '-';
  let c: Chess;
  try {
    c = new Chess(fen.join(' '));
  } catch {
    return false;
  }
  let targets = chess.inCheck() ? 1 : 0;
  for (const m of c.moves({ square: sq as Square, verbose: true })) {
    if (!m.captured || m.captured === 'k' || PIECE_VALUE[m.captured] < 3) continue;
    const undefended = !chess.attackers(m.to as Square, enemy).length;
    if (undefended || PIECE_VALUE[m.captured] > PIECE_VALUE[forker.type]) targets++;
  }
  return targets >= 2;
}

/**
 * What a move does from the mover's perspective.
 * `prev` is the move played just before it, so taking back is called a recapture
 * and not a win of material.
 */
export function describeMove(fen: string, uci: string, prev?: { to: string; captured?: string }): string {
  const chess = new Chess(fen);
  const mover = chess.turn();
  const before = new Chess(fen);
  const m = playUci(chess, uci);
  if (!m) return '';
  if (chess.isCheckmate()) return `${m.san} is checkmate.`;
  const parts: string[] = [];
  if (m.captured) {
    const defended = chess.isAttacked(m.to as Square, mover === 'w' ? 'b' : 'w');
    const recapture = !!prev?.captured && prev.to === m.to;
    if (recapture) {
      // Say what the exchange came to, not that a piece fell out of the sky.
      const got = PIECE_VALUE[m.captured];
      const gave = PIECE_VALUE[prev!.captured!];
      parts.push(got > gave ? `${m.san} takes back and comes out ahead` : got < gave ? `${m.san} takes back, though the exchange cost material` : `${m.san} takes back`);
    } else {
      parts.push(defended ? `${m.san} takes the ${PIECE_NAME[m.captured]}` : `${m.san} wins a free ${PIECE_NAME[m.captured]}`);
    }
  }
  if (chess.inCheck()) parts.push(parts.length ? 'with check' : `${m.san} gives check`);
  if (realFork(chess, m.to)) parts.push(parts.length ? 'and forks' : `${m.san} is a fork`);
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
  if (!parts.length) {
    const enemy = mover === 'w' ? 'b' : 'w';
    if (m.san.startsWith('O-O')) {
      parts.push(`${m.san} gets the king to safety`);
    } else if (m.piece !== 'k' && m.piece !== 'p' && inDanger(before, m.from as Square, mover) && !inDanger(chess, m.to as Square, mover)) {
      // The piece was about to be lost where it stood, and is safe where it went.
      parts.push(`${m.san} moves the ${PIECE_NAME[m.piece]} out of danger`);
    } else if ((m.piece === 'n' || m.piece === 'b') && m.from[1] === (mover === 'w' ? '1' : '8') && before.moveNumber() <= 10 && !chess.isAttacked(m.to as Square, enemy)) {
      parts.push(`${m.san} develops a piece`);
    }
  }
  return parts.length ? parts.join(' ') + '.' : '';
}

/** Is the piece on `sq` attacked by something cheaper, or attacked and not defended? */
function inDanger(chess: Chess, sq: Square, owner: 'w' | 'b'): boolean {
  const piece = chess.get(sq);
  if (!piece) return false;
  const enemy = owner === 'w' ? 'b' : 'w';
  const attackers = chess.attackers(sq, enemy);
  if (!attackers.length) return false;
  if (!chess.attackers(sq, owner).length) return true;
  return attackers.some((a) => PIECE_VALUE[chess.get(a)?.type ?? 'k'] < PIECE_VALUE[piece.type]);
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
export function describeConsequence(p: GamePly, replyPv: string[], mine = true): string {
  const who = mine ? 'you' : 'they';
  const whom = mine ? 'you' : 'them';
  const whose = mine ? 'your' : 'their';
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
    return `After ${sans[0]} ${who} lose ${what}${swap}${more}.`;
  }
  if (first && isFork(new Chess(playLine(p.fenAfter, [replyPv[0]]).chess.fen()), first.to)) {
    return `${sans[0]} forks ${whom}: two things attacked at once, and ${who} can only save one.`;
  }
  if (lost >= 2) return `The line ${sans.join(' ')} costs ${whom} ${unit(lost)}.`;
  if (first?.san.includes('+')) return `${sans[0]} comes with check and ${whose} king gets dragged around.`;
  return '';
}

export interface ExplainOptions {
  /** False when the move was your opponent's, so the sentences say "they". Default true. */
  mine?: boolean;
  /** The mover had a forced mate in this many moves before playing. */
  mateBefore?: number;
  /** The move played just before this one, so a recapture is described as one. */
  prev?: { to: string; captured?: string };
}

/**
 * Explanation for a reviewed move, yours or your opponent's.
 * A best or good move gets a sentence only when there is something concrete to say.
 */
export function explainMove(p: GamePly, review: MoveReview, nextPv: string[] | undefined, bestSan: string, opts: ExplainOptions = {}): string {
  const mine = opts.mine ?? true;
  if (review.cls === 'book') return '';
  if (review.cls === 'best' || review.cls === 'good') {
    const missed = opts.mateBefore && review.best !== p.uci && review.cls === 'good';
    if (missed) return `${mine ? 'You' : 'They'} had mate in ${opts.mateBefore}, starting with ${bestSan}. This keeps the win but takes longer.`;
    return describeMove(p.fenBefore, p.uci, opts.prev);
  }
  const parts: string[] = [];
  if (opts.mateBefore && review.best !== p.uci) parts.push(`${mine ? 'You' : 'They'} had mate in ${opts.mateBefore}.`);
  const consequence = describeConsequence(p, nextPv ?? [], mine);
  if (consequence) parts.push(consequence);
  if (review.best && review.best !== p.uci) {
    const better = describeMove(p.fenBefore, review.best, opts.prev);
    // describeMove starts its sentence with the move; swap that for "it" after "Better was X:".
    const rest = better.startsWith(bestSan) ? `it${better.slice(bestSan.length)}` : better;
    // Nothing tactical to point at: say what the engine line gains, or just name the move.
    const why = better ? rest : review.pv?.[0] === review.best ? lineGain(p.fenBefore, review.pv) : '';
    parts.push(why ? `Better was ${bestSan}: ${why}` : `Better was ${bestSan}.`);
  }
  return parts.join(' ');
}

/** Moves to mate the side to move had in this position, from a White-POV eval with mates folded in (see scoreToCp). */
export function mateFor(evalWhite: number | undefined, mover: 'w' | 'b'): number | undefined {
  if (evalWhite === undefined) return undefined;
  const cp = mover === 'w' ? evalWhite : -evalWhite;
  if (cp < 9000) return undefined;
  const n = Math.round((10_000 - cp) / 10);
  return n >= 1 ? n : undefined;
}
