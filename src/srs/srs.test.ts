import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Rating } from 'ts-fsrs';
import { allLines, getRepertoire } from '../repertoire';
import { Drill } from './drill';
import { addLine, db, dueLines, recordReview, statusOf } from './db';
import { exportBackup, importBackup } from './backup';

const italian = getRepertoire('white-italian')!;
const caro = getRepertoire('black-caro')!;

function playThrough(d: Drill, wrongFirst = 0) {
  while (!d.done) {
    if (!d.isUserTurn) {
      d.playOpponent();
      continue;
    }
    for (let i = 0; i < wrongFirst; i++) expect(d.attempt('a2', 'a3')).toBe('wrong');
    wrongFirst = 0;
    const p = d.current!;
    expect(d.attempt(p.from, p.to)).toBe('correct');
  }
}

describe('Drill', () => {
  it('lets White move first and grades a clean run Good', () => {
    const d = new Drill(italian.lines[0], 'white');
    expect(d.isUserTurn).toBe(true);
    playThrough(d);
    expect(d.grade()).toBe(Rating.Good);
  });

  it('starts with the opponent as Black', () => {
    const d = new Drill(caro.lines[0], 'black');
    expect(d.isUserTurn).toBe(false);
    expect(d.playOpponent().san).toBe('e4');
    expect(d.isUserTurn).toBe(true);
  });

  it('reveals after two misses and grades it Again', () => {
    const d = new Drill(italian.lines[0], 'white');
    d.attempt('a2', 'a3');
    expect(d.revealed).toBe(false);
    d.attempt('a2', 'a3');
    expect(d.revealed).toBe(true);
    playThrough(d);
    expect(d.grade()).toBe(Rating.Again);
  });

  it('grades one slip as Hard', () => {
    const d = new Drill(italian.lines[0], 'white');
    playThrough(d, 1);
    expect(d.grade()).toBe(Rating.Hard);
  });
});

describe('scheduling and backup', () => {
  beforeEach(async () => {
    await Promise.all([db.cards.clear(), db.reviews.clear(), db.settings.clear()]);
  });

  it('new lines are due straight away, and a good review pushes them out', async () => {
    const line = allLines[0];
    await addLine(line);
    expect((await dueLines()).map((l) => l.id)).toEqual([line.id]);
    await recordReview(line.id, Rating.Good, 0);
    await recordReview(line.id, Rating.Good, 0);
    const row = await db.cards.get(line.id);
    expect(statusOf(row)).not.toBe('due');
    expect(await db.reviews.count()).toBe(2);
  });

  it('round-trips a backup', async () => {
    await addLine(allLines[0]);
    await addLine(allLines[1]);
    await recordReview(allLines[0].id, Rating.Hard, 1);
    const text = await (await exportBackup()).text();
    await db.cards.clear();
    expect(await importBackup(text)).toBe(2);
    const row = await db.cards.get(allLines[0].id);
    expect(row?.card.due).toBeInstanceOf(Date);
    expect(row?.card.reps).toBe(1);
  });

  it('rejects junk without touching existing data', async () => {
    await addLine(allLines[0]);
    await expect(importBackup('{"app":"nope"}')).rejects.toThrow();
    await expect(
      importBackup(JSON.stringify({ app: 'blunderless', version: 1, cards: [{ lineId: 1 }], reviews: [], settings: [] })),
    ).rejects.toThrow();
    expect(await db.cards.count()).toBe(1);
  });
});
