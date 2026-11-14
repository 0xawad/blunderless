import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyCard, Rating } from 'ts-fsrs';
import { rekeyOrphans } from './migrate';
import { allLines } from './index';
import { db, migrateOrphanLines } from '../srs/db';

const live = ['r:e4 e5 Nf3 Nc6 Bc4 Bc5 c3', 'r:e4 e5 Nf3 Nc6 Bc4 Nf6 d3', 'r:e4 c5 c3 d5 exd5', 'other:d4 d5 c4 c6'];

describe('rekeyOrphans', () => {
  it('follows a line that was extended', () => {
    expect([...rekeyOrphans(['r:e4 e5 Nf3 Nc6 Bc4 Bc5'], live)]).toEqual([['r:e4 e5 Nf3 Nc6 Bc4 Bc5', 'r:e4 e5 Nf3 Nc6 Bc4 Bc5 c3']]);
  });

  it('follows a line that was shortened', () => {
    expect(rekeyOrphans(['r:e4 c5 c3 d5 exd5 Qxd5 d4'], live).get('r:e4 c5 c3 d5 exd5 Qxd5 d4')).toBe('r:e4 c5 c3 d5 exd5');
  });

  it('leaves an orphan alone when two live lines continue it', () => {
    expect(rekeyOrphans(['r:e4 e5 Nf3 Nc6 Bc4'], live).size).toBe(0);
  });

  it('never crosses repertoires, and ignores stubs', () => {
    expect(rekeyOrphans(['other:e4 e5 Nf3 Nc6 Bc4 Bc5'], live).size).toBe(0);
    expect(rekeyOrphans(['r:e4 c5'], live).size).toBe(0);
  });

  it('does not overwrite a card the live line already has', () => {
    const cards = ['r:e4 e5 Nf3 Nc6 Bc4 Bc5', 'r:e4 e5 Nf3 Nc6 Bc4 Bc5 c3'];
    expect(rekeyOrphans(cards, live).size).toBe(0);
  });

  it('does not let two orphans claim the same line', () => {
    const cards = ['r:e4 e5 Nf3 Nc6 Bc4 Bc5', 'r:e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6'];
    expect(rekeyOrphans(cards, live).size).toBe(0);
  });

  it('leaves live cards and a changed move alone', () => {
    expect(rekeyOrphans([live[0], 'r:e4 e5 Nf3 Nc6 Bb5 a6 Ba4'], live).size).toBe(0);
  });
});

describe('migrateOrphanLines', () => {
  beforeEach(async () => {
    await Promise.all([db.cards.clear(), db.reviews.clear()]);
  });

  it('moves the card and its reviews to the live line and keeps the schedule', async () => {
    // A real line whose id, one move shorter, is continued by that line alone.
    const shorter = (id: string) => id.split(' ').slice(0, -1).join(' ');
    const line = allLines.find(
      (l) => l.plies.length >= 8 && !allLines.some((x) => x.id === shorter(l.id)) && allLines.filter((x) => x.id.startsWith(shorter(l.id) + ' ')).length === 1,
    );
    expect(line).toBeDefined();
    if (!line) return;
    const old = shorter(line.id);

    const card = { ...createEmptyCard(new Date('2026-01-01')), reps: 5, stability: 12 };
    await db.cards.add({ lineId: old, repertoireId: line.repertoireId, card, addedAt: new Date('2026-01-01') });
    await db.reviews.add({ lineId: old, rating: Rating.Good, mistakes: 0, at: new Date('2026-01-02') });

    expect(await migrateOrphanLines()).toBe(1);
    expect(await db.cards.get(old)).toBeUndefined();
    const moved = await db.cards.get(line.id);
    expect(moved?.card.reps).toBe(5);
    expect(moved?.card.stability).toBe(12);
    expect(await db.reviews.where('lineId').equals(line.id).count()).toBe(1);
    // Running it again changes nothing.
    expect(await migrateOrphanLines()).toBe(0);
  });

  it('does nothing when every card is live', async () => {
    await db.cards.add({ lineId: allLines[0].id, repertoireId: allLines[0].repertoireId, card: createEmptyCard(new Date()), addedAt: new Date() });
    expect(await migrateOrphanLines()).toBe(0);
    expect(await db.cards.count()).toBe(1);
  });
});
