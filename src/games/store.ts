import { parseGamePgn } from '../chess/game';
import { fetchRecentGames } from '../chesscom';
import { getLine } from '../repertoire';
import { db, getSetting, makeLineDue, savePuzzle, setSetting } from '../srs/db';
import type { GameRow } from '../srs/types';
import { analyzeGame } from './analyze';
import { bookReport } from './book';
import { loadOpenings, nameOpening, type OpeningBook } from './openings';
import { plyClocks, parseTimeControl } from './clock';

export function withBook(row: GameRow, openings?: OpeningBook): GameRow {
  try {
    const plies = parseGamePgn(row.pgn);
    const named = openings ? nameOpening(plies, openings) : null;
    return {
      ...row,
      book: bookReport(plies, row.userColor),
      opening: named ? { eco: named.eco, name: named.name } : row.opening,
    };
  } catch {
    return row; // unparseable PGN: keep the game, skip the report
  }
}

/** Names the opening of games imported before openings were stored. Returns how many were filled. */
export async function ensureOpenings(): Promise<number> {
  const missing = await db.games.filter((g) => !g.opening).toArray();
  if (!missing.length) return 0;
  const openings = await loadOpenings().catch(() => undefined);
  if (!openings) return 0;
  let n = 0;
  for (const g of missing) {
    try {
      const named = nameOpening(parseGamePgn(g.pgn), openings);
      if (!named) continue;
      await db.games.update(g.id, { opening: { eco: named.eco, name: named.name } });
      n++;
    } catch {
      /* unparseable PGN */
    }
  }
  return n;
}

/**
 * Imports new games and requeues the repertoire lines you went wrong in.
 * Only lines you've already started: an unlearned line isn't a memory lapse.
 */
export async function importChessCom(username: string, months = 3): Promise<{ added: number; requeued: number }> {
  // After the first import, only fetch from the month of your newest game on,
  // unless you've asked for a longer history than last time.
  const me = username.toLowerCase();
  const prev = await getSetting<{ user: string; months: number }>('imported');
  const newest = await db.games
    .orderBy('endTime')
    .reverse()
    .filter((g) => g.source === 'chesscom' && (g.white.toLowerCase() === me || g.black.toLowerCase() === me))
    .first();
  const incremental = newest && prev?.user === me && prev.months >= months;
  const rows = await fetchRecentGames(username, months, incremental ? newest.endTime : undefined);
  const existing = new Set(await db.games.where('id').anyOf(rows.map((r) => r.id)).primaryKeys());
  const openings = await loadOpenings().catch(() => undefined);
  const fresh = rows.filter((r) => !existing.has(r.id)).map((r) => withBook(r, openings));
  await db.games.bulkAdd(fresh);
  await setSetting('imported', { user: me, months: Math.max(months, prev?.user === me ? prev.months : 0) });

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
  const openings = await loadOpenings().catch(() => undefined); // names are a nice-to-have
  const clocks = plyClocks(g.pgn, plies.length);
  const tc = parseTimeControl(g.pgn);
  const analysis = await analyzeGame(plies, g.userColor, onProgress, openings, clocks && tc ? { tc, plies: clocks } : null);
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
