import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FetchError, fetchJson, fetchJsonOnce, fetchLines, isAbortError, parseRetryAfter, sleep, withRetry } from './net';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

/** A body that hands out one part every `gapMs`. */
function slowBody(parts: string[], gapMs: number): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(ctrl) {
      return new Promise<void>((resolve) =>
        setTimeout(() => {
          if (i < parts.length) ctrl.enqueue(enc.encode(parts[i++]));
          else ctrl.close();
          resolve();
        }, gapMs),
      );
    },
  });
}

/** Settles a promise into a value so a rejection never goes unhandled while timers are advanced. */
const outcome = <T>(p: Promise<T>) => p.then((value) => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }));

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.spyOn(Math, 'random').mockReturnValue(0.5); // no jitter: backoff is exactly base * 2^n
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('parseRetryAfter', () => {
  it('reads seconds and HTTP dates', () => {
    expect(parseRetryAfter('7')).toBe(7000);
    expect(parseRetryAfter('1.5')).toBe(1500);
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    expect(parseRetryAfter('Thu, 01 Jan 2026 12:00:30 GMT', now)).toBe(30_000);
    expect(parseRetryAfter('Thu, 01 Jan 2026 11:00:00 GMT', now)).toBe(0);
  });

  it('ignores junk', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('')).toBeUndefined();
    expect(parseRetryAfter('soon')).toBeUndefined();
  });
});

describe('fetchJson', () => {
  it('sends no cookies and no referrer', async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true }));
    await expect(fetchJson('https://example.test/a')).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' });
  });

  it('retries a 5xx with doubling backoff', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 503)).mockResolvedValueOnce(json({}, 502)).mockResolvedValueOnce(json({ n: 1 }));
    const waits: number[] = [];
    const p = outcome(fetchJson('https://example.test/a', { backoffMs: 1000, onRetry: (i) => waits.push(i.waitMs) }));
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect((await p).value).toEqual({ n: 1 });
    expect(waits).toEqual([1000, 2000]);
  });

  it('waits as long as Retry-After asks after a 429', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 429, { 'Retry-After': '7' })).mockResolvedValueOnce(json({ n: 2 }));
    const seen: { waitMs: number; reason: string }[] = [];
    const p = outcome(fetchJson('https://example.test/a', { onRetry: (i) => seen.push({ waitMs: i.waitMs, reason: i.reason }) }));
    await vi.advanceTimersByTimeAsync(6999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await p).value).toEqual({ n: 2 });
    expect(seen).toEqual([{ waitMs: 7000, reason: 'rate-limited' }]);
  });

  it('uses the minimum rate-limit wait when the server names none', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 429)).mockResolvedValueOnce(json({ n: 3 }));
    const p = outcome(fetchJson('https://example.test/a', { rateLimitWaitMs: 60_000 }));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await p).value).toEqual({ n: 3 });
  });

  it('gives up at once when asked to wait longer than it is willing to', async () => {
    fetchMock.mockResolvedValue(json({}, 429, { 'Retry-After': '3600' }));
    const { error } = await outcome(fetchJson('https://example.test/a'));
    expect(error).toBeInstanceOf(FetchError);
    expect((error as FetchError).kind).toBe('rate-limited');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 404 or another 4xx', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 404)).mockResolvedValueOnce(json({}, 403));
    const a = await outcome(fetchJson('https://example.test/a'));
    expect((a.error as FetchError).kind).toBe('not-found');
    const b = await outcome(fetchJson('https://example.test/b'));
    expect((b.error as FetchError).kind).toBe('http');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a network error and stops after the allowed retries', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const p = outcome(fetchJson('https://example.test/a', { retries: 2, backoffMs: 100 }));
    await vi.advanceTimersByTimeAsync(1000);
    const { error } = await p;
    expect((error as FetchError).kind).toBe('network');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('times out waiting for headers', async () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));
    const p = outcome(fetchJsonOnce('https://example.test/a', { headersTimeoutMs: 15_000 }));
    await vi.advanceTimersByTimeAsync(14_999);
    await vi.advanceTimersByTimeAsync(1);
    const { error } = await p;
    expect(error).toBeInstanceOf(FetchError);
    expect(error).toMatchObject({ kind: 'timeout', phase: 'headers' });
  });

  it('lets a slow body take far longer than the headers timeout, as long as it keeps coming', async () => {
    // Six parts, ten seconds apart: a minute of download against a 15 s headers timeout.
    const parts = ['{"games":[', '1,', '2,', '3,', '4', ']}'];
    fetchMock.mockResolvedValueOnce(new Response(slowBody(parts, 10_000)));
    const p = outcome(fetchJsonOnce('https://example.test/a', { headersTimeoutMs: 15_000, bodyIdleMs: 30_000 }));
    await vi.advanceTimersByTimeAsync(75_000);
    expect((await p).value).toEqual({ games: [1, 2, 3, 4] });
  });

  it('fails a body that goes silent', async () => {
    fetchMock.mockResolvedValueOnce(new Response(slowBody(['{"a":', '1}'], 45_000)));
    const p = outcome(fetchJsonOnce('https://example.test/a', { bodyIdleMs: 30_000 }));
    await vi.advanceTimersByTimeAsync(31_000);
    expect((await p).error).toMatchObject({ kind: 'timeout', phase: 'body' });
  });

  it('reports a body that is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>busy</html>'));
    expect((await outcome(fetchJsonOnce('https://example.test/a'))).error).toMatchObject({ kind: 'bad-body' });
  });

  it('stops waiting the moment it is cancelled', async () => {
    fetchMock.mockResolvedValue(json({}, 503));
    const ctl = new AbortController();
    const p = outcome(fetchJson('https://example.test/a', { signal: ctl.signal, backoffMs: 10_000 }));
    await vi.advanceTimersByTimeAsync(500);
    ctl.abort();
    const { error } = await p;
    expect(isAbortError(error)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('withRetry and sleep', () => {
  it('passes through errors that are not fetch failures', async () => {
    const attempt = vi.fn().mockRejectedValue(new Error('bug'));
    await expect(withRetry(attempt)).rejects.toThrow('bug');
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('sleep rejects when already cancelled', async () => {
    const ctl = new AbortController();
    ctl.abort();
    expect(isAbortError((await outcome(sleep(1000, ctl.signal))).error)).toBe(true);
  });
});

describe('fetchLines', () => {
  it('yields whole lines however the chunks fall, and skips blank ones', async () => {
    const enc = new TextEncoder();
    const bytes = enc.encode('{"a":1}\n\n{"b":"é"}\n{"c":3}');
    // Cut in the middle of a line and in the middle of the two-byte "é".
    const cut = bytes.indexOf(0xc3) + 1;
    const body = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(bytes.slice(0, 4));
        ctrl.enqueue(bytes.slice(4, cut));
        ctrl.enqueue(bytes.slice(cut));
        ctrl.close();
      },
    });
    fetchMock.mockResolvedValueOnce(new Response(body));
    const lines: string[] = [];
    for await (const l of fetchLines('https://example.test/stream')) lines.push(l);
    expect(lines).toEqual(['{"a":1}', '{"b":"é"}', '{"c":3}']);
  });

  it('throws a body-phase error when the stream breaks part-way', async () => {
    const enc = new TextEncoder();
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        if (!sent) {
          sent = true;
          ctrl.enqueue(enc.encode('{"a":1}\n'));
        } else {
          ctrl.error(new TypeError('network error'));
        }
      },
    });
    fetchMock.mockResolvedValueOnce(new Response(body));
    const lines: string[] = [];
    const run = (async () => {
      for await (const l of fetchLines('https://example.test/stream')) lines.push(l);
    })();
    const { error } = await outcome(run);
    expect(lines).toEqual(['{"a":1}']);
    expect(error).toMatchObject({ kind: 'network', phase: 'body' });
  });
});
