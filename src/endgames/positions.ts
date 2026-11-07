import { Chess } from 'chess.js';
import { PIECE_VALUE } from '../chess/game';

export type EndgameGoal = 'mate' | 'promote' | 'draw';
export type EndgameGroup = 'Mates' | 'Pawn endings' | 'Rook endings';

export interface Endgame {
  id: string;
  title: string;
  /** The side you play. Always the side to move in `fen`. */
  side: 'white' | 'black';
  fen: string;
  goal: EndgameGoal;
  /** Your moves allowed. For 'draw' goals: survive this many and you've held. */
  maxMoves: number;
  tip: string;
  group: EndgameGroup;
}

// Every FEN was checked with Stockfish 19 (depth 24+): wins are wins, holds are holds.
export const ENDGAMES: Endgame[] = [
  // ---------- Mates ----------
  {
    id: 'kq-k',
    title: 'Queen + king vs king',
    side: 'white',
    fen: '8/8/3k4/8/8/8/8/Q3K3 w - - 0 1',
    goal: 'mate',
    maxMoves: 25,
    tip: "Shrink the box: keep a knight's jump from their king, bring yours over, and check for stalemate before every squeeze.",
    group: 'Mates',
  },
  {
    id: 'kr-k',
    title: 'Rook + king vs king',
    side: 'white',
    fen: '8/8/8/4k3/8/8/8/R3K3 w - - 0 1',
    goal: 'mate',
    maxMoves: 35,
    tip: 'The rook builds the wall, the king does the pushing: kings face to face, then a rook check, and the box shrinks a row.',
    group: 'Mates',
  },
  {
    id: 'two-rooks',
    title: 'Two-rook ladder',
    side: 'white',
    fen: '8/8/8/8/4k3/8/8/RR4K1 w - - 0 1',
    goal: 'mate',
    maxMoves: 12,
    tip: 'One rook guards a rank, the other checks on the next one. Leapfrog up the ladder and leave your king at home.',
    group: 'Mates',
  },
  {
    id: 'back-rank',
    title: 'Back-rank mate',
    side: 'white',
    fen: '3r2k1/5ppp/8/8/4Q3/8/5PPP/4R1K1 w - - 0 1',
    goal: 'mate',
    maxMoves: 3,
    tip: 'Their own pawns are the prison wall. Throw the queen in on e8: if the rook takes, your rook finishes the job.',
    group: 'Mates',
  },
  {
    id: 'q-vs-pawn',
    title: 'Queen vs pawn on the 7th',
    side: 'white',
    fen: '8/8/8/8/8/8/3pk3/K6Q w - - 0 1',
    goal: 'mate',
    maxMoves: 30,
    tip: 'Check until their king has to stand in front of the pawn, then use that free move to walk your king closer. Repeat.',
    group: 'Mates',
  },

  // ---------- Pawn endings ----------
  {
    id: 'kp-sixth',
    title: 'King on the sixth',
    side: 'white',
    fen: '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1',
    goal: 'promote',
    maxMoves: 10,
    tip: 'King ahead of the pawn on the 6th always wins: sidestep to keep the opposition, and never push into stalemate.',
    group: 'Pawn endings',
  },
  {
    id: 'kp-opposition',
    title: 'Opposition with a spare tempo',
    side: 'white',
    fen: '8/8/4k3/8/4K3/8/4P3/8 w - - 0 1',
    goal: 'promote',
    maxMoves: 15,
    tip: 'King first, pawn second. A one-square pawn push is a free tempo that hands them the move and you the opposition.',
    group: 'Pawn endings',
  },
  {
    id: 'kp-hold',
    title: 'Hold the draw: take the opposition',
    side: 'black',
    fen: '4k3/8/8/4K3/4P3/8/8/8 b - - 0 1',
    goal: 'draw',
    maxMoves: 20,
    tip: 'Stand face to face with their king (Ke7 here!) and stay in front of the pawn. Back off straight, never sideways.',
    group: 'Pawn endings',
  },
  {
    id: 'square',
    title: 'Rule of the square',
    side: 'black',
    fen: '8/8/5k2/8/P7/8/8/7K b - - 0 1',
    goal: 'draw',
    maxMoves: 15,
    tip: 'Draw a box from the pawn to its queening square. Step inside it now and the pawn is lunch.',
    group: 'Pawn endings',
  },
  {
    id: 'pawn-race',
    title: 'Pawn race',
    side: 'white',
    fen: '7K/8/8/7p/P7/8/8/k7 w - - 0 1',
    goal: 'promote',
    maxMoves: 5,
    tip: "Count moves, not feelings: you're a tempo up, so just run. Your new queen on a8 even covers h1.",
    group: 'Pawn endings',
  },

  // ---------- Rook endings ----------
  {
    id: 'rook-vs-pawn',
    title: 'Rook vs pawn',
    side: 'white',
    fen: '8/8/8/8/8/4k3/4p3/R5K1 w - - 0 1',
    goal: 'mate',
    maxMoves: 40,
    tip: 'Park the rook on the queening square and bring the king. The pawn falls, then it is a plain rook mate.',
    group: 'Rook endings',
  },
  {
    id: 'lucena',
    title: 'Lucena: build a bridge',
    side: 'white',
    fen: '3K4/3P2k1/8/8/8/8/2r5/4R3 w - - 0 1',
    goal: 'promote',
    maxMoves: 12,
    tip: 'Rook to the 4th rank (Re4), walk the king out, and when the checks come, block with the rook. Bridge built.',
    group: 'Rook endings',
  },
  {
    id: 'philidor',
    title: 'Philidor: hold the third rank',
    side: 'black',
    fen: '4k3/8/r7/4PK2/8/8/8/1R6 b - - 0 1',
    goal: 'draw',
    maxMoves: 20,
    tip: 'Keep your rook on the 6th rank until their pawn steps onto it, then drop to the 1st and check from behind forever.',
    group: 'Rook endings',
  },
];

export const ENDGAME_GROUPS: EndgameGroup[] = ['Mates', 'Pawn endings', 'Rook endings'];

const colorOf = (eg: Endgame) => (eg.side === 'white' ? 'w' : 'b');

/** Material for one colour, kings excluded. */
function material(chess: Chess, color: 'w' | 'b'): number {
  let n = 0;
  for (const row of chess.board()) for (const sq of row) if (sq && sq.color === color) n += PIECE_VALUE[sq.type];
  return n;
}

function hasPawns(chess: Chess, color: 'w' | 'b'): boolean {
  return chess.board().some((row) => row.some((sq) => sq?.color === color && sq.type === 'p'));
}

export function myMoveCount(chess: Chess, eg: Endgame): number {
  const me = colorOf(eg);
  return chess.history({ verbose: true }).filter((m) => m.color === me).length;
}

/**
 * Judges the position against the endgame's goal. Call after every ply.
 * 'win' / 'fail' end the attempt; null means keep playing.
 */
export function goalReached(chess: Chess, eg: Endgame): 'win' | 'fail' | null {
  const me = colorOf(eg);
  const them = me === 'w' ? 'b' : 'w';
  const hist = chess.history({ verbose: true });
  const myMoves = hist.filter((m) => m.color === me).length;
  const justMoved = chess.turn() !== me;
  const lastMove = hist[hist.length - 1];
  const promotedLast = !!lastMove && lastMove.color === me && !!lastMove.promotion;

  if (chess.isCheckmate()) return chess.turn() === me ? 'fail' : 'win';
  if (chess.isDraw() || chess.isStalemate()) return eg.goal === 'draw' ? 'win' : 'fail';

  if (eg.goal === 'promote') {
    // A promotion counts once it survives their reply: no free queen sacs.
    for (let i = 0; i < hist.length - 1; i++) {
      const m = hist[i];
      if (m.color !== me || !m.promotion) continue;
      const reply = hist[i + 1];
      if (!(reply.captured && reply.to === m.to)) return 'win';
    }
    if (!promotedLast && !hasPawns(chess, me)) {
      // They gave everything up for the pawn: a bare king is still a win.
      return material(chess, them) === 0 && material(chess, me) >= 5 ? 'win' : 'fail';
    }
  }

  if (justMoved) {
    const start = new Chess(eg.fen);
    const initial = material(start, me) - material(start, them);
    const now = material(chess, me) - material(chess, them);
    // Attacker: stay ahead (or level, in a race). Defender: don't fall further behind.
    if (eg.goal === 'draw' ? now < initial : now < Math.min(initial, 1)) return 'fail';
  }

  if (eg.goal === 'draw') {
    // Held through their reply to your last allotted move.
    if (!justMoved && myMoves >= eg.maxMoves) return 'win';
  } else if (justMoved && myMoves >= eg.maxMoves && !promotedLast) {
    return 'fail';
  }
  return null;
}
