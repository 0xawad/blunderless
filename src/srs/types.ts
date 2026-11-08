import type { Card } from 'ts-fsrs';

export type MoveClass = 'book' | 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder' | 'missed-win';

export type BlunderKind =
  | 'hung-piece'
  | 'allowed-mate'
  | 'missed-mate'
  | 'fork'
  | 'missed-tactic'
  | 'walked-into-tactic';

export interface MoveReview {
  cls: MoveClass;
  drop: number; // win% lost by the mover, 0-100
  best: string; // engine's best move here, UCI
  pv?: string[]; // engine's main line from before the move (UCI), a few plies
  kind?: BlunderKind; // only for your mistakes and blunders
  left?: number; // seconds on the mover's clock before the move
  spent?: number; // seconds the mover spent on it
}

export interface KeyMoment {
  ply: number; // index of the move
  swing: number; // win% change from the mover's point of view (negative = they lost ground)
  mine: boolean;
}

export interface PhaseStats {
  accuracy: number;
  moves: number;
}

export interface GameAnalysis {
  version?: number; // 2 adds pv, phases, key moments, opening
  depth: number;
  evals: number[]; // per position, centipawns from White's POV (mates folded in)
  moves: MoveReview[]; // per ply
  accuracy: number; // your accuracy, 0-100
  oppAccuracy?: number;
  blunders: number;
  mistakes: number;
  phases?: { opening: PhaseStats; middlegame: PhaseStats; endgame: PhaseStats };
  keyMoments?: KeyMoment[];
  decidedAt?: number; // ply after which the eval never came back
  opening?: { eco: string; name: string; ply: number };
  /** v3: clock use, when the PGN has clocks. */
  time?: {
    base: number;
    inc: number;
    lowTimeErrors: number; // your mistakes made in time trouble
    hastyErrors: number; // your mistakes played in under 3s with time on the clock
    openingSecs: number; // time you spent on your first ~10 moves
    totalSecs: number;
    endedLow: boolean;
  };
  analyzedAt: Date;
}

export type BookStatus = 'you-deviated' | 'they-deviated' | 'end-of-prep';

export interface BookReport {
  status: BookStatus;
  ply: number; // index of the ply where book ended
  played?: string; // SAN played there
  expected?: string; // SAN your repertoire wanted (you-deviated only)
  lineId?: string;
}

export interface GameRow {
  id: string;
  source: 'chesscom' | 'local';
  url?: string;
  pgn: string;
  white: string;
  black: string;
  whiteElo?: number;
  blackElo?: number;
  userColor: 'white' | 'black';
  result: 'win' | 'loss' | 'draw';
  timeClass: string;
  endTime: Date;
  book?: BookReport;
  /** Set when the PGN can't be replayed, so it stops counting as "to analyze". */
  unreadable?: boolean;
  /** Deepest named opening (Lichess ECO table), filled at import. */
  opening?: { eco: string; name: string };
  analysis?: GameAnalysis;
}

export interface PuzzleRow {
  id: string;
  source: 'mine' | 'lichess';
  fen: string;
  /** UCI moves. For 'lichess' moves[0] is the opponent's setup move. */
  moves: string[];
  theme: string;
  rating?: number;
  gameId?: string;
  ply?: number;
  card: Card;
  addedAt: Date;
}

export interface AttemptRow {
  id?: number;
  puzzleId: string;
  source: 'mine' | 'lichess';
  theme: string;
  solved: boolean;
  at: Date;
}
