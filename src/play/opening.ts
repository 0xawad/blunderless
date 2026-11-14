// How the engine chooses its opening moves in Play, and when it takes a draw.
// Pure functions, so the rules can be tested without a board or an engine.
import { repertoires } from '../repertoire';
import { nodeAt, pickReply, repertoireTree } from '../repertoire/tree';

/**
 * A reply from your own repertoire for the engine to play.
 *
 * While the position is one your repertoire prepares for (as the colour you are
 * playing), the engine answers with a move the repertoire expects, so a game
 * against it starts in lines you have studied instead of whatever Stockfish
 * fancies at low strength. Lines with more branches below them are a little
 * more likely, and no two games need start the same way. Returns null as soon
 * as the position leaves your prep; from there the engine thinks for itself.
 */
export function bookReply(fen: string, userColor: 'white' | 'black', rand: () => number = Math.random): string | null {
  const turn = fen.split(' ')[1] === 'w' ? 'white' : 'black';
  if (turn === userColor) return null; // only the engine's moves come from here
  const options = new Map<string, number>(); // uci -> how many lines go through it
  for (const rep of repertoires) {
    if (rep.side !== userColor) continue;
    const node = nodeAt(repertoireTree(rep), fen);
    for (const m of node?.moves ?? []) options.set(m.uci, (options.get(m.uci) ?? 0) + m.lineIds.length);
  }
  if (!options.size) return null;
  const moves = [...options.keys()].map((uci) => ({ uci, lineIds: Array.from({ length: options.get(uci)! }, (_, i) => `${uci}:${i}`) }));
  // pickReply weights each move by its lines; every line counts once here.
  return pickReply(moves as Parameters<typeof pickReply>[0], () => 1, rand).uci;
}

/** A draw offer is not considered before this many plies have been played. */
export const DRAW_MIN_PLIES = 30;
/** The engine agrees when your winning chance (0-100) is at least this: it is not better. */
export const DRAW_ACCEPT_WIN = 50;

export type DrawAnswer = 'too-early' | 'accept' | 'decline';

/** The engine's answer to a draw offer, given the game length and your winning chance. */
export function drawAnswer(plies: number, yourWinChance: number): DrawAnswer {
  if (plies < DRAW_MIN_PLIES) return 'too-early';
  return yourWinChance >= DRAW_ACCEPT_WIN ? 'accept' : 'decline';
}
