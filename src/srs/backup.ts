import { State, type Card } from 'ts-fsrs';
import { db, type CardRow, type ReviewRow, type SettingRow } from './db';

const VERSION = 1;
const SETTING_KEYS = new Set(['username', 'onboarded']);

export async function exportBackup(): Promise<Blob> {
  const data = {
    app: 'blunderless',
    version: VERSION,
    exportedAt: new Date().toISOString(),
    cards: await db.cards.toArray(),
    reviews: await db.reviews.toArray(),
    settings: await db.settings.toArray(),
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

/** Validates the whole file before touching the database; all or nothing. */
export async function importBackup(text: string): Promise<number> {
  if (text.length > 20_000_000) throw new Error('file too large');
  const data: unknown = JSON.parse(text);
  if (!isObj(data) || data.app !== 'blunderless' || data.version !== VERSION) throw new Error('not a backup');
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
  const settings: SettingRow[] = data.settings
    .filter((s: unknown): s is Record<string, unknown> => isObj(s) && isStr(s.key, 64) && SETTING_KEYS.has(s.key))
    .map((s) => {
      if (s.key === 'username' && !isStr(s.value, 25)) throw new Error('bad username');
      if (s.key === 'onboarded' && typeof s.value !== 'boolean') throw new Error('bad onboarded');
      return { key: s.key as string, value: s.value };
    });

  await db.transaction('rw', db.cards, db.reviews, db.settings, async () => {
    await Promise.all([db.cards.clear(), db.reviews.clear()]);
    await db.cards.bulkPut(cards);
    await db.reviews.bulkAdd(reviews);
    await db.settings.bulkPut(settings);
  });
  return cards.length;
}

export async function resetAll(): Promise<void> {
  await db.transaction('rw', db.cards, db.reviews, async () => {
    await Promise.all([db.cards.clear(), db.reviews.clear()]);
  });
}
