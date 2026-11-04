import { parseGamePgn } from '../chess/game';
import { fetchRecentGames } from '../chesscom';
import { getLine } from '../repertoire';
import { db, makeLineDue, savePuzzle } from '../srs/db';
import type { GameRow } from '../srs/types';
import { analyzeGame } from './analyze';
import { bookReport } from './book';

export function withBook(row: GameRow): GameRow {
  try {
    return { ...row, book: bookReport(parseGamePgn(row.pgn), row.userColor) };
  } catch {
    return row; // unparseable PGN: keep the game, skip the report
  }
}

/**
 * Imports new games and requeues the repertoire lines you went wrong in.
 * Only lines you've already started: an unlearned line isn't a memory lapse.
 */
export async function importChessCom(username: string, months = 3): Promise<{ added: number; requeued: number }> {
  const rows = await fetchRecentGames(username, months);
  const existing = new Set(await db.games.where('id').anyOf(rows.map((r) => r.id)).primaryKeys());
  const fresh = rows.filter((r) => !existing.has(r.id)).map(withBook);
  await db.games.bulkAdd(fresh);

  let requeued = 0;
  for (const g of fresh) {
    const line = g.book?.status === 'you-deviated' && g.book.lineId ? getLine(g.book.lineId) : undefined;
    const card = line && (await db.cards.get(line.id));
    // A mistake from before you learned the line isn't a lapse.
    if (line && card && g.endTime > card.addedAt) {
      await makeLineDue(line);
      requeued++;
    }
  }
  return { added: fresh.length, requeued };
}

/** Analyses a stored game and turns your mistakes and blunders into puzzles. */
export async function analyzeStoredGame(id: string, onProgress?: (p: number) => void): Promise<number> {
  const g = await db.games.get(id);
  if (!g) return 0;
  const plies = parseGamePgn(g.pgn);
  const analysis = await analyzeGame(plies, g.userColor, onProgress);
  await db.games.update(id, { analysis });

  let made = 0;
  for (let i = 0; i < plies.length; i++) {
    const r = analysis.moves[i];
    if (!r.kind || !r.best) continue;
    await savePuzzle({
      id: `mine:${id}:${i}`,
      source: 'mine',
      fen: plies[i].fenBefore,
      moves: [r.best],
      theme: r.kind,
      gameId: id,
      ply: i,
    });
    made++;
  }
  return made;
}
