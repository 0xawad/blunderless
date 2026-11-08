import { State, type Card } from 'ts-fsrs';
import { db, type AttemptRow, type CardRow, type GameRow, type PuzzleRow, type ReviewRow, type SettingRow } from './db';

// v2 adds puzzles and attempts. v3 adds games: the ones you played here can't
// be re-imported, and every analysis is minutes of engine time.
const VERSION = 3;
const SETTING_KEYS = new Set(['username', 'onboarded', 'puzzleRating', 'importMonths', 'focus', 'endgameWins', 'lastSpar', 'imported']);
const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const FEN_RE = /^[1-8pnbrqkPNBRQK/]{15,71} [wb] [KQkq-]{1,4} [a-h1-8-]{1,2} \d+ \d+$/;

export async function exportBackup(): Promise<Blob> {
  const data = {
    app: 'blunderless',
    version: VERSION,
    exportedAt: new Date().toISOString(),
    cards: await db.cards.toArray(),
    reviews: await db.reviews.toArray(),
    settings: await db.settings.toArray(),
    puzzles: await db.puzzles.toArray(),
    attempts: await db.attempts.toArray(),
    games: await db.games.toArray(),
  };
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isStr = (v: unknown, max = 500): v is string => typeof v === 'string' && v.length <= max;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function toDate(v: unknown): Date {
  const d = new Date(v as string);
  if (!isStr(v, 64) || Number.isNaN(d.getTime())) throw new Error('bad date');
  return d;
}

function parseCard(v: unknown): Card {
  if (!isObj(v)) throw new Error('bad card');
  const nums = ['stability', 'difficulty', 'elapsed_days', 'scheduled_days', 'reps', 'lapses', 'learning_steps'] as const;
  for (const k of nums) if (!isNum(v[k])) throw new Error(`bad card.${k}`);
  if (!isNum(v.state) || !(v.state in State)) throw new Error('bad card.state');
  return {
    due: toDate(v.due),
    stability: v.stability as number,
    difficulty: v.difficulty as number,
    elapsed_days: v.elapsed_days as number,
    scheduled_days: v.scheduled_days as number,
    reps: v.reps as number,
    lapses: v.lapses as number,
    learning_steps: v.learning_steps as number,
    state: v.state as State,
    last_review: v.last_review == null ? undefined : toDate(v.last_review),
  };
}

/** A stored game, checked field by field; the analysis is checked for shape and size only. */
function parseGame(v: unknown): GameRow {
  if (!isObj(v) || !isStr(v.id, 300) || (v.source !== 'chesscom' && v.source !== 'local') || !isStr(v.pgn, 100_000)) {
    throw new Error('bad game row');
  }
  if (!isStr(v.white, 60) || !isStr(v.black, 60) || (v.userColor !== 'white' && v.userColor !== 'black')) throw new Error('bad game players');
  if (v.result !== 'win' && v.result !== 'loss' && v.result !== 'draw') throw new Error('bad game result');
  const g: GameRow = {
    id: v.id,
    source: v.source,
    pgn: v.pgn,
    white: v.white,
    black: v.black,
    userColor: v.userColor,
    result: v.result,
    timeClass: isStr(v.timeClass, 20) ? v.timeClass : 'unknown',
    endTime: toDate(v.endTime),
  };
  if (isStr(v.url, 300) && v.url.startsWith('https://www.chess.com/')) g.url = v.url;
  if (isNum(v.whiteElo)) g.whiteElo = v.whiteElo;
  if (isNum(v.blackElo)) g.blackElo = v.blackElo;
  if (v.unreadable === true) g.unreadable = true;
  if (isObj(v.opening) && isStr(v.opening.eco, 8) && isStr(v.opening.name, 200)) g.opening = { eco: v.opening.eco, name: v.opening.name };
  if (isObj(v.book) && isStr(v.book.status, 20) && isNum(v.book.ply)) g.book = v.book as unknown as GameRow["book"];
  const a = v.analysis;
  if (isObj(a) && isNum(a.depth) && Array.isArray(a.evals) && a.evals.length <= 1000 && a.evals.every(isNum) &&
    Array.isArray(a.moves) && a.moves.length <= 1000 && a.moves.every((m) => isObj(m) && isStr(m.cls, 20) && isNum(m.drop) && isStr(m.best, 6)) &&
    isNum(a.accuracy) && isNum(a.blunders) && isNum(a.mistakes)) {
    g.analysis = { ...(a as unknown as NonNullable<GameRow['analysis']>), analyzedAt: toDate(a.analyzedAt) };
  }
  return g;
}

/** Validates the whole file before touching the database; all or nothing. */
export async function importBackup(text: string): Promise<number> {
  if (text.length > 60_000_000) throw new Error('file too large');
  const data: unknown = JSON.parse(text);
  if (!isObj(data) || data.app !== 'blunderless' || !isNum(data.version) || data.version < 1 || data.version > VERSION) throw new Error('not a backup');
  if (!Array.isArray(data.cards) || !Array.isArray(data.reviews) || !Array.isArray(data.settings)) {
    throw new Error('missing tables');
  }

  const cards: CardRow[] = data.cards.map((c: unknown) => {
    if (!isObj(c) || !isStr(c.lineId) || !isStr(c.repertoireId, 64)) throw new Error('bad card row');
    return { lineId: c.lineId, repertoireId: c.repertoireId, card: parseCard(c.card), addedAt: toDate(c.addedAt) };
  });
  const reviews: ReviewRow[] = data.reviews.map((r: unknown) => {
    if (!isObj(r) || !isStr(r.lineId) || !isNum(r.rating) || r.rating < 1 || r.rating > 4 || !isNum(r.mistakes)) {
      throw new Error('bad review row');
    }
    // failedPlies feed the weak-spots lists; keep them across a restore.
    const failedPlies = Array.isArray(r.failedPlies) && r.failedPlies.length <= 60 && r.failedPlies.every((n) => isNum(n) && n >= 0 && n < 200)
      ? (r.failedPlies as number[])
      : undefined;
    return { lineId: r.lineId, rating: r.rating as ReviewRow['rating'], mistakes: r.mistakes, failedPlies, at: toDate(r.at) };
  });
  const puzzles: PuzzleRow[] = (Array.isArray(data.puzzles) ? data.puzzles : []).map((p: unknown) => {
    if (
      !isObj(p) || !isStr(p.id, 300) || (p.source !== 'mine' && p.source !== 'lichess') ||
      !isStr(p.fen, 100) || !FEN_RE.test(p.fen) || !isStr(p.theme, 40) ||
      !Array.isArray(p.moves) || p.moves.length > 40 || !p.moves.every((m) => isStr(m, 5) && UCI_RE.test(m))
    ) {
      throw new Error('bad puzzle row');
    }
    return {
      id: p.id,
      source: p.source,
      fen: p.fen,
      moves: p.moves as string[],
      theme: p.theme,
      rating: isNum(p.rating) ? p.rating : undefined,
      gameId: isStr(p.gameId, 300) ? p.gameId : undefined,
      ply: isNum(p.ply) ? p.ply : undefined,
      card: parseCard(p.card),
      addedAt: toDate(p.addedAt),
    };
  });
  const attempts: AttemptRow[] = (Array.isArray(data.attempts) ? data.attempts : []).map((a: unknown) => {
    if (!isObj(a) || !isStr(a.puzzleId, 300) || (a.source !== 'mine' && a.source !== 'lichess') ||
      !isStr(a.theme, 40) || typeof a.solved !== 'boolean') {
      throw new Error('bad attempt row');
    }
    return { puzzleId: a.puzzleId, source: a.source, theme: a.theme, solved: a.solved, at: toDate(a.at) };
  });
  const settings: SettingRow[] = data.settings
    .filter(
      (s: unknown): s is Record<string, unknown> =>
        isObj(s) && isStr(s.key, 64) && SETTING_KEYS.has(s.key) && s.value !== undefined,
    )
    .map((s) => {
      if (s.key === 'username' && !isStr(s.value, 25)) throw new Error('bad username');
      if (s.key === 'onboarded' && typeof s.value !== 'boolean') throw new Error('bad onboarded');
      if (s.key === 'puzzleRating' && !isNum(s.value)) throw new Error('bad puzzleRating');
      if (s.key === 'importMonths' && !isNum(s.value)) throw new Error('bad importMonths');
      if (s.key === 'lastSpar' && !isStr(s.value, 16)) throw new Error('bad lastSpar');
      if (s.key === 'imported' && !(isObj(s.value) && isStr(s.value.user, 25) && isNum(s.value.months))) throw new Error('bad imported');
      if (s.key === 'endgameWins' && !(isObj(s.value) && Object.keys(s.value).length <= 100 &&
        Object.entries(s.value).every(([k, v]) => isStr(k, 64) && isStr(v, 16)))) {
        throw new Error('bad endgameWins');
      }
      if (s.key === 'focus' && !(Array.isArray(s.value) && s.value.length <= 8 && s.value.every((v) => isStr(v, 64)))) {
        throw new Error('bad focus');
      }
      return { key: s.key as string, value: s.value };
    });

  const games: GameRow[] = (Array.isArray(data.games) ? data.games : []).map(parseGame);

  const hasPuzzles = data.version >= 2; // v1 backups never had puzzles; keep the current ones
  await db.transaction('rw', [db.cards, db.reviews, db.settings, db.puzzles, db.attempts, db.games], async () => {
    await Promise.all([db.cards.clear(), db.reviews.clear()]);
    await db.cards.bulkPut(cards);
    await db.reviews.bulkAdd(reviews);
    if (hasPuzzles) {
      await Promise.all([db.puzzles.clear(), db.attempts.clear()]);
      await db.puzzles.bulkPut(puzzles);
      await db.attempts.bulkAdd(attempts);
    }
    await db.settings.bulkPut(settings);
    // Games merge by id: a restore adds what's missing and never deletes what you have.
    if (games.length) await db.games.bulkPut(games);
  });
  return cards.length;
}

export async function resetAll(): Promise<void> {
  await db.transaction('rw', [db.cards, db.reviews, db.puzzles, db.attempts, db.games], async () => {
    await Promise.all([db.cards.clear(), db.reviews.clear(), db.puzzles.clear(), db.attempts.clear(), db.games.clear()]);
  });
}
