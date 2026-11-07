import { State, type Card } from 'ts-fsrs';
import { db, type AttemptRow, type CardRow, type PuzzleRow, type ReviewRow, type SettingRow } from './db';

// v2 adds puzzles and attempts. Games aren't included: they re-import from
// Chess.com and re-analyse.
const VERSION = 2;
const SETTING_KEYS = new Set(['username', 'onboarded', 'puzzleRating']);
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
  // ts-fsrs 6 dropped elapsed_days; older backups still carry it and it's ignored.
  const nums = ['stability', 'difficulty', 'scheduled_days', 'reps', 'lapses', 'learning_steps'] as const;
  for (const k of nums) if (!isNum(v[k])) throw new Error(`bad card.${k}`);
  if (!isNum(v.state) || !(Object.values(State) as number[]).includes(v.state)) throw new Error('bad card.state');
  return {
    due: toDate(v.due),
    stability: v.stability as number,
    difficulty: v.difficulty as number,
    scheduled_days: v.scheduled_days as number,
    reps: v.reps as number,
    lapses: v.lapses as number,
    learning_steps: v.learning_steps as number,
    state: v.state as State,
    last_review: v.last_review == null ? undefined : toDate(v.last_review),
  };
}

/** Validates the whole file before touching the database; all or nothing. */
export async function importBackup(text: string): Promise<number> {
  if (text.length > 20_000_000) throw new Error('file too large');
  const data: unknown = JSON.parse(text);
  if (!isObj(data) || data.app !== 'blunderless' || (data.version !== 1 && data.version !== VERSION)) throw new Error('not a backup');
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
    return { lineId: r.lineId, rating: r.rating as ReviewRow['rating'], mistakes: r.mistakes, at: toDate(r.at) };
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
      return { key: s.key as string, value: s.value };
    });

  const hasPuzzles = data.version >= 2; // v1 backups never had puzzles; keep the current ones
  await db.transaction('rw', [db.cards, db.reviews, db.settings, db.puzzles, db.attempts], async () => {
    await Promise.all([db.cards.clear(), db.reviews.clear()]);
    await db.cards.bulkPut(cards);
    await db.reviews.bulkAdd(reviews);
    if (hasPuzzles) {
      await Promise.all([db.puzzles.clear(), db.attempts.clear()]);
      await db.puzzles.bulkPut(puzzles);
      await db.attempts.bulkAdd(attempts);
    }
    await db.settings.bulkPut(settings);
  });
  return cards.length;
}

export async function resetAll(): Promise<void> {
  await db.transaction('rw', [db.cards, db.reviews, db.puzzles, db.attempts, db.games], async () => {
    await Promise.all([db.cards.clear(), db.reviews.clear(), db.puzzles.clear(), db.attempts.clear(), db.games.clear()]);
  });
}
