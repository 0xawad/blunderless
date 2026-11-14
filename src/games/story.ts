// The game in two sentences: how it was decided and what the main cause was.
// Built from the stored analysis only; no engine calls.
import { copy } from '../copy';
import { winPct } from '../engine/engine';
import { formatPly } from '../repertoire';
import type { GamePly } from '../chess/game';
import type { BlunderKind, GameAnalysis, MoveClass } from '../srs/types';

/** You were "clearly winning" or "in real trouble" past these win chances. */
export const WINNING = 80;
export const LOSING = 25;
/** A single move that cost at least this much win chance is a turning point. */
export const TURNING = 20;

export interface StoryMoment {
  ply: number;
  /** "12. Nf3" */
  move: string;
  mine: boolean;
  cls: MoveClass;
  /** Win-chance change for the mover, negative when they lost ground. */
  swing: number;
}

export interface GameStory {
  /** How the game was decided. */
  verdict: string;
  /** The main cause on your side, when there is one. */
  cause: string | null;
  moments: StoryMoment[];
  /** Your win chances after every position, 0-100. */
  chances: number[];
}

const moveNo = (ply: number) => Math.floor(ply / 2) + 1;

export function gameStory(a: GameAnalysis, plies: GamePly[], userColor: 'white' | 'black', result: 'win' | 'loss' | 'draw'): GameStory {
  const mine = userColor === 'white' ? 'w' : 'b';
  const sign = mine === 'w' ? 1 : -1;
  const chances = a.evals.map((cp) => winPct(sign * cp));
  const s = copy.review.story;

  // Your costliest move and the opponent's, by win chance given away.
  let worstMine = -1;
  let worstTheirs = -1;
  a.moves.forEach((m, i) => {
    if (!plies[i]) return;
    if (plies[i].color === mine) {
      if (worstMine < 0 || m.drop > a.moves[worstMine].drop) worstMine = i;
    } else if (worstTheirs < 0 || m.drop > a.moves[worstTheirs].drop) worstTheirs = i;
  });
  const mineDrop = worstMine >= 0 ? a.moves[worstMine].drop : 0;
  const theirDrop = worstTheirs >= 0 ? a.moves[worstTheirs].drop : 0;
  const at = (i: number) => formatPly(i, plies[i].san);

  const best = Math.max(...chances);
  const worst = Math.min(...chances);
  const bestAt = chances.indexOf(best);
  const worstAt = chances.indexOf(worst);

  let verdict: string;
  if (result === 'win') {
    if (worst < LOSING && theirDrop >= TURNING) verdict = s.comeback(moveNo(Math.max(0, worstAt - 1)), at(worstTheirs));
    else if (worst >= 40 && a.blunders === 0 && a.mistakes === 0) verdict = s.cleanWin;
    else if (theirDrop >= TURNING) verdict = s.gifted(at(worstTheirs));
    else verdict = s.grindWin;
  } else if (result === 'loss') {
    if (best >= WINNING && mineDrop >= TURNING) verdict = s.threwAway(moveNo(Math.max(0, bestAt - 1)), at(worstMine));
    else if (mineDrop >= TURNING) verdict = s.turned(at(worstMine));
    else verdict = s.outplayed;
  } else if (best >= WINNING) verdict = s.drawFromWin(moveNo(Math.max(0, bestAt - 1)));
  else if (worst < LOSING) verdict = s.drawSaved(moveNo(Math.max(0, worstAt - 1)));
  else verdict = s.drawLevel;

  // The main cause: your commonest kind of mistake, or the clock.
  const kinds = new Map<BlunderKind, number>();
  a.moves.forEach((m, i) => {
    if (m.kind && plies[i]?.color === mine) kinds.set(m.kind, (kinds.get(m.kind) ?? 0) + 1);
  });
  const top = [...kinds.entries()].sort((x, y) => y[1] - x[1])[0];
  let cause: string | null = null;
  if (top) cause = s.cause(copy.kinds[top[0]].label.toLowerCase(), top[1]);
  // The clock is the story only when it explains several mistakes, and at least as many as the top theme.
  if (a.time && a.time.lowTimeErrors >= 2 && a.time.lowTimeErrors >= (top?.[1] ?? 0)) cause = s.causeClock(a.time.lowTimeErrors);
  if (!cause && result !== 'loss' && a.blunders === 0 && a.mistakes === 0) cause = s.causeNone;

  const moments: StoryMoment[] = (a.keyMoments ?? [])
    .filter((k) => plies[k.ply] && a.moves[k.ply])
    .map((k) => ({ ply: k.ply, move: at(k.ply), mine: k.mine, cls: a.moves[k.ply].cls, swing: k.swing }));

  return { verdict, cause, moments, chances };
}
