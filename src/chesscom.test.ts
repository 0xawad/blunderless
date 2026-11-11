import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkChessCom, chessComPlayerExists, fetchArchive, fetchRecentGames, listArchives, toGameRow, type ArchiveRef } from './chesscom';
import { FetchError } from './net';

const base = {
  uuid: 'abc-123',
  url: 'https://www.chess.com/game/live/1',
  pgn: '[Event "Live Chess"]\n[Result "1-0"]\n[EndDate "2026.10.03"]\n[EndTime "18:22:10"]\n\n1. e4 e5 1-0',
  rules: 'chess',
  time_class: 'rapid',
  end_time: 1_790_000_000,
  white: { username: 'Hero', rating: 750, result: 'win' },
  black: { username: 'them', rating: 760, result: 'resigned' },
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
const outcome = <T>(p: Promise<T>) => p.then((value) => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }));
const ref = (label: string): ArchiveRef => {
  const [y, m] = label.split('-');
  return { url: `https://api.chess.com/pub/player/hero/games/${y}/${m}`, key: Number(y) * 100 + Number(m), label };
};

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

describe('toGameRow with missing or malformed fields', () => {
  it('never throws', () => {
    const bad: unknown[] = [
      undefined, 7, 'game', [],
      { ...base, white: null },
      { ...base, white: 'Hero' },
      { ...base, black: 12 },
      { ...base, pgn: undefined },
      { ...base, uuid: undefined, url: undefined },
      { ...base, rules: undefined },
      { ...base, white: {}, black: {} },
    ];
    for (const b of bad) expect(toGameRow(b, 'hero')).toBeNull();
  });

  it('falls back to the PGN for a missing or absurd end time, and skips the game when there is none', () => {
    const fromPgn = toGameRow({ ...base, end_time: undefined }, 'hero');
    expect(fromPgn?.endTime.toISOString()).toBe('2026-10-03T18:22:10.000Z');
    expect(toGameRow({ ...base, end_time: 1e300 }, 'hero')?.endTime.toISOString()).toBe('2026-10-03T18:22:10.000Z');
    expect(toGameRow({ ...base, end_time: 'noon', pgn: '1. e4 e5 1-0' }, 'hero')).toBeNull();
    // Whatever comes out is a date IndexedDB can index.
    expect(Number.isNaN(toGameRow(base, 'hero')!.endTime.getTime())).toBe(false);
  });

  it('works out the result from whichever side says it', () => {
    const noMine = { ...base, white: { username: 'Hero', rating: 750 } };
    expect(toGameRow(noMine, 'hero')?.result).toBe('win'); // they resigned
    expect(toGameRow({ ...noMine, black: { username: 'them', result: 'win' } }, 'hero')?.result).toBe('loss');
    expect(toGameRow({ ...noMine, black: { username: 'them', result: 'stalemate' } }, 'hero')?.result).toBe('draw');
    // Neither side has a code: the PGN's Result header decides.
    expect(toGameRow({ ...noMine, black: { username: 'them' } }, 'hero')?.result).toBe('win');
    expect(toGameRow({ ...noMine, black: { username: 'them' }, pgn: '1. e4 e5 *' }, 'hero')).toBeNull();
    // An unfamiliar code that nothing else explains is still a loss, as before.
    const odd = { ...base, pgn: '1. e4 e5 *', white: { username: 'Hero', result: 'newcode' }, black: { username: 'them', result: 'othercode' } };
    expect(toGameRow(odd, 'hero')?.result).toBe('loss');
  });

  it('ignores ratings that are not numbers', () => {
    const g = toGameRow({ ...base, white: { ...base.white, rating: '750' }, black: { ...base.black, rating: NaN } }, 'hero');
    expect(g).toMatchObject({ whiteElo: undefined, blackElo: undefined, timeClass: 'rapid' });
    expect(toGameRow({ ...base, time_class: 5 }, 'hero')?.timeClass).toBe('unknown');
  });

  it('skips games from a set-up position but keeps the standard start', () => {
    const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    expect(toGameRow({ ...base, initial_setup: start }, 'hero')).not.toBeNull();
    expect(toGameRow({ ...base, initial_setup: '' }, 'hero')).not.toBeNull();
    expect(toGameRow({ ...base, initial_setup: '4k3/8/8/8/8/8/8/4K2R w K - 0 1' }, 'hero')).toBeNull();
    expect(toGameRow({ ...base, pgn: `[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/8/4K2R w K - 0 1"]\n\n1. Rh8+ 1-0` }, 'hero')).toBeNull();
  });
});

describe('listArchives', () => {
  it('keeps only real archive URLs, oldest first', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        archives: [
          'https://api.chess.com/pub/player/hero/games/2026/10',
          'https://evil.example/pub/player/hero/games/2026/09',
          42,
          'https://api.chess.com/pub/player/hero/games/2026/08',
        ],
      }),
    );
    expect(await listArchives('Hero')).toEqual([ref('2026-08'), ref('2026-10')]);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.chess.com/pub/player/hero/games/archives');
  });

  it('copes with a body that is not what it should be', async () => {
    fetchMock.mockResolvedValueOnce(json({ archives: 'none' })).mockResolvedValueOnce(json(null));
    expect(await listArchives('Hero')).toEqual([]);
    expect(await listArchives('Hero')).toEqual([]);
    await expect(listArchives('no spaces')).rejects.toThrow('bad username');
  });
});

describe('fetchArchive', () => {
  it('maps the usable games and shrugs at a month without a games array', async () => {
    fetchMock.mockResolvedValueOnce(json({ games: [base, { ...base, uuid: 'v', rules: 'chess960' }, null] })).mockResolvedValueOnce(json({}));
    expect((await fetchArchive(ref('2026-10'), 'Hero')).map((g) => g.id)).toEqual(['abc-123']);
    expect(await fetchArchive(ref('2026-09'), 'Hero')).toEqual([]);
  });

  it('retries 5xx and network errors with backoff, then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(json({}, 502))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(json({ games: [base] }));
    const waits: number[] = [];
    const p = outcome(fetchArchive(ref('2026-10'), 'Hero', { onRetry: (i) => waits.push(i.waitMs) }));
    await vi.advanceTimersByTimeAsync(1_499);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3_000);
    expect((await p).value).toHaveLength(1);
    expect(waits).toEqual([1_500, 3_000]);
  });

  it('honours Retry-After on a 429', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 429, { 'Retry-After': '20' })).mockResolvedValueOnce(json({ games: [] }));
    const p = outcome(fetchArchive(ref('2026-10'), 'Hero'));
    await vi.advanceTimersByTimeAsync(19_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await p).value).toEqual([]);
  });

  it('gives up after three retries', async () => {
    fetchMock.mockImplementation(async () => json({}, 503));
    const p = outcome(fetchArchive(ref('2026-10'), 'Hero'));
    await vi.advanceTimersByTimeAsync(60_000);
    const { error } = await p;
    expect(error).toBeInstanceOf(FetchError);
    expect(error).toMatchObject({ kind: 'http', status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('never has two requests in the air at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const release: (() => void)[] = [];
    fetchMock.mockImplementation(async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise<void>((r) => release.push(r));
      inFlight--;
      return json({ games: [] });
    });
    const all = Promise.all([fetchArchive(ref('2026-10'), 'Hero'), fetchArchive(ref('2026-09'), 'Hero'), checkChessCom('Hero')]);
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(i + 1);
      release[i]();
    }
    await all;
    expect(peak).toBe(1);
  });
});

describe('fetchRecentGames (the old all-or-nothing call)', () => {
  it('still fetches the last months newest first', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (url.endsWith('/archives')) return json({ archives: ['2026/08', '2026/09', '2026/10'].map((m) => `https://api.chess.com/pub/player/hero/games/${m}`) });
      return json({ games: [{ ...base, uuid: url.slice(-7) }] });
    });
    const rows = await fetchRecentGames('Hero', 2);
    expect(rows.map((g) => g.id)).toEqual(['2026/10', '2026/09']);
    const since = await fetchRecentGames('Hero', 3, new Date('2026-10-05T00:00:00Z'));
    expect(since.map((g) => g.id)).toEqual(['2026/10']);
  });
});

describe('checkChessCom', () => {
  it('tells apart ok, not found, invalid and unreachable', async () => {
    expect(await checkChessCom('x')).toBe('invalid');
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(json({ username: 'me' })).mockResolvedValueOnce(json({}, 404));
    expect(await checkChessCom('Hero')).toBe('ok');
    expect(await checkChessCom('Nobody')).toBe('not-found');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.chess.com/pub/player/hero');

    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const p = checkChessCom('Hero');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await p).toBe('unreachable');
  });

  it('keeps the old boolean helper working', async () => {
    fetchMock.mockResolvedValueOnce(json({})).mockResolvedValueOnce(json({}, 404));
    expect(await chessComPlayerExists('Hero')).toBe(true);
    expect(await chessComPlayerExists('Nobody')).toBe(false);
    expect(await chessComPlayerExists('!')).toBe(false);
  });
});
