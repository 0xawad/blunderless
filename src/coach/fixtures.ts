// Hand-built slim rows for the coach tests. Not imported by the app.
import type { BlunderKind } from '../srs/types';
import type { CoachAnalysis, CoachCard, CoachError, CoachGame } from './slim';

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
/** Noon on a fixed local day, so "today" never straddles midnight in a test. */
export const NOW = new Date(2026, 5, 15, 12, 0, 0);
export const T0 = NOW.getTime() - 400 * DAY;

/** An analysis with one error per listed kind, at plies 10, 12, 14... */
export function analysis(over: Partial<CoachAnalysis> & { kinds?: BlunderKind[] } = {}): CoachAnalysis {
  const { kinds = [], ...rest } = over;
  const errors: CoachError[] = kinds.map((kind, i) => ({ ply: 10 + i * 2, kind, missedWin: false }));
  return { at: T0, accuracy: 80, blunders: errors.length, mistakes: 0, errors, winningTurns: 0, lastWinningPly: -1, ...rest };
}

/** Game number `i`. A higher number is a more recent game. Even numbers are White. */
export function game(i: number, over: Partial<CoachGame> = {}): CoachGame {
  return {
    id: `g${i}`,
    at: T0 + i * HOUR,
    color: i % 2 ? 'black' : 'white',
    result: 'win',
    timeClass: 'blitz',
    opp: 'rival',
    review: over.a ? 'current' : 'none',
    unreviewable: false,
    ...over,
  };
}

/** `n` analysed games numbered from `from`. `each(i)` shapes the analysis, `over(i)` the game. */
export function analysed(
  n: number,
  each: (i: number) => Parameters<typeof analysis>[0] = () => ({}),
  from = 0,
  over: (i: number) => Partial<CoachGame> = () => ({}),
): CoachGame[] {
  return Array.from({ length: n }, (_, k) => game(from + k, { a: analysis(each(from + k)), ...over(from + k) }));
}

export function card(lineId: string, over: Partial<CoachCard> = {}): CoachCard {
  return { lineId, repId: lineId.split(':')[0], due: NOW.getTime() + DAY, addedAt: NOW.getTime() - 30 * DAY, lastReview: NOW.getTime() - 5 * DAY, mature: true, ...over };
}
