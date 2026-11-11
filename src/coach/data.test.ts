import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { liveQuery } from 'dexie';
import { createEmptyCard, Rating } from 'ts-fsrs';
import { DEFAULT_FOCUS } from '../focus';
import { ANALYSIS_VERSION } from '../games/analyze';
import { allLines } from '../repertoire';
import { addLine, db, recordPuzzle, recordReview, savePuzzle, setSetting } from '../srs/db';
import type { GameAnalysis, GameRow } from '../srs/types';
import { dayKey } from '../streak';
import { computeCoach, GAME_CHUNK, gamesKey, readGames, readLight, resetCoachCache } from './data';
import { slimGame } from './slim';

const HOUR = 3_600_000;
const base = new Date(2026, 0, 1).getTime();

const analysis = (): GameAnalysis => ({
  version: ANALYSIS_VERSION,
  depth: 12,
  evals: [0, 30, -400],
  moves: [
    { cls: 'book', drop: 0, best: 'e2e4', pv: ['e2e4'] },
    { cls: 'blunder', drop: 45, best: 'g8f6', pv: ['g8f6'], kind: 'hung-piece' },
  ],
  accuracy: 64,
  blunders: 1,
  mistakes: 0,
  analyzedAt: new Date(base),
});

const row = (i: number, over: Partial<GameRow> = {}): GameRow => ({
  id: `game-${String(i).padStart(4, '0')}`,
  source: 'chesscom',
  pgn: '1. e4 e5 2. Nf3 Nc6 *',
  white: 'me',
  black: `opp${i}`,
  userColor: 'white',
  result: i % 3 === 0 ? 'loss' : 'win',
  timeClass: 'blitz',
  // Deliberately not in id order, so the sort is what puts them newest first.
  endTime: new Date(base + ((i * 7) % 1000) * HOUR),
  ...over,
});

beforeEach(async () => {
  await Promise.all([db.games.clear(), db.cards.clear(), db.reviews.clear(), db.puzzles.clear(), db.attempts.clear(), db.settings.clear()]);
  resetCoachCache();
});

/** Subscribes the way useLiveQuery does and collects every emission. */
function watch<T>(query: () => Promise<T>) {
  const seen: T[] = [];
  const errors: unknown[] = [];
  const sub = liveQuery(query).subscribe({ next: (v) => seen.push(v), error: (e) => errors.push(e) });
  return { seen, errors, stop: () => sub.unsubscribe() };
}

async function until(cond: () => boolean, ms = 3000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting for the live query');
    await new Promise((r) => setTimeout(r, 5));
  }
}
const settle = () => new Promise((r) => setTimeout(r, 60));

describe('readGames', () => {
  it('reads every game across chunks, newest first, as slim rows', async () => {
    const n = GAME_CHUNK * 2 + 50;
    await db.games.bulkAdd(Array.from({ length: n }, (_, i) => row(i, i % 10 === 0 ? { analysis: analysis() } : {})));
    const { games, key } = await readGames();
    expect(games).toHaveLength(n);
    expect(new Set(games.map((g) => g.id)).size).toBe(n);
    for (let i = 1; i < games.length; i++) expect(games[i - 1].at).toBeGreaterThanOrEqual(games[i].at);
    expect(games.every((g) => !('pgn' in g) && !('analysis' in g))).toBe(true);
    expect(games.filter((g) => g.a).length).toBe(n / 10);
    expect(key).toBe(gamesKey(games));
  });

  it('handles an empty table and an exact multiple of the chunk size', async () => {
    expect(await readGames()).toEqual({ games: [], key: gamesKey([]) });
    await db.games.bulkAdd(Array.from({ length: GAME_CHUNK }, (_, i) => row(i)));
    expect((await readGames()).games).toHaveLength(GAME_CHUNK);
  });

  it('changes its key when a game is analysed, added or marked unreadable', async () => {
    await db.games.bulkAdd([row(1), row(2)]);
    const before = (await readGames()).key;
    expect((await readGames()).key).toBe(before);

    await db.games.update(row(1).id, { analysis: analysis() });
    const analysed = (await readGames()).key;
    expect(analysed).not.toBe(before);

    await db.games.add(row(3));
    const added = (await readGames()).key;
    expect(added).not.toBe(analysed);

    await db.games.update(row(2).id, { unreadable: true });
    expect((await readGames()).key).not.toBe(added);
  });
});

describe('readLight', () => {
  it('starts from sensible defaults', async () => {
    const l = await readLight();
    expect(l).toMatchObject({
      attempts: [],
      cards: [],
      trainedAt: [],
      reviewsToday: 0,
      attemptsToday: 0,
      puzzlesDue: 0,
      puzzlesTotal: 0,
      puzzlesReviewedToday: 0,
      sparredToday: false,
      endgameToday: false,
      endgamesWon: [],
      puzzleRating: 800,
    });
    expect(l.focus).toEqual(DEFAULT_FOCUS);
  });

  it('reads drill cards and today’s reviews, ignoring orphaned cards', async () => {
    const line = allLines[0];
    await addLine(line);
    await recordReview(line.id, Rating.Good, 0);
    await db.cards.add({ lineId: 'gone:e4 e5', repertoireId: 'gone', card: createEmptyCard(new Date()), addedAt: new Date() });
    await db.reviews.add({ lineId: line.id, rating: Rating.Good, mistakes: 0, at: new Date(Date.now() - 3 * 24 * HOUR) });

    const l = await readLight();
    expect(l.cards).toHaveLength(1);
    expect(l.cards[0]).toMatchObject({ lineId: line.id, repId: line.repertoireId });
    expect(l.cards[0].lastReview).toBeGreaterThan(0);
    expect(l.cards[0].due).toBeGreaterThan(Date.now());
    expect(l.reviewsToday).toBe(1);
    expect(l.trainedAt).toHaveLength(2);
  });

  it('tells queue reviews from themed attempts', async () => {
    // Two of your own mistakes in the queue; one reviewed today.
    await savePuzzle({ id: 'mine:1', source: 'mine', fen: 'x', moves: ['e2e4'], theme: 'hung-piece' });
    await savePuzzle({ id: 'mine:2', source: 'mine', fen: 'x', moves: ['e2e4'], theme: 'fork' });
    await recordPuzzle({ id: 'mine:1', source: 'mine', theme: 'hung-piece' }, true, true);
    // Two themed attempts. The failed one joins the queue with a fresh card, which is not a review.
    await recordPuzzle({ id: 'lichess:a', source: 'lichess', theme: 'fork' }, true, false);
    await savePuzzle({ id: 'lichess:b', source: 'lichess', fen: 'x', moves: ['a', 'b'], theme: 'pin' });
    await recordPuzzle({ id: 'lichess:b', source: 'lichess', theme: 'pin' }, false, false);
    // Yesterday does not count.
    await db.attempts.add({ puzzleId: 'mine:2', source: 'mine', theme: 'fork', solved: true, at: new Date(Date.now() - 30 * HOUR) });

    const l = await readLight();
    expect(l.attempts).toHaveLength(4);
    expect(l.attemptsToday).toBe(3);
    expect(l.puzzlesReviewedToday).toBe(1);
    expect(l.puzzlesDue).toBe(2); // mine:2 and the failed themed one; mine:1 was rescheduled
    expect(l.puzzlesTotal).toBe(3);
    expect(l.trainedAt).toHaveLength(4);
  });

  it('counts a repeat review, and a themed puzzle reviewed after it was failed', async () => {
    // One of your own mistakes, failed and then solved on a second pass.
    await savePuzzle({ id: 'mine:1', source: 'mine', fen: 'x', moves: ['e2e4'], theme: 'hung-piece' });
    await recordPuzzle({ id: 'mine:1', source: 'mine', theme: 'hung-piece' }, false, true);
    await recordPuzzle({ id: 'mine:1', source: 'mine', theme: 'hung-piece' }, true, true);
    // A themed puzzle failed ten minutes ago (which put it in the queue), reviewed from the queue just now.
    const earlier = new Date(Date.now() - 10 * 60_000);
    await savePuzzle({ id: 'lichess:b', source: 'lichess', fen: 'x', moves: ['a', 'b'], theme: 'pin' });
    await db.puzzles.update('lichess:b', { addedAt: earlier });
    await db.attempts.add({ puzzleId: 'lichess:b', source: 'lichess', theme: 'pin', solved: false, at: earlier });
    await recordPuzzle({ id: 'lichess:b', source: 'lichess', theme: 'pin' }, true, true);
    // And one more themed try at a puzzle that is not in the queue.
    await recordPuzzle({ id: 'lichess:c', source: 'lichess', theme: 'pin' }, true, false);

    const l = await readLight();
    if (earlier.getTime() >= new Date().setHours(0, 0, 0, 0)) {
      expect(l.attemptsToday).toBe(5);
      expect(l.puzzlesReviewedToday).toBe(3); // two passes at mine:1, one review of lichess:b
    } else {
      // Run in the first ten minutes of a day: the failed themed try was yesterday.
      expect(l.attemptsToday).toBe(4);
      expect(l.puzzlesReviewedToday).toBe(3);
    }
  });

  it('reads the spar, endgame, focus and rating settings', async () => {
    const today = dayKey(new Date());
    await setSetting('lastSpar', today);
    await setSetting('endgameWins', { 'kq-k': '2020-1-1', lucena: today });
    await setSetting('focus', ['black-caro', 'no-such-opening']);
    await setSetting('puzzleRating', 1234);
    expect(await readLight()).toMatchObject({
      sparredToday: true,
      endgameToday: true,
      endgamesWon: ['kq-k', 'lucena'],
      focus: ['black-caro'],
      puzzleRating: 1234,
    });

    await setSetting('lastSpar', '2020-1-1');
    await setSetting('endgameWins', { 'kq-k': '2020-1-1' });
    expect(await readLight()).toMatchObject({ sparredToday: false, endgameToday: false });
  });
});

describe('computeCoach', () => {
  it('gives a new player the onboarding plan', async () => {
    const r = computeCoach(await readGames(), await readLight());
    expect(r.plan.onboarding).toBe(true);
    expect(r.plan.steps.map((s) => s.id)).toEqual(['learn', 'import', 'play']);
    expect(r.plan.steps[0].to).toBe(`/learn/${DEFAULT_FOCUS[0]}/0`);
    expect(r.profile.sample).toEqual({ games: 0, analysed: 0, window: 0, stale: 0 });
    expect(r.trends.series).toEqual([]);
    expect(r.motifs.recommended.theme).toBe('mixed');
    expect(r.streak).toBe(0);
    expect(r.counts).toEqual({
      games: 0,
      analysed: 0,
      toAnalyse: 0,
      linesTotal: allLines.length,
      linesStarted: 0,
      linesDue: 0,
      linesKnown: 0,
      puzzlesDue: 0,
      puzzlesTotal: 0,
      attempts: 0,
      solved: 0,
      attemptsToday: 0,
      puzzleRating: 800,
    });
  });

  it('joins games, lines and puzzles into one plan and set of counts', async () => {
    await db.games.bulkAdd([
      ...Array.from({ length: 9 }, (_, i) => row(i, { analysis: analysis(), endTime: new Date(Date.now() - (20 - i) * HOUR) })),
      row(50, { endTime: new Date(Date.now() - HOUR), result: 'loss' }),
      row(51, { endTime: new Date(Date.now() - 40 * HOUR), unreadable: true }),
      row(52, { endTime: new Date(Date.now() - 41 * HOUR), analysis: { ...analysis(), version: ANALYSIS_VERSION - 1 } }),
    ]);
    await addLine(allLines[0]); // due straight away
    await savePuzzle({ id: 'mine:1', source: 'mine', fen: 'x', moves: ['e2e4'], theme: 'hung-piece' });
    await recordPuzzle({ id: 'lichess:a', source: 'lichess', theme: 'fork' }, true, false);

    const r = computeCoach(await readGames(), await readLight());
    expect(r.plan.onboarding).toBe(false);
    expect(r.plan.steps.map((s) => s.id)).toEqual(['drill', 'mistakes', 'puzzles', 'review', 'spar']);
    expect(r.plan.steps[3].to).toBe(`/games/${row(50).id}`);
    // Nine analysed games, a hung piece in every one: that is the weakness, and it steers the puzzles.
    expect(r.profile.top.map((s) => s.id)).toEqual(['hung']);
    expect(r.motifs.recommended).toMatchObject({ theme: 'hangingPiece', source: 'games' });
    expect(r.plan.steps[2].to).toBe('/puzzles?theme=hangingPiece');
    expect(r.trends.series).toHaveLength(9);
    expect(r.streak).toBe(1);
    expect(r.counts).toMatchObject({ games: 12, analysed: 9, toAnalyse: 2, linesStarted: 1, linesDue: 1, linesKnown: 0, puzzlesDue: 1, attempts: 1, solved: 1, attemptsToday: 1 });
  });

  it('reuses the profile and trends while the games are unchanged', async () => {
    await db.games.bulkAdd(Array.from({ length: 3 }, (_, i) => row(i, { analysis: analysis() })));
    const games = await readGames();
    const a = computeCoach(games, await readLight());
    await recordPuzzle({ id: 'lichess:a', source: 'lichess', theme: 'fork' }, true, false);
    const b = computeCoach(await readGames(), await readLight());
    expect(b.profile).toBe(a.profile);
    expect(b.trends).toBe(a.trends);
    expect(b.motifs.overall.attempts).toBe(1);

    await db.games.add(row(9, { analysis: analysis() }));
    const c = computeCoach(await readGames(), await readLight());
    expect(c.profile).not.toBe(a.profile);
    expect(c.trends.series).toHaveLength(4);
  });

  it('never keeps a PGN in memory beyond the slim projection', () => {
    const slim = slimGame(row(1, { analysis: analysis() }));
    expect(JSON.stringify(slim)).not.toContain('Nf3');
    expect(Object.keys(slim.a ?? {})).not.toContain('evals');
  });
});

describe('as live queries', () => {
  it('re-reads the games when one is analysed or added, in any chunk', async () => {
    const n = GAME_CHUNK + 50;
    await db.games.bulkAdd(Array.from({ length: n }, (_, i) => row(i)));
    const w = watch(readGames);
    try {
      await until(() => w.seen.length === 1);
      expect(w.seen[0].games).toHaveLength(n);

      await db.games.update(row(3).id, { analysis: analysis() }); // first chunk
      await until(() => w.seen.length === 2);
      expect(w.seen[1].key).not.toBe(w.seen[0].key);

      await db.games.update(row(n - 1).id, { analysis: analysis() }); // last chunk
      await until(() => w.seen.length === 3);
      expect(w.seen[2].games.filter((g) => g.a)).toHaveLength(2);

      await db.games.add(row(9000)); // sorts after every id read so far
      await until(() => w.seen.length === 4);
      expect(w.seen[3].games).toHaveLength(n + 1);
      expect(w.errors).toEqual([]);
    } finally {
      w.stop();
    }
  });

  it('does not re-read the games when a puzzle or a drill is recorded', async () => {
    await db.games.bulkAdd([row(1), row(2)]);
    await addLine(allLines[0]);
    const w = watch(readGames);
    try {
      await until(() => w.seen.length === 1);
      await recordPuzzle({ id: 'lichess:a', source: 'lichess', theme: 'fork' }, true, false);
      await recordReview(allLines[0].id, Rating.Good, 0);
      await setSetting('lastSpar', dayKey(new Date()));
      await settle();
      expect(w.seen).toHaveLength(1);
    } finally {
      w.stop();
    }
  });

  it('re-reads the small tables when you train, and when an analysis adds a puzzle', async () => {
    const w = watch(() => readLight(new Date()));
    try {
      await until(() => w.seen.length === 1);
      expect(w.seen[0].puzzlesDue).toBe(0);

      // Created after the query ran, as when a background analysis finishes.
      await savePuzzle({ id: 'mine:1', source: 'mine', fen: 'x', moves: ['e2e4'], theme: 'hung-piece' });
      await until(() => w.seen.length >= 2);
      expect(w.seen[w.seen.length - 1]).toMatchObject({ puzzlesDue: 1, puzzlesTotal: 1 });

      const before = w.seen.length;
      await recordPuzzle({ id: 'mine:1', source: 'mine', theme: 'hung-piece' }, true, true);
      await until(() => w.seen.length > before && w.seen[w.seen.length - 1].attemptsToday === 1);
      expect(w.seen[w.seen.length - 1]).toMatchObject({ puzzlesReviewedToday: 1, puzzlesDue: 0 });

      const mid = w.seen.length;
      await setSetting('lastSpar', dayKey(new Date()));
      await until(() => w.seen.length > mid);
      expect(w.seen[w.seen.length - 1].sparredToday).toBe(true);
      expect(w.errors).toEqual([]);
    } finally {
      w.stop();
    }
  });
});
