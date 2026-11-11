// Polite fetch helpers for the public game APIs (Chess.com, Lichess).
//
// Both sites are free, unauthenticated and rate limited, so every request here:
//  - sends no cookies and no referrer,
//  - has a short timeout until the response headers arrive and a separate,
//    much longer allowance for the body (a monthly archive can be several MB),
//  - is retried a few times on 429, 5xx, timeouts and network errors, waiting
//    at least as long as the server's Retry-After header asks,
//  - can be cancelled with an AbortSignal at any point, including mid-wait.
//
// Nothing in here knows about chess; chesscom.ts and lichess.ts build on it.

export type FetchFailure = 'not-found' | 'rate-limited' | 'http' | 'network' | 'timeout' | 'bad-body';

export class FetchError extends Error {
  readonly kind: FetchFailure;
  readonly status?: number;
  /** Milliseconds the server asked us to wait (Retry-After), when it said. */
  readonly retryAfterMs?: number;
  /** 'headers': no usable response at all. 'body': the response started and then broke. */
  readonly phase: 'headers' | 'body';

  constructor(kind: FetchFailure, message: string, extra: { status?: number; retryAfterMs?: number; phase?: 'headers' | 'body' } = {}) {
    super(message);
    this.name = 'FetchError';
    this.kind = kind;
    this.status = extra.status;
    this.retryAfterMs = extra.retryAfterMs;
    this.phase = extra.phase ?? 'headers';
  }

  /** Worth trying again: the server was busy or the network hiccupped. */
  get retryable(): boolean {
    if (this.kind === 'not-found') return false;
    if (this.kind === 'http') return (this.status ?? 0) >= 500;
    return true;
  }
}

export function abortError(): Error {
  const e = new Error('aborted');
  e.name = 'AbortError';
  return e;
}

export const isAbortError = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError';

/** Waits `ms`; rejects with an AbortError as soon as `signal` fires. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Retry-After as milliseconds: either a number of seconds or an HTTP date. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000);
  const at = Date.parse(v);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

export interface RetryInfo {
  /** 1 for the first retry. */
  attempt: number;
  waitMs: number;
  reason: 'rate-limited' | 'server' | 'network' | 'timeout';
  status?: number;
}

export interface PoliteOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** Longest wait for the response headers. Default 15s. */
  headersTimeoutMs?: number;
  /** Longest silence while the body downloads. Default 30s. */
  bodyIdleMs?: number;
  /** Longest total body download; 0 for no limit. Default 5 minutes. */
  bodyTotalMs?: number;
  /** Refuse bodies larger than this. Default 80 MB. */
  maxBytes?: number;
  /** Retries after the first attempt. Default 3. */
  retries?: number;
  /** First backoff; doubles each retry. Default 1s. */
  backoffMs?: number;
  /** Backoff ceiling. Default 30s. */
  maxBackoffMs?: number;
  /** Shortest wait after a 429. Default 5s. */
  rateLimitWaitMs?: number;
  /** Give up instead of waiting longer than this for a Retry-After. Default 2 minutes. */
  maxRetryAfterMs?: number;
  /** Called before each wait, so a UI can say why nothing is happening. */
  onRetry?: (info: RetryInfo) => void;
}

const DEFAULTS = {
  headersTimeoutMs: 15_000,
  bodyIdleMs: 30_000,
  bodyTotalMs: 300_000,
  maxBytes: 80_000_000,
  retries: 3,
  backoffMs: 1_000,
  maxBackoffMs: 30_000,
  rateLimitWaitMs: 5_000,
  maxRetryAfterMs: 120_000,
};

/**
 * Settles with `p`, or rejects with a timeout after `ms` or an AbortError when
 * `signal` fires, whichever comes first. A promise that loses the race is still
 * observed, so it never surfaces as an unhandled rejection.
 */
function race<T>(p: Promise<T>, ms: number, signal: AbortSignal | undefined, phase: 'headers' | 'body'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    p.then(
      (v) => {
        cleanup();
        resolve(v);
      },
      (e) => {
        cleanup();
        reject(e);
      },
    );
    if (signal?.aborted) return onAbort();
    if (ms > 0 && Number.isFinite(ms)) {
      timer = setTimeout(() => {
        cleanup();
        reject(new FetchError('timeout', phase === 'headers' ? 'no answer in time' : 'download stalled', { phase }));
      }, ms);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

interface Opened {
  res: Response;
  /** Cancels the request and frees the connection. Safe to call twice. */
  close: () => void;
}

/** One GET. Resolves once the headers are in and the status is OK. */
async function open(url: string, opts: PoliteOptions): Promise<Opened> {
  if (opts.signal?.aborted) throw abortError();
  const ctl = new AbortController();
  const forward = () => ctl.abort();
  opts.signal?.addEventListener('abort', forward, { once: true });
  const close = () => {
    opts.signal?.removeEventListener('abort', forward);
    ctl.abort();
  };

  let res: Response;
  try {
    res = await race(
      fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', headers: opts.headers, signal: ctl.signal }),
      opts.headersTimeoutMs ?? DEFAULTS.headersTimeoutMs,
      opts.signal,
      'headers',
    );
  } catch (e) {
    close();
    if (opts.signal?.aborted || isAbortError(e)) throw abortError();
    if (e instanceof FetchError) throw e;
    throw new FetchError('network', 'could not reach the server');
  }

  if (res.ok) return { res, close };
  const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
  const status = res.status;
  void res.body?.cancel().catch(() => undefined);
  close();
  if (status === 404 || status === 410) throw new FetchError('not-found', `not found (${status})`, { status });
  if (status === 429) throw new FetchError('rate-limited', 'rate limited (429)', { status, retryAfterMs });
  throw new FetchError('http', `server answered ${status}`, { status, retryAfterMs });
}

/** The body in pieces, with an idle timeout between pieces and an overall limit. */
async function* chunks(o: Opened, opts: PoliteOptions): AsyncGenerator<Uint8Array> {
  const idle = opts.bodyIdleMs ?? DEFAULTS.bodyIdleMs;
  const total = opts.bodyTotalMs ?? DEFAULTS.bodyTotalMs;
  const maxBytes = opts.maxBytes ?? DEFAULTS.maxBytes;
  const started = Date.now();
  const reader = o.res.body?.getReader();
  let bytes = 0;
  try {
    if (!reader) {
      // No stream to read from (very old browsers): take the body in one piece.
      const buf = new Uint8Array(await race(o.res.arrayBuffer(), total || idle, opts.signal, 'body'));
      if (buf.byteLength > maxBytes) throw new FetchError('bad-body', 'response too large', { phase: 'body' });
      yield buf;
      return;
    }
    for (;;) {
      const left = total > 0 ? total - (Date.now() - started) : Infinity;
      if (left <= 0) throw new FetchError('timeout', 'download took too long', { phase: 'body' });
      const r = await race(reader.read(), Math.min(idle, left), opts.signal, 'body');
      if (r.done) return;
      if (!r.value?.byteLength) continue;
      bytes += r.value.byteLength;
      if (bytes > maxBytes) throw new FetchError('bad-body', 'response too large', { phase: 'body' });
      yield r.value;
    }
  } catch (e) {
    if (opts.signal?.aborted || isAbortError(e)) throw abortError();
    if (e instanceof FetchError) throw e;
    throw new FetchError('network', 'connection lost during download', { phase: 'body' });
  } finally {
    void reader?.cancel().catch(() => undefined);
    o.close();
  }
}

/** How long to wait before retry number `attempt` (0-based), or null to give up. */
function retryDelay(e: FetchError, attempt: number, opts: PoliteOptions): number | null {
  const base = opts.backoffMs ?? DEFAULTS.backoffMs;
  const cap = opts.maxBackoffMs ?? DEFAULTS.maxBackoffMs;
  // Up to 25% either way, so several tabs do not retry in step.
  const backoff = Math.min(cap, base * 2 ** attempt) * (0.75 + Math.random() * 0.5);
  const asked = e.retryAfterMs ?? 0;
  if (asked > (opts.maxRetryAfterMs ?? DEFAULTS.maxRetryAfterMs)) return null;
  const floor = e.kind === 'rate-limited' ? (opts.rateLimitWaitMs ?? DEFAULTS.rateLimitWaitMs) : 0;
  return Math.round(Math.max(asked, floor, backoff));
}

const reasonOf = (e: FetchError): RetryInfo['reason'] =>
  e.kind === 'rate-limited' ? 'rate-limited' : e.kind === 'timeout' ? 'timeout' : e.kind === 'network' ? 'network' : 'server';

/**
 * Runs `attempt` until it succeeds, retrying FetchErrors that are worth
 * retrying. Anything else (not found, a cancel, a bug) is thrown at once.
 */
export async function withRetry<T>(attempt: () => Promise<T>, opts: PoliteOptions = {}): Promise<T> {
  const retries = opts.retries ?? DEFAULTS.retries;
  for (let n = 0; ; n++) {
    try {
      return await attempt();
    } catch (e) {
      if (!(e instanceof FetchError) || !e.retryable || n >= retries) throw e;
      const waitMs = retryDelay(e, n, opts);
      if (waitMs === null) throw e;
      opts.onRetry?.({ attempt: n + 1, waitMs, reason: reasonOf(e), status: e.status });
      await sleep(waitMs, opts.signal);
    }
  }
}

/** One GET of a JSON document, no retries. */
export async function fetchJsonOnce(url: string, opts: PoliteOptions = {}): Promise<unknown> {
  const o = await open(url, opts);
  const dec = new TextDecoder();
  let text = '';
  for await (const c of chunks(o, opts)) text += dec.decode(c, { stream: true });
  text += dec.decode();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new FetchError('bad-body', 'response was not valid JSON', { phase: 'body' });
  }
}

/** GET a JSON document, retrying politely. */
export function fetchJson(url: string, opts: PoliteOptions = {}): Promise<unknown> {
  return withRetry(() => fetchJsonOnce(url, opts), opts);
}

/**
 * GET a line-delimited stream (NDJSON) and yield each non-empty line as it
 * arrives. Opening the stream is retried; once lines are flowing, a broken
 * connection throws a FetchError with phase 'body' and the caller decides how
 * to resume. There is no overall time limit, only the idle one.
 */
export async function* fetchLines(url: string, opts: PoliteOptions = {}): AsyncGenerator<string> {
  const o = await withRetry(() => open(url, opts), opts);
  const dec = new TextDecoder();
  let buf = '';
  for await (const c of chunks(o, { ...opts, bodyTotalMs: opts.bodyTotalMs ?? 0 })) {
    buf += dec.decode(c, { stream: true });
    const parts = buf.split('\n');
    buf = parts.pop() ?? '';
    for (const p of parts) {
      const line = p.trim();
      if (line) yield line;
    }
  }
  const tail = (buf + dec.decode()).trim();
  if (tail) yield tail;
}
