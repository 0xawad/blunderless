import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from './games/__fixtures__/lichess-games.ndjson?raw';
import { parseGamePgn } from './chess/game';
import { parseTimeControl, plyClocks } from './games/clock';
import { checkLichess, fetchLichessGames, lichessGamesUrl, toLichessGameRow, LICHESS_USERNAME_RE } from './lichess';
import { FetchError, type RetryInfo } from './net';
import type { GameRow } from './srs/types';

const lines = fixture.split('\n').filter((l) => l.trim());
const raw = (id: string): Record<string, unknown> => JSON.parse(lines.find((l) => l.includes(`"id":"${id}"`))!);
const row = (id: string, user = 'TestUser') => toLichessGameRow(raw(id), user);

const enc = new TextEncoder();
/** The text as a stream of `size`-byte chunks, so lines are split across reads. */
function streamOf(text: string, size = 97, breakAfter?: number): ReadableStream<Uint8Array> {
  const bytes = enc.encode(text);
  let at = 0;
  return new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (breakAfter !== undefined && at >= breakAfter) return ctrl.error(new TypeError('network error'));
      if (at >= bytes.length) return ctrl.close();
      const end = Math.min(bytes.length, breakAfter ?? Infinity, at + size);
      ctrl.enqueue(bytes.slice(at, end));
      at = end;
    },
  });
}

const outcome = <T>(p: Promise<T>) => p.then((value) => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }));
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('toLichessGameRow', () => {
  it('maps a blitz win as White, clocks and all', () => {
    const g = row('aaaaaaa1')!;
    expect(g).toMatchObject({
      id: 'lichess:aaaaaaa1',
      source: 'lichess',
      url: 'https://lichess.org/aaaaaaa1',
      white: 'TestUser',
      black: 'Opponent1',
      whiteElo: 1500,
      blackElo: 1480,
      userColor: 'white',
      result: 'win',
      timeClass: 'blitz',
      opening: { eco: 'C20', name: "King's Pawn Game: Wayward Queen Attack" },
    });
    expect(g.endTime.getTime()).toBe(raw('aaaaaaa1').lastMoveAt);
    // The PGN goes through the same parser as every other game, and keeps its clocks.
    const plies = parseGamePgn(g.pgn);
    expect(plies.map((p) => p.san)).toEqual(['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#']);
    expect(parseTimeControl(g.pgn)).toEqual({ base: 180, inc: 2 });
    const clocks = plyClocks(g.pgn, plies.length);
    expect(clocks).toHaveLength(7);
    expect(clocks![2]).toEqual({ left: 180, spent: 4 }); // 3:00 + 2s increment - 2:58
  });

  it('matches the username whatever its case', () => {
    expect(row('aaaaaaa1', 'TESTUSER')?.userColor).toBe('white');
    expect(row('aaaaaaa2', 'testuser')?.userColor).toBe('black');
  });

  it('reads a draw from the missing winner', () => {
    expect(row('aaaaaaa2')).toMatchObject({ userColor: 'black', result: 'draw', timeClass: 'rapid', blackElo: 1500 });
  });

  it('files classical games under rapid, like Chess.com files its long games', () => {
    expect(row('aaaaaaa3')).toMatchObject({ result: 'loss', timeClass: 'rapid' });
  });

  it('names the Lichess computer and anonymous players', () => {
    const g = row('aaaaaaa7')!;
    expect(g).toMatchObject({ white: 'Lichess AI level 3', black: 'TestUser', userColor: 'black', result: 'win' });
    expect(g.whiteElo).toBeUndefined();
    const anon = { ...raw('aaaaaaa1'), players: { white: raw('aaaaaaa1').players && (raw('aaaaaaa1').players as Record<string, unknown>).white, black: {} } };
    expect(toLichessGameRow(anon, 'TestUser')?.black).toBe('Anonymous');
  });

  it('rebuilds a PGN from moves and clocks when the line has none', () => {
    const g = row('aaaaaaa8')!;
    expect(g.timeClass).toBe('bullet');
    const plies = parseGamePgn(g.pgn);
    expect(plies.map((p) => p.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
    expect(parseTimeControl(g.pgn)).toEqual({ base: 60, inc: 0 });
    expect(plyClocks(g.pgn, plies.length)).toHaveLength(4);
  });

  it('skips variants, aborted games, games you never moved in and other people\'s games', () => {
    expect(row('aaaaaaa4')).toBeNull(); // chess960
    expect(row('aaaaaaa5')).toBeNull(); // aborted
    expect(row('aaaaaaa6')).toBeNull(); // Black, one ply on the board
    expect(row('aaaaaaa9')).toBeNull(); // not yours
  });

  it('never throws on missing or malformed fields', () => {
    const good = raw('aaaaaaa1');
    const bad: unknown[] = [
      null, 42, 'x', [], {},
      { ...good, id: '../../etc' },
      { ...good, id: 7 },
      { ...good, players: null },
      { ...good, players: { white: 'nope', black: 3 } },
      { ...good, speed: 'constructor' },
      { ...good, speed: undefined },
      { ...good, status: 'started' },
      { ...good, lastMoveAt: 'yesterday', createdAt: null },
      { ...good, lastMoveAt: 1e300 },
      { ...good, pgn: 42, moves: 'e4 <script> e5' },
      { ...good, pgn: undefined, moves: undefined },
    ];
    for (const b of bad) expect(toLichessGameRow(b, 'TestUser')).toBeNull();
    // Odd extras are ignored rather than fatal.
    expect(toLichessGameRow({ ...good, opening: 'Sicilian', clock: 5, clocks: 'fast' }, 'TestUser')?.opening).toBeUndefined();
  });
});

describe('lichessGamesUrl', () => {
  it('asks for standard time controls with PGN, clocks and openings, and no engine evals', () => {
    const u = new URL(lichessGamesUrl('TestUser', { since: 1000.7, until: 2000, max: 50 }));
    expect(u.origin + u.pathname).toBe('https://lichess.org/api/games/user/TestUser');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      pgnInJson: 'true', clocks: 'true', opening: 'true', evals: 'false',
      perfType: 'bullet,blitz,rapid,classical', sort: 'dateDesc', since: '1000', until: '2000', max: '50',
    });
  });

  it('validates usernames', () => {
    for (const ok of ['ab', 'Test_User-1', 'a'.repeat(30)]) expect(LICHESS_USERNAME_RE.test(ok)).toBe(true);
    for (const no of ['a', '', '_ab', 'a b', 'a/b', 'a'.repeat(31), 'é']) expect(LICHESS_USERNAME_RE.test(no)).toBe(false);
  });
});

describe('fetchLichessGames', () => {
  it('streams the export line by line and hands rows over in batches', async () => {
    fetchMock.mockResolvedValueOnce(new Response(streamOf(fixture)));
    const batches: GameRow[][] = [];
    const r = await fetchLichessGames('TestUser', { since: 5, batchSize: 4 }, (rows) => void batches.push(rows));
    // Nine games arrived (the damaged line is not one); five of them are usable.
    expect(r).toMatchObject({ received: 9, complete: true });
    expect(r.oldest).toBe(raw('aaaaaaa9').createdAt);
    // Batches are counted in games received, so the last one reports progress with nothing to keep.
    expect(batches.map((b) => b.length)).toEqual([3, 2, 0]);
    expect(batches.flat().map((g) => g.id)).toEqual(['lichess:aaaaaaa1', 'lichess:aaaaaaa2', 'lichess:aaaaaaa3', 'lichess:aaaaaaa7', 'lichess:aaaaaaa8']);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/games/user/TestUser?');
    expect(url).toContain('since=5');
    expect(init).toMatchObject({ headers: { Accept: 'application/x-ndjson' }, credentials: 'omit' });
  });

  it('waits a full minute after a 429 and says so', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 429 })).mockResolvedValueOnce(new Response(streamOf(fixture)));
    const waits: RetryInfo[] = [];
    const p = outcome(fetchLichessGames('TestUser', { onRetry: (i) => waits.push(i) }, () => undefined));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(waits).toHaveLength(1);
    expect(waits[0]).toMatchObject({ reason: 'rate-limited', status: 429 });
    expect(waits[0].waitMs).toBeGreaterThanOrEqual(60_000);
    await vi.advanceTimersByTimeAsync(1);
    expect((await p).value).toMatchObject({ received: 9, complete: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports a rate limit that does not lift instead of hanging', async () => {
    fetchMock.mockImplementation(async () => new Response('', { status: 429 }));
    const p = outcome(fetchLichessGames('TestUser', {}, () => undefined));
    await vi.advanceTimersByTimeAsync(121_000);
    const { value } = await p;
    expect(value).toMatchObject({ received: 0, complete: false });
    expect(value!.error).toBeInstanceOf(FetchError);
    expect(value!.error!.kind).toBe('rate-limited');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('resumes below the oldest game received when the stream breaks, without repeating games', async () => {
    // Break inside the third line: two whole games arrive first.
    const cut = enc.encode(lines.slice(0, 2).join('\n')).length + 40;
    fetchMock
      .mockResolvedValueOnce(new Response(streamOf(fixture, 64, cut)))
      // The resumed request starts again from the second game (same start time as `until`).
      .mockResolvedValueOnce(new Response(streamOf(lines.slice(1).join('\n'))));
    const got: string[] = [];
    const p = outcome(fetchLichessGames('TestUser', { since: 1 }, (rows) => void got.push(...rows.map((g) => g.id))));
    await vi.advanceTimersByTimeAsync(2_000);
    const { value } = await p;
    expect(value).toMatchObject({ received: 9, complete: true });
    expect(got).toEqual(['lichess:aaaaaaa1', 'lichess:aaaaaaa2', 'lichess:aaaaaaa3', 'lichess:aaaaaaa7', 'lichess:aaaaaaa8']);
    const second = new URL(fetchMock.mock.calls[1][0]);
    expect(second.searchParams.get('until')).toBe(String(raw('aaaaaaa2').createdAt));
    expect(second.searchParams.get('since')).toBe('1');
  });

  it('keeps what arrived when the stream cannot be resumed', async () => {
    const cut = enc.encode(lines.slice(0, 2).join('\n')).length + 40;
    fetchMock.mockResolvedValueOnce(new Response(streamOf(fixture, 64, cut))).mockRejectedValue(new TypeError('Failed to fetch'));
    const got: string[] = [];
    const p = outcome(fetchLichessGames('TestUser', {}, (rows) => void got.push(...rows.map((g) => g.id))));
    await vi.advanceTimersByTimeAsync(60_000);
    const { value } = await p;
    expect(value).toMatchObject({ received: 2, complete: false, oldest: raw('aaaaaaa2').createdAt });
    expect(value!.error!.kind).toBe('network');
    expect(got).toEqual(['lichess:aaaaaaa1', 'lichess:aaaaaaa2']);
  });

  it('stops when cancelled and hands over what it has', async () => {
    const ctl = new AbortController();
    fetchMock.mockResolvedValueOnce(new Response(streamOf(fixture, 64)));
    const got: string[] = [];
    const r = await fetchLichessGames('TestUser', { signal: ctl.signal, batchSize: 1 }, (rows) => {
      got.push(...rows.map((g) => g.id));
      ctl.abort();
    });
    expect(r).toMatchObject({ aborted: true, complete: false, received: 1 });
    expect(got).toEqual(['lichess:aaaaaaa1']);
  });

  it('throws for a player that does not exist, and for a bad username without asking', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }));
    const { error } = await outcome(fetchLichessGames('NoSuchUser', {}, () => undefined));
    expect(error).toBeInstanceOf(FetchError);
    expect((error as FetchError).kind).toBe('not-found');
    await expect(fetchLichessGames('no/such', {}, () => undefined)).rejects.toThrow('bad username');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('counts a cut-off at max as incomplete', async () => {
    fetchMock.mockResolvedValueOnce(new Response(streamOf(lines.slice(0, 3).join('\n'))));
    const r = await fetchLichessGames('TestUser', { max: 3 }, () => undefined);
    expect(r).toMatchObject({ received: 3, complete: false });
  });
});

describe('checkLichess', () => {
  it('answers without a request for an impossible name', async () => {
    expect(await checkLichess('a b')).toBe('invalid');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('tells found from not found from closed', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'testuser', username: 'TestUser' })))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'gone', disabled: true })));
    expect(await checkLichess('TestUser')).toBe('ok');
    expect(await checkLichess('NoSuchUser')).toBe('not-found');
    expect(await checkLichess('gone')).toBe('not-found');
  });

  it('does not hammer after a 429', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 429 }));
    expect(await checkLichess('TestUser')).toBe('unreachable');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('tries once more after a network blip', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(new Response('{}'));
    const p = checkLichess('TestUser');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await p).toBe('ok');
  });
});
