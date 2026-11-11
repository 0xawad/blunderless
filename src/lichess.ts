// Lichess game export (public, CORS-enabled, no key needed for public games).
// https://lichess.org/api#tag/Games/operation/apiGamesUser
//
// Games arrive as NDJSON, one game per line, newest first, at about twenty a
// second, so the response is read as a stream and handed on in small batches
// instead of being held in memory. Lichess asks for one export at a time and,
// after a 429, a full minute of silence before the next request.
//
// We only take what the Chess.com import takes: standard chess, finished,
// bullet to classical. Lichess's own engine evaluations are not requested;
// every game gets the same Stockfish pass here so numbers are comparable.
import { copy } from './copy';
import { FetchError, fetchJsonOnce, fetchLines, isAbortError, sleep, type PoliteOptions, type RetryInfo } from './net';
import type { AccountCheck } from './chesscom';
import type { GameRow } from './srs/types';

/** Lichess usernames: 2 to 30 letters, digits, underscores or hyphens. */
export const LICHESS_USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,29}$/;
const API = 'https://lichess.org/api';
const SITE = 'https://lichess.org';
const ID_RE = /^[A-Za-z0-9]{8,12}$/;
const SAN_RE = /^[A-Za-z0-9+#=-]{2,10}$/;
const MAX_PGN = 100_000;
const MAX_RESUMES = 4;

/** Lichess speeds as the time classes the rest of the app filters by (Chess.com's names). */
const TIME_CLASS = new Map<string, string>([
  ['ultraBullet', 'bullet'],
  ['bullet', 'bullet'],
  ['blitz', 'blitz'],
  ['rapid', 'rapid'],
  // Chess.com has no classical class: its 30 and 60 minute games are "rapid" too.
  ['classical', 'rapid'],
  ['correspondence', 'daily'],
]);

const POLITE: PoliteOptions = {
  headersTimeoutMs: 20_000,
  bodyIdleMs: 30_000,
  bodyTotalMs: 0, // a long history takes minutes; only silence counts as a failure
  retries: 2,
  backoffMs: 2_000,
  rateLimitWaitMs: 60_000, // "wait a full minute before resuming API usage"
  maxRetryAfterMs: 180_000,
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const str = (v: unknown, max = 200) => (typeof v === 'string' && v.length <= max ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

interface Side {
  name: string;
  id?: string;
  rating?: number;
}

function side(v: unknown): Side {
  if (!isObj(v)) return { name: copy.importer.anonymous };
  const user = isObj(v.user) ? v.user : null;
  const name = user ? (str(user.name, 40) ?? str(user.id, 40)) : undefined;
  const ai = num(v.aiLevel);
  return {
    name: name ?? (ai !== undefined ? copy.importer.lichessAi(ai) : copy.importer.anonymous),
    id: (user ? (str(user.id, 40) ?? name) : undefined)?.toLowerCase(),
    rating: num(v.rating),
  };
}

const clk = (centis: number) => {
  const s = Math.max(0, Math.round(centis / 100));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/** A PGN from the JSON fields, for the rare line that arrives without one. Keeps the clocks. */
function pgnFromMoves(g: Record<string, unknown>, sans: string[], white: string, black: string, result: string, url: string): string | undefined {
  if (!sans.length || !sans.every((s) => SAN_RE.test(s))) return undefined;
  const tags: [string, string][] = [['Event', 'Lichess game'], ['Site', url], ['White', white], ['Black', black], ['Result', result]];
  const clock = isObj(g.clock) ? g.clock : null;
  const initial = clock ? num(clock.initial) : undefined;
  if (initial !== undefined) tags.push(['TimeControl', `${initial}+${(clock && num(clock.increment)) ?? 0}`]);
  const clocks = Array.isArray(g.clocks) && g.clocks.length === sans.length ? g.clocks : [];
  const body = sans
    .map((san, i) => {
      const c = num(clocks[i]);
      return `${i % 2 === 0 ? `${i / 2 + 1}. ` : ''}${san}${c !== undefined ? ` { [%clk ${clk(c)}] }` : ''}`;
    })
    .join(' ');
  return `${tags.map(([k, v]) => `[${k} "${v.replace(/["\\\]]/g, '')}"]`).join('\n')}\n\n${body} ${result}`;
}

/**
 * Validates one exported game and maps it to a GameRow, or null to skip it:
 * variants, unfinished or aborted games, games without a move of yours, games
 * that are not yours, and lines with missing or malformed fields. Never throws.
 */
export function toLichessGameRow(raw: unknown, username: string): GameRow | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id, 12);
  if (!id || !ID_RE.test(id) || raw.variant !== 'standard') return null;
  const status = str(raw.status, 24);
  if (!status || status === 'created' || status === 'started' || status === 'aborted' || status === 'unknownFinish') return null;
  const timeClass = TIME_CLASS.get(str(raw.speed, 24) ?? '');
  if (!timeClass || !isObj(raw.players)) return null;

  const white = side(raw.players.white);
  const black = side(raw.players.black);
  const me = username.toLowerCase();
  const userColor = white.id === me ? 'white' : black.id === me ? 'black' : null;
  if (!userColor) return null;

  const at = num(raw.lastMoveAt) ?? num(raw.createdAt);
  if (at === undefined || at <= 0 || at > 1e14) return null;

  const sans = (str(raw.moves, 60_000) ?? '').split(' ').filter(Boolean);
  // Nothing of yours to review: White needs one ply on the board, Black two.
  if (typeof raw.moves === 'string' && sans.length < (userColor === 'white' ? 1 : 2)) return null;

  const winner = raw.winner === 'white' || raw.winner === 'black' ? raw.winner : undefined;
  const result = winner ? (winner === userColor ? 'win' : 'loss') : 'draw';
  const url = `${SITE}/${id}`;
  const pgn =
    str(raw.pgn, MAX_PGN) ??
    pgnFromMoves(raw, sans, white.name, black.name, winner === 'white' ? '1-0' : winner === 'black' ? '0-1' : '1/2-1/2', url);
  if (!pgn) return null;

  const row: GameRow = {
    id: `lichess:${id}`,
    source: 'lichess',
    url,
    pgn,
    white: white.name,
    black: black.name,
    whiteElo: white.rating,
    blackElo: black.rating,
    userColor,
    result,
    timeClass,
    endTime: new Date(at),
  };
  // Lichess names the opening too; ours replaces it when the bundled table knows the line.
  if (isObj(raw.opening)) {
    const eco = str(raw.opening.eco, 8);
    const name = str(raw.opening.name, 200);
    if (eco && name) row.opening = { eco, name };
  }
  return row;
}

export interface LichessQuery {
  /** Only games started at or after this time (ms since 1970). */
  since?: number;
  /** Only games started at or before this time. */
  until?: number;
  /** Stop after this many games. */
  max?: number;
}

export function lichessGamesUrl(username: string, q: LichessQuery = {}): string {
  const p = new URLSearchParams({
    pgnInJson: 'true',
    clocks: 'true',
    opening: 'true',
    evals: 'false',
    perfType: 'bullet,blitz,rapid,classical',
    sort: 'dateDesc',
  });
  if (q.since !== undefined) p.set('since', String(Math.floor(q.since)));
  if (q.until !== undefined) p.set('until', String(Math.floor(q.until)));
  if (q.max !== undefined) p.set('max', String(Math.max(1, Math.floor(q.max))));
  return `${API}/games/user/${encodeURIComponent(username)}?${p.toString()}`;
}

export interface LichessFetchOptions extends LichessQuery {
  signal?: AbortSignal;
  /** Called before each wait (a 429 means at least a minute), so the UI can say so. */
  onRetry?: (info: RetryInfo) => void;
  /** Rows per onBatch call. Default 40, about two seconds of download. */
  batchSize?: number;
}

export interface LichessBatchInfo {
  /** Games the server has sent so far, before filtering. */
  received: number;
  /** Start time (ms) of the oldest game received so far. */
  oldest?: number;
}

export interface LichessFetchResult {
  /** Games the server sent, before filtering. */
  received: number;
  /** False when the download stopped early: cancelled, cut off at `max`, or failed after retries. */
  complete: boolean;
  /** Start time (ms) of the oldest game received. Everything newer in the requested range has been handed over. */
  oldest?: number;
  aborted?: boolean;
  /** Why it stopped, when it failed. */
  error?: FetchError;
}

// One export at a time.
let lane: Promise<unknown> = Promise.resolve();

/**
 * Streams a player's games, newest first, calling `onBatch` with each batch of
 * mapped rows as it arrives (await it to save before more is read). If the
 * connection drops part-way the download resumes below the oldest game already
 * received. Never throws for network trouble: the result says how far it got.
 * A 'not-found' (no such player) is thrown, as is anything `onBatch` throws.
 */
export function fetchLichessGames(
  username: string,
  opts: LichessFetchOptions,
  onBatch: (rows: GameRow[], info: LichessBatchInfo) => void | Promise<void>,
): Promise<LichessFetchResult> {
  if (!LICHESS_USERNAME_RE.test(username)) return Promise.reject(new Error('bad username'));
  const run = () => download(username, opts, onBatch);
  const p = lane.then(run, run);
  lane = p.catch(() => undefined);
  return p;
}

async function download(
  username: string,
  opts: LichessFetchOptions,
  onBatch: (rows: GameRow[], info: LichessBatchInfo) => void | Promise<void>,
): Promise<LichessFetchResult> {
  const size = opts.batchSize ?? 40;
  const seen = new Set<string>();
  let batch: GameRow[] = [];
  let received = 0;
  let unreported = 0;
  let oldest: number | undefined;
  let until = opts.until;
  let resumes = 0;

  // Counted in games received, not rows kept, so progress moves even when a stretch is all skipped.
  const flush = async () => {
    if (!unreported) return;
    const rows = batch;
    batch = [];
    unreported = 0;
    await onBatch(rows, { received, oldest });
  };

  for (;;) {
    const max = opts.max !== undefined ? opts.max - received : undefined;
    const url = lichessGamesUrl(username, { since: opts.since, until, max });
    let progressed = false;
    try {
      const lines = fetchLines(url, { ...POLITE, headers: { Accept: 'application/x-ndjson' }, signal: opts.signal, onRetry: opts.onRetry });
      for await (const line of lines) {
        let raw: unknown;
        try {
          raw = JSON.parse(line);
        } catch {
          continue; // a damaged line costs one game, not the import
        }
        if (!isObj(raw)) continue;
        const id = str(raw.id, 12);
        if (id) {
          if (seen.has(id)) continue; // resumed downloads overlap by a game or two
          seen.add(id);
        }
        received++;
        unreported++;
        progressed = true;
        const created = num(raw.createdAt) ?? num(raw.lastMoveAt);
        if (created !== undefined && (oldest === undefined || created < oldest)) oldest = created;
        const row = toLichessGameRow(raw, username);
        if (row) batch.push(row);
        if (unreported >= size) await flush();
      }
      await flush();
      return { received, complete: opts.max === undefined || received < opts.max, oldest };
    } catch (e) {
      await flush(); // keep what arrived before the break
      if (isAbortError(e)) return { received, complete: false, oldest, aborted: true };
      if (!(e instanceof FetchError)) throw e;
      if (e.kind === 'not-found') throw e;
      // Opening the stream has already been retried; only a stream that broke part-way is resumed.
      if (e.phase !== 'body' || !e.retryable || resumes >= MAX_RESUMES || (!progressed && resumes > 0)) {
        return { received, complete: false, oldest, error: e };
      }
      resumes++;
      if (oldest !== undefined) until = oldest;
      const waitMs = Math.min(30_000, 2_000 * 2 ** (resumes - 1));
      opts.onRetry?.({ attempt: resumes, waitMs, reason: e.kind === 'timeout' ? 'timeout' : 'network' });
      try {
        await sleep(waitMs, opts.signal);
      } catch {
        return { received, complete: false, oldest, aborted: true };
      }
    }
  }
}

/** Does this Lichess account exist? A light request, so it does not wait behind a running export. */
export async function checkLichess(username: string, signal?: AbortSignal): Promise<AccountCheck> {
  const u = username.trim();
  if (!LICHESS_USERNAME_RE.test(u)) return 'invalid';
  const url = `${API}/user/${encodeURIComponent(u)}`;
  for (let attempt = 0; ; attempt++) {
    try {
      const user = await fetchJsonOnce(url, { signal, headersTimeoutMs: 10_000, headers: { Accept: 'application/json' } });
      // Closed accounts still answer, with nothing in them to import.
      return isObj(user) && user.disabled === true ? 'not-found' : 'ok';
    } catch (e) {
      if (e instanceof FetchError && e.kind === 'not-found') return 'not-found';
      // One more try for a network blip. Never after a 429: Lichess wants a minute of silence then.
      const again = e instanceof FetchError && e.retryable && e.kind !== 'rate-limited' && attempt === 0;
      if (!again) return 'unreachable';
      try {
        await sleep(1_000, signal);
      } catch {
        return 'unreachable';
      }
    }
  }
}
