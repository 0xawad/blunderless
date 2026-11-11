// Chess.com published-data API (public, CORS-enabled, no key).
// https://www.chess.com/news/view/published-data-api
//
// Chess.com asks for one request at a time and answers 429 to parallel ones,
// so every call in this file goes through one lane. Monthly archives are
// fetched one by one (see games/store.ts, which saves each month as it
// arrives); a failed request is retried with backoff, honouring Retry-After.
import { FetchError, fetchJsonOnce, withRetry, type PoliteOptions, type RetryInfo } from './net';
import type { GameRow } from './srs/types';

export const USERNAME_RE = /^[A-Za-z0-9_-]{3,25}$/;
const API = 'https://api.chess.com/pub';
const ARCHIVE_RE = /^https:\/\/api\.chess\.com\/pub\/player\/[a-z0-9_-]{3,25}\/games\/(\d{4})\/(\d{2})$/;
const MAX_PGN = 100_000;
const START_BOARD = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
const DRAWS = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']);
const LOSSES = new Set(['checkmated', 'timeout', 'resigned', 'lose', 'abandoned']);

export type AccountCheck = 'ok' | 'not-found' | 'invalid' | 'unreachable';

export interface ChessComFetchOptions {
  signal?: AbortSignal;
  /** Called before each wait between retries. */
  onRetry?: (info: RetryInfo) => void;
}

const POLITE: PoliteOptions = {
  headersTimeoutMs: 15_000, // time to first byte
  bodyIdleMs: 30_000, // a big month on a slow link may take minutes, as long as it keeps coming
  bodyTotalMs: 300_000,
  retries: 3,
  backoffMs: 1_500,
  rateLimitWaitMs: 5_000,
  maxRetryAfterMs: 90_000,
};

// One request at a time, whoever asks. Waits between retries happen outside the lane.
let lane: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = lane.then(fn, fn);
  lane = p.catch(() => undefined);
  return p;
}

function getJson(url: string, opts: PoliteOptions): Promise<unknown> {
  const o = { ...POLITE, ...opts };
  return withRetry(() => serial(() => fetchJsonOnce(url, o)), o);
}

/** Does this Chess.com account exist? One quick attempt and one retry. */
export async function checkChessCom(username: string, signal?: AbortSignal): Promise<AccountCheck> {
  const u = username.trim();
  if (!USERNAME_RE.test(u)) return 'invalid';
  try {
    await getJson(`${API}/player/${encodeURIComponent(u.toLowerCase())}`, { signal, retries: 1, headersTimeoutMs: 10_000 });
    return 'ok';
  } catch (e) {
    return e instanceof FetchError && e.kind === 'not-found' ? 'not-found' : 'unreachable';
  }
}

/** true / false when Chess.com answers clearly, undefined when it couldn't be reached. */
export async function chessComPlayerExists(username: string): Promise<boolean | undefined> {
  const r = await checkChessCom(username);
  return r === 'ok' ? true : r === 'unreachable' ? undefined : false;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const str = (v: unknown, max = 200) => (typeof v === 'string' && v.length <= max ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

const header = (pgn: string, name: string) => new RegExp(`\\[${name} "([^"]*)"\\]`).exec(pgn)?.[1];

/** A game's end as a Date, from the API field or, failing that, the PGN's own date headers. */
function endTimeOf(g: Record<string, unknown>, pgn: string): Date | null {
  const secs = num(g.end_time);
  if (secs !== undefined && secs > 0 && secs < 1e11) return new Date(secs * 1000);
  const day = header(pgn, 'EndDate') ?? header(pgn, 'UTCDate') ?? header(pgn, 'Date');
  const time = header(pgn, 'EndTime') ?? header(pgn, 'UTCTime') ?? '00:00:00';
  const m = day && /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(day);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${/^\d{2}:\d{2}:\d{2}/.exec(time)?.[0] ?? '00:00:00'}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Your result, from your own result code, your opponent's, or the PGN, in that order. */
function resultOf(mine: string, theirs: string, pgn: string, color: 'white' | 'black'): GameRow['result'] | null {
  if (mine === 'win') return 'win';
  if (DRAWS.has(mine)) return 'draw';
  if (LOSSES.has(mine)) return 'loss';
  if (theirs === 'win') return 'loss';
  if (DRAWS.has(theirs)) return 'draw';
  if (LOSSES.has(theirs)) return 'win';
  const r = header(pgn, 'Result');
  if (r === '1/2-1/2') return 'draw';
  if (r === '1-0') return color === 'white' ? 'win' : 'loss';
  if (r === '0-1') return color === 'black' ? 'win' : 'loss';
  return mine ? 'loss' : null; // an unknown code that is neither a win nor a draw has always meant a loss
}

/**
 * Validates one archive entry and maps it to a GameRow, or null to skip it:
 * variants, games from a set-up position, games that are not yours, and
 * entries with missing or malformed fields. Never throws.
 */
export function toGameRow(raw: unknown, username: string): GameRow | null {
  if (!isObj(raw)) return null;
  const g = raw;
  const pgn = str(g.pgn, MAX_PGN);
  const id = str(g.uuid, 64) ?? str(g.url, 300);
  if (!pgn || !id || g.rules !== 'chess' || !isObj(g.white) || !isObj(g.black)) return null;
  // "rules: chess" still covers games started from a custom position; openings and book checks assume the usual start.
  // Only a well-formed board that differs from the start counts, so an odd or empty value never drops a normal game.
  const board = (header(pgn, 'FEN') ?? str(g.initial_setup, 100))?.split(' ')[0];
  if (board && board.split('/').length === 8 && board !== START_BOARD) return null;

  const wName = str(g.white.username, 40) ?? '?';
  const bName = str(g.black.username, 40) ?? '?';
  const me = username.toLowerCase();
  const userColor = wName.toLowerCase() === me ? 'white' : bName.toLowerCase() === me ? 'black' : null;
  if (!userColor) return null;

  const mine = userColor === 'white' ? g.white : g.black;
  const theirs = userColor === 'white' ? g.black : g.white;
  const result = resultOf(str(mine.result, 40) ?? '', str(theirs.result, 40) ?? '', pgn, userColor);
  const endTime = endTimeOf(g, pgn);
  if (!result || !endTime) return null;
  const url = str(g.url, 300);

  return {
    id,
    source: 'chesscom',
    url: url?.startsWith('https://www.chess.com/') ? url : undefined,
    pgn,
    white: wName,
    black: bName,
    whiteElo: num(g.white.rating),
    blackElo: num(g.black.rating),
    userColor,
    result,
    timeClass: str(g.time_class, 20) ?? 'unknown',
    endTime,
  };
}

/** One monthly archive. */
export interface ArchiveRef {
  url: string;
  /** year * 100 + month, for comparing. */
  key: number;
  /** 'YYYY-MM' */
  label: string;
}

/** 'YYYY-MM' for a date, in UTC. */
export const monthOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/** The months this player has games in, oldest first. Throws a FetchError ('not-found' for no such player). */
export async function listArchives(username: string, opts: ChessComFetchOptions = {}): Promise<ArchiveRef[]> {
  if (!USERNAME_RE.test(username)) throw new Error('bad username');
  const u = encodeURIComponent(username.toLowerCase());
  const data = await getJson(`${API}/player/${u}/games/archives`, opts);
  const list = isObj(data) && Array.isArray(data.archives) ? data.archives : [];
  const refs: ArchiveRef[] = [];
  for (const a of list) {
    const m = typeof a === 'string' ? ARCHIVE_RE.exec(a) : null;
    if (m) refs.push({ url: m[0], key: Number(m[1]) * 100 + Number(m[2]), label: `${m[1]}-${m[2]}` });
  }
  return refs.sort((a, b) => a.key - b.key);
}

/** Every usable game of yours in one monthly archive. Throws a FetchError when the month can't be fetched. */
export async function fetchArchive(ref: ArchiveRef, username: string, opts: ChessComFetchOptions = {}): Promise<GameRow[]> {
  const month = await getJson(ref.url, opts);
  const games = isObj(month) && Array.isArray(month.games) ? month.games : [];
  const rows: GameRow[] = [];
  for (const g of games) {
    const row = toGameRow(g, username);
    if (row) rows.push(row);
  }
  return rows;
}

/**
 * The most recent `months` monthly archives, newest first, fetched one at a time.
 * With `since`, only archives from that month on are fetched.
 * All or nothing: prefer importFrom('chesscom', ...) in games/store.ts, which
 * saves month by month and survives a failed one.
 */
export async function fetchRecentGames(username: string, months = 3, since?: Date, opts: ChessComFetchOptions = {}): Promise<GameRow[]> {
  const archives = await listArchives(username, opts);
  const sinceKey = since ? since.getUTCFullYear() * 100 + since.getUTCMonth() + 1 : 0;
  const rows: GameRow[] = [];
  for (const ref of archives.slice(-months).filter((a) => a.key >= sinceKey).reverse()) {
    rows.push(...(await fetchArchive(ref, username, opts)));
  }
  return rows;
}
