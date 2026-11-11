import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, setSetting, getSetting } from './db';
import { exportBackup, importBackup, resetAll } from './backup';
import type { GameRow } from './types';

const lichessGame: GameRow = {
  id: 'lichess:abcd1234',
  source: 'lichess',
  url: 'https://lichess.org/abcd1234',
  pgn: '1. e4 e5 2. Nf3 Nc6 *',
  white: 'me',
  black: 'them',
  userColor: 'white',
  result: 'win',
  timeClass: 'blitz',
  endTime: new Date('2026-05-01T10:00:00Z'),
};

beforeEach(async () => {
  await Promise.all([db.cards.clear(), db.reviews.clear(), db.puzzles.clear(), db.attempts.clear(), db.games.clear(), db.settings.clear()]);
});

describe('backup with Lichess data', () => {
  it('round-trips a Lichess game and the Lichess account', async () => {
    await db.games.add(lichessGame);
    await setSetting('lichessUsername', 'me');
    const text = await (await exportBackup()).text();

    await db.games.clear();
    await db.settings.clear();
    await importBackup(text);

    const g = await db.games.get('lichess:abcd1234');
    expect(g?.source).toBe('lichess');
    expect(g?.url).toBe('https://lichess.org/abcd1234');
    expect(await getSetting('lichessUsername')).toBe('me');
  });

  it('drops a url that is not on a known site', async () => {
    await db.games.add({ ...lichessGame, url: 'https://evil.example/abcd1234' });
    const text = await (await exportBackup()).text();
    await db.games.clear();
    await importBackup(text);
    expect((await db.games.get('lichess:abcd1234'))?.url).toBeUndefined();
  });
});

describe('resetAll', () => {
  it('removes progress and progress-bearing settings, and keeps accounts and focus', async () => {
    await db.games.add(lichessGame);
    await setSetting('username', 'me');
    await setSetting('lichessUsername', 'me');
    await setSetting('focus', ['white-italian']);
    await setSetting('onboarded', true);
    await setSetting('puzzleRating', 1234);
    await setSetting('endgameWins', { 'kq-k': '2026-5-1' });
    await setSetting('lastSpar', '2026-5-1');
    await setSetting('imported', { user: 'me', months: 3 });

    await resetAll();

    expect(await db.games.count()).toBe(0);
    for (const k of ['puzzleRating', 'endgameWins', 'lastSpar', 'imported']) expect(await getSetting(k)).toBeUndefined();
    expect(await getSetting('username')).toBe('me');
    expect(await getSetting('lichessUsername')).toBe('me');
    expect(await getSetting('focus')).toEqual(['white-italian']);
    expect(await getSetting('onboarded')).toBe(true);
  });
});
