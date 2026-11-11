import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Chess } from 'chess.js';
import fixture from './__fixtures__/lichess-games.ndjson?raw';
import { getRepertoire } from '../repertoire';
import { addLine, db, getSetting, setSetting } from '../srs/db';
import type { GameRow } from '../srs/types';
import { ANALYSIS_VERSION } from './analyze';
import {
  ImportError,
  cancelImport,
  checkAccount,
  getAccounts,
  getImportStatus,
  importChessCom,
  importFrom,
  monthLabel,
  needsAnalysis,
  setAccount,
  type ImportProgress,
  type ImportResult,
} from './store';

// ---- a pretend Chess.com ------------------------------------------------------

const NOW = new Date('2026-11-11T12:00:00Z');
const MONTHS = ['2026-08', '2026-09', '2026-10', '2026-11'];
const archiveUrl = (label: string) => `https://api.chess.com/pub/player/hero/games/${label.replace('-', '/')}`;

function pgn(sans: string[], result = '1-0'): string {
  const c = new Chess();
  for (const s of sans) c.move(s);
  c.setHeader('Result', result);
  return `${c.pgn()}${sans.length ? '' : ' '}`;
}

let serial = 0;
function entry(month: string, sans: string[], opts: { color?: 'white' | 'black'; end?: Date; pgn?: string } = {}) {
  const n = ++serial;
  const [y, m] = month.split('-').map(Number);
  const me = { username: 'Hero', rating: 800, result: 'win' };
  const them = { username: `opp${n}`, rating: 810, result: 'resigned' };
  return {
    uuid: `g${n}`,
    url: `https://www.chess.com/game/live/${n}`,
    pgn: opts.pgn ?? pgn(sans),
    rules: 'chess',
    time_class: 'blitz',
    end_time: Math.floor((opts.end ?? new Date(Date.UTC(y, m - 1, 5, 10, 0, n))).getTime() / 1000),
    white: opts.color === 'black' ? them : me,
    black: opts.color === 'black' ? me : them,
  };
}

const ITALIAN = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'];
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

/** What each month answers; a function can fail a few times and then recover. */
let months: Record<string, () => Response>;
let archivesAnswer: () => Response;
let lichessAnswer: (url: URL) => Response;
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
let inFlight = 0;
let peak = 0;

function installServer() {
  fetchMock.mockImplementation(async (url) => {
    if (url === '/openings.json') return json({});
    peak = Math.max(peak, ++inFlight);
    try {
      await Promise.resolve();
      if (url.startsWith('https://lichess.org/')) return lichessAnswer(new URL(url));
      if (url.endsWith('/games/archives')) return archivesAnswer();
      const label = url.slice(-7).replace('/', '-');
      return (months[label] ?? (() => json({}, 404)))();
    } finally {
      inFlight--;
    }
  });
}

const requested = () =>
  fetchMock.mock.calls.map(([u]) => u).filter((u) => /\/games\/\d{4}\/\d{2}$/.test(u)).map((u) => u.slice(-7).replace('/', '-'));
const lichessCalls = () => fetchMock.mock.calls.map(([u]) => u).filter((u) => u.startsWith('https://lichess.org/api/games/')).map((u) => new URL(u));

/**
 * Runs a promise to its end under fake timers. IndexedDB (fake-indexeddb) works
 * on real macrotasks, so fake time is advanced in small steps with a real
 * pause between them.
 */
async function drive<T>(p: Promise<T>, stepMs = 250): Promise<T> {
  let settled = false;
  let value: T | undefined;
  let error: unknown;
  let failed = false;
  p.then(
    (v) => {
      value = v;
      settled = true;
    },
    (e: unknown) => {
      error = e;
      failed = true;
      settled = true;
    },
  );
  for (let i = 0; i < 20_000 && !settled; i++) {
    await vi.advanceTimersByTimeAsync(stepMs);
    await new Promise((r) => setImmediate(r));
  }
  if (!settled) throw new Error('promise never settled');
  if (failed) throw error;
  return value as T;
}

const ids = async () => (await db.games.orderBy('endTime').toArray()).map((g) => g.id);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: NOW });
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  await Promise.all(db.tables.map((t) => t.clear()));
  serial = 0;
  inFlight = 0;
  peak = 0;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  archivesAnswer = () => json({ archives: MONTHS.map(archiveUrl) });
  // Built once: a month that is fetched twice must return the same games, as the real archive does.
  const games = {
    '2026-08': [entry('2026-08', ITALIAN)],
    '2026-09': [entry('2026-09', ITALIAN), entry('2026-09', ['d4', 'd5'])],
    '2026-10': [entry('2026-10', ITALIAN, { color: 'black' })],
    '2026-11': [entry('2026-11', ['e4', 'c5', 'Nf3'])],
  };
  months = Object.fromEntries(Object.entries(games).map(([m, g]) => [m, () => json({ games: g })]));
  lichessAnswer = () => new Response(fixture);
  installServer();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('importFrom chesscom', () => {
  it('imports every month, one request at a time, and remembers the finished ones', async () => {
    const seen: ImportProgress[] = [];
    const r = await drive(importFrom('chesscom', 'Hero', { months: 4, onProgress: (p) => seen.push(p) }));
    expect(r).toEqual({ source: 'chesscom', added: 5, failed: [], partial: false, requeued: 0, aborted: undefined, reason: undefined });
    expect(requested()).toEqual(['2026-11', '2026-10', '2026-09', '2026-08']);
    expect(peak).toBe(1);
    expect(await db.games.count()).toBe(5);
    // The current month can still grow, so it is not marked finished.
    expect(await getSetting('imported')).toEqual({ user: 'hero', months: 4, done: ['2026-08', '2026-09', '2026-10'] });

    expect(seen[0]).toMatchObject({ source: 'chesscom', phase: 'listing', done: 0, added: 0 });
    expect(seen.filter((p) => p.phase === 'downloading').map((p) => [p.done, p.total])).toEqual([[0, 4], [1, 4], [2, 4], [3, 4]]);
    expect(seen.some((p) => p.phase === 'saving' && p.total === 2 && p.done === 2)).toBe(true);
    expect(seen.find((p) => p.phase === 'downloading')?.label).toBe(`Downloading ${monthLabel('2026-11')}`);
    expect(getImportStatus().chesscom).toBeUndefined();
  });

  it('keeps the months that arrived when one fails, reports the failed one, and retried it with backoff', async () => {
    let tries = 0;
    months['2026-09'] = () => {
      tries++;
      return json({}, 503);
    };
    const r = await drive(importFrom('chesscom', 'Hero', { months: 4 }));
    expect(r).toMatchObject({ added: 3, failed: ['2026-09'], partial: true, reason: 'unreachable' });
    expect(tries).toBe(4); // one attempt and three retries
    expect(await db.games.count()).toBe(3);
    // The failed month is not marked done, and the "complete" window is not widened.
    expect(await getSetting('imported')).toEqual({ user: 'hero', months: 0, done: ['2026-08', '2026-10'] });
  });

  it('on the next import fetches only the failed month and the current one', async () => {
    months['2026-09'] = () => json({}, 503);
    await drive(importFrom('chesscom', 'Hero', { months: 4 }));
    fetchMock.mockClear();
    const september = [entry('2026-09', ['c4', 'e5'])];
    months['2026-09'] = () => json({ games: september });

    const r = await drive(importFrom('chesscom', 'Hero', { months: 4 }));
    expect(requested()).toEqual(['2026-11', '2026-09']);
    expect(r).toMatchObject({ added: 1, failed: [], partial: false });
    expect(await db.games.count()).toBe(4);
    expect(await getSetting('imported')).toEqual({ user: 'hero', months: 4, done: ['2026-08', '2026-09', '2026-10'] });

    // And once everything is in, only the month that can still change.
    fetchMock.mockClear();
    expect(await drive(importFrom('chesscom', 'Hero', { months: 4 }))).toMatchObject({ added: 0, partial: false });
    expect(requested()).toEqual(['2026-11']);
  });

  it('waits out a 429 as long as Retry-After says, tells the UI, then carries on', async () => {
    let limited = true;
    const october = [entry('2026-10', ITALIAN)];
    months['2026-10'] = () => {
      if (!limited) return json({ games: october });
      limited = false;
      return json({}, 429, { 'Retry-After': '30' });
    };
    const seen: ImportProgress[] = [];
    const started = Date.now();
    const r = await drive(importFrom('chesscom', 'Hero', { months: 4, onProgress: (p) => seen.push(p) }));
    expect(r).toMatchObject({ added: 5, failed: [], partial: false });
    expect(Date.now() - started).toBeGreaterThanOrEqual(30_000);
    const waiting = seen.filter((p) => p.waiting);
    expect(waiting).toHaveLength(1);
    expect(waiting[0].label).toBe('Chess.com asked us to slow down. Trying again in 30 seconds.');
  });

  it('stops asking when the rate limit does not lift, and says which months are missing', async () => {
    months['2026-10'] = () => json({}, 429);
    const r = await drive(importFrom('chesscom', 'Hero', { months: 4 }));
    expect(r).toMatchObject({ added: 1, failed: ['2026-10', '2026-09', '2026-08'], partial: true, reason: 'rate-limited' });
    expect(requested().filter((m) => m !== '2026-10')).toEqual(['2026-11']);
  });

  it('rejects with a typed error when nothing can be imported', async () => {
    const bad = await drive(importFrom('chesscom', 'no spaces').catch((e: unknown) => e));
    expect(bad).toBeInstanceOf(ImportError);
    expect((bad as ImportError).kind).toBe('invalid');
    expect(fetchMock).not.toHaveBeenCalled();

    archivesAnswer = () => json({}, 404);
    const missing = (await drive(importFrom('chesscom', 'Hero').catch((e: unknown) => e))) as ImportError;
    expect(missing.kind).toBe('not-found');

    archivesAnswer = () => json({}, 500);
    const down = (await drive(importFrom('chesscom', 'Hero').catch((e: unknown) => e))) as ImportError;
    expect(down.kind).toBe('unreachable');

    archivesAnswer = () => json({ archives: MONTHS.map(archiveUrl) });
    for (const m of MONTHS) months[m] = () => json({}, 500);
    const dead = (await drive(importFrom('chesscom', 'Hero', { months: 4 }).catch((e: unknown) => e))) as ImportError;
    expect(dead).toBeInstanceOf(ImportError);
    expect(dead.kind).toBe('unreachable');
    // Two silent months in a row end the attempt; all four are reported.
    expect(dead.failed).toEqual(['2026-11', '2026-10', '2026-09', '2026-08']);
    expect(await db.games.count()).toBe(0);
    expect(getImportStatus().chesscom).toBeUndefined();
  });

  it('joins a second call to the import already running instead of starting another', async () => {
    const a: ImportProgress[] = [];
    const b: ImportProgress[] = [];
    const first = importFrom('chesscom', 'Hero', { months: 4, onProgress: (p) => a.push(p) });
    const second = importFrom('chesscom', 'hero', { months: 4, onProgress: (p) => b.push(p) });
    expect(second).toBe(first);
    const other = await importFrom('chesscom', 'Someone').catch((e: unknown) => e);
    expect((other as ImportError).kind).toBe('busy');
    expect(getImportStatus().chesscom?.phase).toBe('listing');

    const r = await drive(first);
    expect(r.added).toBe(5);
    expect(fetchMock.mock.calls.filter(([u]) => u.endsWith('/games/archives'))).toHaveLength(1);
    expect(await db.games.count()).toBe(5);
    expect(b.length).toBeGreaterThan(0);
    expect(b[b.length - 1]).toEqual(a[a.length - 1]);
  });

  it('does not add or overwrite games that are already stored', async () => {
    await drive(importFrom('chesscom', 'Hero', { months: 4 }));
    const one = (await db.games.toArray())[0];
    await db.games.update(one.id, { timeClass: 'edited' });
    await setSetting('imported', undefined); // forget what was fetched: every month comes again
    const r = await drive(importFrom('chesscom', 'Hero', { months: 4 }));
    expect(r.added).toBe(0);
    expect(await db.games.count()).toBe(5);
    expect((await db.games.get(one.id))?.timeClass).toBe('edited');
  });

  it('skips games you never moved in and flags a PGN that cannot be replayed', async () => {
    months['2026-11'] = () =>
      json({
        games: [
          entry('2026-11', [], { pgn: '[Event "Live Chess"]\n[Result "0-1"]\n\n0-1' }), // abandoned before move one
          entry('2026-11', ['e4'], { color: 'black' }), // they moved, you never did
          entry('2026-11', ['e4', 'e5'], { color: 'black' }),
          entry('2026-11', [], { pgn: '1. e4 e5 2. Ke3 Qh4 1-0' }), // illegal move
          { ...entry('2026-11', ['d4']), rules: 'crazyhouse' },
        ],
      });
    const r = await drive(importFrom('chesscom', 'Hero', { months: 1 }));
    expect(r.added).toBe(2);
    const rows = await db.games.orderBy('endTime').toArray();
    expect(rows.map((g) => g.id)).toEqual(['g8', 'g9']); // the third and fourth of the five above
    expect(rows[0].unreadable).toBeUndefined();
    expect(rows[0].book).toBeDefined();
    expect(rows[1].unreadable).toBe(true);
    expect(needsAnalysis(rows[0])).toBe(true);
    expect(needsAnalysis(rows[1])).toBe(false);
  });

  it('stops when cancelled, keeps what was saved and lists the rest as missing', async () => {
    const ctl = new AbortController();
    const p = importFrom('chesscom', 'Hero', {
      months: 4,
      signal: ctl.signal,
      onProgress: (s) => {
        if (s.phase === 'downloading' && s.done === 1) ctl.abort();
      },
    });
    const r = await drive(p);
    expect(r).toMatchObject({ added: 1, aborted: true, partial: true, failed: ['2026-10', '2026-09', '2026-08'] });
    expect(await ids()).toEqual(['g5']); // November's game, the first month fetched
  });

  it('can be cancelled from anywhere with cancelImport', async () => {
    const p = importFrom('chesscom', 'Hero', { months: 4 });
    cancelImport('lichess'); // nothing running there: a no-op
    cancelImport('chesscom');
    const r = await drive(p);
    expect(r).toMatchObject({ added: 0, aborted: true, partial: true });
    expect(getImportStatus().chesscom).toBeUndefined();
    // And the next import starts normally.
    expect(await drive(importFrom('chesscom', 'Hero', { months: 1 }))).toMatchObject({ added: 1, partial: false });
  });

  it('understands the marker written by older versions', async () => {
    // Before months were tracked: { user, months } and "everything up to the newest stored game is in".
    await setSetting('imported', { user: 'hero', months: 3 });
    const old: GameRow = {
      id: 'old-1', source: 'chesscom', pgn: pgn(ITALIAN), white: 'Hero', black: 'x', userColor: 'white', result: 'win',
      timeClass: 'blitz', endTime: new Date('2026-10-20T10:00:00Z'),
    };
    await db.games.add(old);
    const r = await drive(importFrom('chesscom', 'Hero', { months: 3 }));
    // September was complete under the old rule; October (the newest game's month) and November are fetched.
    expect(requested()).toEqual(['2026-11', '2026-10']);
    expect(r).toMatchObject({ added: 2, partial: false });
    expect(await getSetting('imported')).toEqual({ user: 'hero', months: 3, done: ['2026-09', '2026-10'] });
  });

  it('fetches everything again after the games were wiped, whatever the marker says', async () => {
    await drive(importFrom('chesscom', 'Hero', { months: 4 }));
    await db.games.clear(); // Settings > Reset clears games and leaves settings behind
    fetchMock.mockClear();
    const r = await drive(importFrom('chesscom', 'Hero', { months: 4 }));
    expect(requested()).toEqual(['2026-11', '2026-10', '2026-09', '2026-08']);
    expect(r).toMatchObject({ added: 5, partial: false });
  });

  it('starts over for a different username', async () => {
    await setSetting('imported', { user: 'someoneelse', months: 12, done: MONTHS });
    await drive(importFrom('chesscom', 'Hero', { months: 2 }));
    expect(requested()).toEqual(['2026-11', '2026-10']);
    expect(await getSetting('imported')).toEqual({ user: 'hero', months: 2, done: ['2026-10'] });
  });

  it('puts a repertoire line back in the drill queue when a new game left it', async () => {
    const line = getRepertoire('white-italian')!.lines[0];
    await addLine(line);
    const card = await db.cards.get(line.id);
    await db.cards.put({ ...card!, card: { ...card!.card, due: new Date('2027-01-01T00:00:00Z') } });
    // 4.Ng5 where the repertoire plays c3, in a game that ended after the line was learned.
    months['2026-11'] = () => json({ games: [entry('2026-11', [...ITALIAN, 'Ng5'], { end: new Date('2026-11-11T13:00:00Z') })] });
    const r = await drive(importFrom('chesscom', 'Hero', { months: 1 }));
    expect(r).toMatchObject({ added: 1, requeued: 1 });
    expect((await db.cards.get(line.id))!.card.due.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('keeps the old importChessCom entry point working', async () => {
    expect(await drive(importChessCom('Hero', 2))).toEqual({ added: 2, requeued: 0 });
  });
});

describe('importFrom lichess', () => {
  const start = Date.UTC(2026, 7, 11, 12, 0); // three months before NOW

  it('imports the stream and remembers the span it covered', async () => {
    const seen: ImportProgress[] = [];
    const r = await drive(importFrom('lichess', 'TestUser', { months: 3, onProgress: (p) => seen.push(p) }));
    expect(r).toMatchObject({ source: 'lichess', added: 5, failed: [], partial: false });
    const rows = await db.games.orderBy('endTime').reverse().toArray();
    expect(rows.map((g) => g.id)).toEqual(['lichess:aaaaaaa1', 'lichess:aaaaaaa2', 'lichess:aaaaaaa3', 'lichess:aaaaaaa7', 'lichess:aaaaaaa8']);
    expect(rows.every((g) => g.source === 'lichess' && g.book)).toBe(true);
    expect(await getSetting('importedLichess')).toEqual({ user: 'testuser', from: start, to: NOW.getTime() });

    const [call] = lichessCalls();
    expect(call.searchParams.get('since')).toBe(String(start));
    expect(call.searchParams.has('until')).toBe(false);
    const last = seen[seen.length - 1];
    expect(last).toMatchObject({ source: 'lichess', phase: 'downloading', done: 9, added: 5, label: '9 games downloaded' });
    expect(last.total).toBeUndefined();
  });

  it('next time asks only for games since the last import', async () => {
    await drive(importFrom('lichess', 'TestUser', { months: 3 }));
    fetchMock.mockClear();
    vi.setSystemTime(new Date('2026-11-13T12:00:00Z'));
    const r = await drive(importFrom('lichess', 'testuser', { months: 3 }));
    expect(r).toMatchObject({ added: 0, partial: false });
    const calls = lichessCalls();
    expect(calls).toHaveLength(1);
    // A day of overlap catches a game that was still being played last time.
    expect(calls[0].searchParams.get('since')).toBe(String(NOW.getTime() - 86_400_000));
    expect(await getSetting<{ to: number }>('importedLichess')).toMatchObject({ from: start, to: Date.UTC(2026, 10, 13, 12) });
  });

  it('downloads the whole window again after the games were wiped', async () => {
    await drive(importFrom('lichess', 'TestUser', { months: 3 }));
    await db.games.clear();
    fetchMock.mockClear();
    const r = await drive(importFrom('lichess', 'TestUser', { months: 3 }));
    expect(lichessCalls()[0].searchParams.get('since')).toBe(String(start));
    expect(r).toMatchObject({ added: 5, partial: false });
  });

  it('reaches further back when asked for a longer history', async () => {
    await drive(importFrom('lichess', 'TestUser', { months: 3 }));
    fetchMock.mockClear();
    lichessAnswer = () => new Response('');
    await drive(importFrom('lichess', 'TestUser', { months: 12 }));
    const calls = lichessCalls();
    expect(calls).toHaveLength(2);
    expect(calls[1].searchParams.get('since')).toBe(String(Date.UTC(2025, 10, 11, 12, 0)));
    expect(calls[1].searchParams.get('until')).toBe(String(start));
    expect(await getSetting('importedLichess')).toMatchObject({ from: Date.UTC(2025, 10, 11, 12, 0) });
  });

  it('says so and gives up when Lichess keeps answering 429', async () => {
    lichessAnswer = () => new Response('', { status: 429 });
    const seen: ImportProgress[] = [];
    const started = Date.now();
    const e = (await drive(importFrom('lichess', 'TestUser', { onProgress: (p) => seen.push(p) }).catch((x: unknown) => x))) as ImportError;
    expect(e).toBeInstanceOf(ImportError);
    expect(e.kind).toBe('rate-limited');
    expect(e.failed).toEqual(['2026-08', '2026-09', '2026-10', '2026-11']);
    expect(Date.now() - started).toBeGreaterThanOrEqual(120_000);
    expect(lichessCalls()).toHaveLength(3);
    const waiting = seen.filter((p) => p.waiting);
    expect(waiting[0].label).toBe('Lichess asked us to slow down. Trying again in 60 seconds.');
    expect(await getSetting('importedLichess')).toBeUndefined();
  });

  it('keeps a partial download and picks up below it next time', async () => {
    const lines = fixture.split('\n');
    const head = `${lines.slice(0, 3).join('\n')}\n`;
    const enc = new TextEncoder();
    let broke = false;
    lichessAnswer = () => {
      if (broke) return new Response('', { status: 502 });
      broke = true;
      let sent = false;
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(ctrl) {
            if (sent) return ctrl.error(new TypeError('network error'));
            sent = true;
            ctrl.enqueue(enc.encode(head));
          },
        }),
      );
    };
    const r = await drive(importFrom('lichess', 'TestUser', { months: 3 }));
    expect(r).toMatchObject({ added: 3, partial: true, reason: 'unreachable' });
    // Everything from the window start up to the oldest game received is still missing.
    expect(r.failed).toEqual(['2026-08', '2026-09', '2026-10']);
    const oldest = JSON.parse(lines[2]).createdAt as number;
    expect(await getSetting('importedLichess')).toEqual({ user: 'testuser', from: oldest, to: NOW.getTime() });

    fetchMock.mockClear();
    lichessAnswer = (url) => new Response(url.searchParams.has('until') ? `${lines.slice(2).join('\n')}\n` : '');
    const again = await drive(importFrom('lichess', 'TestUser', { months: 3 }));
    expect(again).toMatchObject({ added: 2, failed: [], partial: false });
    const calls = lichessCalls();
    expect(calls.map((c) => c.searchParams.get('until'))).toEqual([null, String(oldest)]);
    expect(await getSetting('importedLichess')).toMatchObject({ from: start });
    expect(await db.games.count()).toBe(5);
  });

  it('rejects for a player that does not exist', async () => {
    lichessAnswer = () => new Response('', { status: 404 });
    const e = (await drive(importFrom('lichess', 'TestUser').catch((x: unknown) => x))) as ImportError;
    expect(e.kind).toBe('not-found');
  });

  it('runs alongside a Chess.com import', async () => {
    const both = Promise.all([importFrom('chesscom', 'Hero', { months: 4 }), importFrom('lichess', 'TestUser', { months: 3 })]);
    const [a, b]: ImportResult[] = await drive(both);
    expect([a.added, b.added]).toEqual([5, 5]);
    expect(await db.games.count()).toBe(10);
  });
});

describe('accounts', () => {
  it('stores each site under its own key and keeps the old Chess.com one', async () => {
    await setSetting('username', 'OldName');
    expect(await getAccounts()).toEqual({ chesscom: 'OldName', lichess: undefined });
    await setAccount('lichess', '  TestUser ');
    await setAccount('chesscom', 'Hero');
    expect(await getAccounts()).toEqual({ chesscom: 'Hero', lichess: 'TestUser' });
    expect(await getSetting('lichessUsername')).toBe('TestUser');
    await setAccount('chesscom', undefined);
    await setAccount('lichess', '');
    expect(await getAccounts()).toEqual({ chesscom: undefined, lichess: undefined });
  });

  it('refuses a name the site could not have', async () => {
    await expect(setAccount('chesscom', 'ab')).rejects.toBeInstanceOf(ImportError);
    await expect(setAccount('lichess', 'has space')).rejects.toMatchObject({ kind: 'invalid' });
    expect(await getAccounts()).toEqual({ chesscom: undefined, lichess: undefined });
  });

  it('checks an account against the right site', async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(json({ username: 'hero' })).mockResolvedValueOnce(new Response('', { status: 404 }));
    expect(await checkAccount('chesscom', 'Hero')).toBe('ok');
    expect(await checkAccount('lichess', 'Nobody')).toBe('not-found');
    expect(fetchMock.mock.calls.map(([u]) => u)).toEqual(['https://api.chess.com/pub/player/hero', 'https://lichess.org/api/user/Nobody']);
    expect(await checkAccount('lichess', '!')).toBe('invalid');
  });
});

describe('needsAnalysis', () => {
  const g: GameRow = {
    id: 'x', source: 'lichess', pgn: '1. e4 e5', white: 'a', black: 'b', userColor: 'white', result: 'win', timeClass: 'blitz', endTime: NOW,
  };
  const analysis = { depth: 12, evals: [], moves: [], accuracy: 90, blunders: 0, mistakes: 0, analyzedAt: NOW };

  it('is true for a game never analysed or analysed by an older version', () => {
    expect(needsAnalysis(g)).toBe(true);
    expect(needsAnalysis({ ...g, analysis })).toBe(true); // no version means version 1
    expect(needsAnalysis({ ...g, analysis: { ...analysis, version: ANALYSIS_VERSION - 1 } })).toBe(true);
  });

  it('is false once analysed by the current version', () => {
    expect(needsAnalysis({ ...g, analysis: { ...analysis, version: ANALYSIS_VERSION } })).toBe(false);
  });

  it('is false for games that can never be analysed', () => {
    expect(needsAnalysis({ ...g, unreadable: true })).toBe(false);
    expect(needsAnalysis({ ...g, unanalysable: true })).toBe(false);
    expect(needsAnalysis({ ...g, unanalysable: true, analysis: { ...analysis, version: 1 } })).toBe(false);
  });
});
