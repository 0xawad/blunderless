import type { Card } from 'ts-fsrs';

export type MoveClass = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

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
  kind?: BlunderKind; // only for your mistakes and blunders
}

export interface GameAnalysis {
  depth: number;
  evals: number[]; // per position, centipawns from White's POV (mates folded in)
  moves: MoveReview[]; // per ply
  accuracy: number; // your accuracy, 0-100
  blunders: number;
  mistakes: number;
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
