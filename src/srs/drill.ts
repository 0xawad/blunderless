import { Rating, type Grade } from 'ts-fsrs';
import type { Line, Ply, Side } from '../repertoire';

export type Attempt = 'correct' | 'wrong';

/** One run through a line: you play your side, the app plays the other. */
export class Drill {
  index = 0;
  mistakes = 0;
  hints = 0;
  /** Plies where you went wrong or asked for a hint; feeds the weak-spots list. */
  readonly failedPlies: number[] = [];
  private wrongHere = 0;

  constructor(
    readonly line: Line,
    readonly side: Side,
  ) {}

  get done(): boolean {
    return this.index >= this.line.plies.length;
  }

  get current(): Ply | undefined {
    return this.line.plies[this.index];
  }

  get previous(): Ply | undefined {
    return this.line.plies[this.index - 1];
  }

  get fen(): string {
    return this.previous?.fenAfter ?? this.line.plies[0].fenBefore;
  }

  get isUserTurn(): boolean {
    const p = this.current;
    return !!p && (p.color === 'w') === (this.side === 'white');
  }

  /** After two misses on the same move we show the answer. */
  get revealed(): boolean {
    return this.wrongHere >= 2;
  }

  playOpponent(): Ply {
    const p = this.current;
    if (!p || this.isUserTurn) throw new Error('Not the opponent’s turn');
    this.advance();
    return p;
  }

  attempt(from: string, to: string, promotion?: string): Attempt {
    const p = this.current;
    if (!p || !this.isUserTurn) throw new Error('Not your turn');
    const samePromo = !p.promotion || !promotion || p.promotion === promotion;
    if (p.from === from && p.to === to && samePromo) {
      this.advance();
      return 'correct';
    }
    this.mistakes++;
    this.wrongHere++;
    this.markFailed();
    return 'wrong';
  }

  hint(): Ply | undefined {
    if (!this.isUserTurn) return undefined;
    this.hints++;
    this.wrongHere = Math.max(this.wrongHere, 2);
    this.markFailed();
    return this.current;
  }

  private markFailed() {
    if (!this.failedPlies.includes(this.index)) this.failedPlies.push(this.index);
  }

  grade(): Grade {
    const slips = this.mistakes + this.hints;
    if (slips === 0) return Rating.Good;
    if (slips === 1) return Rating.Hard;
    return Rating.Again;
  }

  private advance() {
    this.index++;
    this.wrongHere = 0;
  }
}
