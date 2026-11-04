import Dexie, { type EntityTable } from 'dexie';
import { createEmptyCard, fsrs, generatorParameters, State, type Card, type Grade } from 'ts-fsrs';
import { getLine, type Line } from '../repertoire';

export interface CardRow {
  lineId: string;
  repertoireId: string;
  card: Card;
  addedAt: Date;
}

export interface ReviewRow {
  id?: number;
  lineId: string;
  rating: Grade;
  mistakes: number;
  at: Date;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

class BlunderlessDB extends Dexie {
  cards!: EntityTable<CardRow, 'lineId'>;
  reviews!: EntityTable<ReviewRow, 'id'>;
  settings!: EntityTable<SettingRow, 'key'>;

  constructor() {
    super('blunderless');
    this.version(1).stores({
      cards: 'lineId, repertoireId, card.due',
      reviews: '++id, lineId, at',
      settings: 'key',
    });
  }
}

export const db = new BlunderlessDB();

const scheduler = fsrs(generatorParameters({ enable_fuzz: true }));

export type LineStatus = 'new' | 'learning' | 'due' | 'known';

export function statusOf(row: CardRow | undefined, now = new Date()): LineStatus {
  if (!row) return 'new';
  if (row.card.due <= now) return 'due';
  return row.card.state === State.Review ? 'known' : 'learning';
}

export async function addLine(line: Line): Promise<void> {
  if (await db.cards.get(line.id)) return;
  await db.cards.add({
    lineId: line.id,
    repertoireId: line.repertoireId,
    card: createEmptyCard(new Date()),
    addedAt: new Date(),
  });
}

export async function recordReview(lineId: string, rating: Grade, mistakes: number): Promise<void> {
  await db.transaction('rw', db.cards, db.reviews, async () => {
    const row = await db.cards.get(lineId);
    if (!row) return;
    const now = new Date();
    const { card } = scheduler.next(row.card, now, rating);
    await db.cards.put({ ...row, card });
    await db.reviews.add({ lineId, rating, mistakes, at: now });
  });
}

/** Due cards whose line still exists (a PGN edit can orphan old ids). */
export async function dueLines(now = new Date()): Promise<Line[]> {
  const rows = await db.cards.where('card.due').belowOrEqual(now).sortBy('card.due');
  return rows.map((r) => getLine(r.lineId)).filter((l): l is Line => !!l);
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  return (await db.settings.get(key))?.value as T | undefined;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}
