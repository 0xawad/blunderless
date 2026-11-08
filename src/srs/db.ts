import Dexie, { type EntityTable } from 'dexie';
import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card, type Grade } from 'ts-fsrs';
import { getLine, type Line } from '../repertoire';
import type { GameRow, PuzzleRow, AttemptRow } from './types';

export type { GameRow, PuzzleRow, AttemptRow } from './types';

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
  failedPlies?: number[];
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
  games!: EntityTable<GameRow, 'id'>;
  puzzles!: EntityTable<PuzzleRow, 'id'>;
  attempts!: EntityTable<AttemptRow, 'id'>;

  constructor() {
    super('blunderless');
    this.version(1).stores({
      cards: 'lineId, repertoireId, card.due',
      reviews: '++id, lineId, at',
      settings: 'key',
    });
    this.version(2).stores({
      games: 'id, endTime',
      puzzles: 'id, source, card.due',
      attempts: '++id, at, source',
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
  await db.transaction('rw', db.cards, async () => {
    if (await db.cards.get(line.id)) return;
    await db.cards.add({
      lineId: line.id,
      repertoireId: line.repertoireId,
      card: createEmptyCard(new Date()),
      addedAt: new Date(),
    });
  });
}

/** Cards whose line still exists; a PGN edit can orphan old ids. */
export async function liveCards(): Promise<CardRow[]> {
  return (await db.cards.toArray()).filter((c) => getLine(c.lineId));
}

export async function recordReview(
  lineId: string,
  rating: Grade,
  mistakes: number,
  failedPlies: number[] = [],
): Promise<void> {
  await db.transaction('rw', db.cards, db.reviews, async () => {
    const row = await db.cards.get(lineId);
    if (!row) return;
    const now = new Date();
    const { card } = scheduler.next(row.card, now, rating);
    await db.cards.put({ ...row, card });
    await db.reviews.add({ lineId, rating, mistakes, failedPlies, at: now });
  });
}

export interface WeakSpot {
  line: Line;
  ply: number;
  misses: number;
}

/** Moves you keep getting wrong in drills, most-missed first. */
export async function weakSpots(repertoireId?: string, limit = 8): Promise<WeakSpot[]> {
  const counts = new Map<string, number>();
  for (const r of await db.reviews.toArray()) {
    for (const ply of r.failedPlies ?? []) {
      const k = `${r.lineId}\u0000${ply}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  const spots: WeakSpot[] = [];
  for (const [k, misses] of counts) {
    const [lineId, ply] = k.split('\u0000');
    const line = getLine(lineId);
    if (line && (!repertoireId || line.repertoireId === repertoireId)) spots.push({ line, ply: Number(ply), misses });
  }
  return spots.sort((a, b) => b.misses - a.misses).slice(0, limit);
}

/** Due cards whose line still exists (a PGN edit can orphan old ids). */
export async function dueLines(now = new Date()): Promise<Line[]> {
  const rows = await db.cards.where('card.due').belowOrEqual(now).sortBy('card.due');
  return rows.map((r) => getLine(r.lineId)).filter((l): l is Line => !!l);
}

/** Puts a line back in front of you now (used when a real game shows you forgot it). */
export async function makeLineDue(line: Line): Promise<void> {
  const row = await db.cards.get(line.id);
  if (!row) return addLine(line);
  await db.cards.put({ ...row, card: { ...row.card, due: new Date() } });
}

/** Adds a puzzle unless it's already there. Returns true if it was new. */
export async function savePuzzle(p: Omit<PuzzleRow, 'card' | 'addedAt'>): Promise<boolean> {
  return db.transaction('rw', db.puzzles, async () => {
    if (await db.puzzles.get(p.id)) return false;
    await db.puzzles.add({ ...p, card: createEmptyCard(new Date()), addedAt: new Date() });
    return true;
  });
}

export async function recordPuzzle(
  p: Pick<PuzzleRow, 'id' | 'source' | 'theme'>,
  solved: boolean,
  schedule: boolean,
): Promise<void> {
  await db.transaction('rw', db.puzzles, db.attempts, async () => {
    const now = new Date();
    if (schedule) {
      const row = await db.puzzles.get(p.id);
      if (row) {
        const { card } = scheduler.next(row.card, now, solved ? Rating.Good : Rating.Again);
        await db.puzzles.put({ ...row, card });
      }
    }
    await db.attempts.add({ puzzleId: p.id, source: p.source, theme: p.theme, solved, at: now });
  });
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  return (await db.settings.get(key))?.value as T | undefined;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  if (value === undefined || value === '') await db.settings.delete(key);
  else await db.settings.put({ key, value });
}
