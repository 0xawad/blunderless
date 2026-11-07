// Endgame page strings. Tips and titles live with the positions in positions.ts.

import type { EndgameGoal, EndgameGroup } from './positions';

export const endgameCopy = {
  title: 'Endgames',
  lead: "The handful of endings you should win (or hold) on autopilot. Stockfish defends like it's paid by the hour.",
  solved: (n: number, total: number) => `${n} of ${total} cracked this session`,
  groups: {
    Mates: 'Mates',
    'Pawn endings': 'Pawn endings',
    'Rook endings': 'Rook endings',
  } satisfies Record<EndgameGroup, string>,
  goal: {
    mate: (n: number) => `Mate within ${n} moves`,
    promote: (n: number) => `Queen a pawn within ${n} moves`,
    draw: (n: number) => `Hold the draw for ${n} moves`,
  } satisfies Record<EndgameGoal, (n: number) => string>,
  play: 'Play',
  again: 'Play again',
  done: '✓',
  back: '← All endgames',
  side: (side: 'white' | 'black') => (side === 'white' ? 'You play White' : 'You play Black'),
  moves: (n: number, max: number) => `Move ${n} / ${max}`,
  tipLabel: 'Technique',
  yourTurn: 'Your move.',
  thinking: [
    'Stockfish is looking for the most annoying move…',
    'Calculating maximum resistance…',
    'Hunting for a stalemate trick…',
  ],
  win: {
    mate: [
      'Checkmate. Textbook. Literally, this is in textbooks.',
      'Mate delivered. Their king has filed a complaint.',
      'Clean kill. Do that in a real game and nobody will know you practised.',
    ],
    promote: [
      'New queen on the board. Promotion well earned.',
      'Pawn to royalty. The dream of every pawn, fulfilled by you.',
      'Queened. The rest is paperwork.',
    ],
    draw: [
      "Held. Stockfish couldn't crack you, and it tried.",
      'Half a point saved. Half points add up.',
      'Draw secured. Defence is an art and you just painted.',
    ],
  } satisfies Record<EndgameGoal, string[]>,
  fail: [
    'Not this time. The technique, once more:',
    'That slipped away. Here is the trick:',
    'Stockfish wriggled out. Remember:',
  ],
  next: 'Next endgame',
  another: 'Try another',
  retry: 'Retry',
  restart: 'Restart',
  engineFailed: "Stockfish didn't answer. Reload the page and try again.",
};
