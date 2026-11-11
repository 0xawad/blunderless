// Games in the browser database: importing them, naming their openings and
// turning their mistakes into puzzles.
//
// IMPORT API (for the Games, Settings and Welcome pages)
//
//   importFrom(source, username, { months?, signal?, onProgress? }) -> ImportResult
//     Downloads new games from 'chesscom' or 'lichess' and saves them as they
//     arrive: Chess.com month by month, Lichess in batches of about forty. A
//     failure part-way keeps everything already saved, and the next import
//     fetches only what is still missing.
//       - Resolves with { added, failed, partial, requeued }. `failed` lists
//         the months ('YYYY-MM', see monthLabel) that could not be downloaded;
//         `partial` is true when any failed or the import was cancelled
//         (`aborted`). `reason` says why: 'rate-limited' or 'unreachable'.
//       - Rejects with an ImportError when nothing could be imported at all:
//         kind 'invalid' (bad username), 'not-found' (no such player),
//         'unreachable', 'rate-limited', 'storage' (the browser refused to
//         save) or 'busy' (another username is being imported from that site).
//       - One import per site at a time. A second call for the same username
//         (a remounted page, a double click, a second button) joins the one
//         already running and gets the same result.
//       - onProgress receives ImportProgress: `phase`, `done`/`total` in the
//         unit of that phase (months for Chess.com downloads, games received
//         for Lichess, games parsed while saving), the running `added` count,
//         and `label`, a ready-to-show status line. `waiting` is true while
//         the importer sits out a rate limit or a retry delay; the label then
//         says how long. useImportStatus() gives the same to any component.
//       - `signal` cancels it, and so does cancelImport(source) from anywhere
//         (the import keeps running when the page that started it unmounts);
//         what was saved stays saved.
//
//   getAccounts() / setAccount(source, username) / checkAccount(source, username)
//     The stored usernames (settings 'username' for Chess.com, 'lichessUsername'
//     for Lichess) and a cheap existence check against the site.
//
//   needsAnalysis(game)
//     The one predicate for "this game is waiting for Stockfish".
//
// What each import remembers (settings):
//   'imported'         { user, months, done?: ['YYYY-MM', ...] }  Chess.com.
//                      `done` lists finished months that never need fetching
//                      again; older data without it still works.
//   'importedLichess'  { user, from, to }  the time span (ms) already downloaded.
import Dexie from 'dexie';
import { useSyncExternalStore } from 'react';
import { parseGamePgn, type GamePly } from '../chess/game';
import { USERNAME_RE, checkChessCom, fetchArchive, listArchives, monthOf, type AccountCheck, type ArchiveRef } from '../chesscom';
import { copy } from '../copy';
import { LICHESS_USERNAME_RE, checkLichess, fetchLichessGames, type LichessFetchResult } from '../lichess';
import { FetchError, isAbortError, type RetryInfo } from '../net';
import { getLine } from '../repertoire';
import { db, getSetting, makeLineDue, setSetting, syncGamePuzzles } from '../srs/db';
import type { GameRow, PuzzleRow } from '../srs/types';
import { ANALYSIS_VERSION, MIN_USER_PLIES, analyzeGame, userPlyCount, type AnalyzeOptions } from './analyze';
import { bookReport } from './book';
import { loadOpenings, nameOpening, type OpeningBook } from './openings';
import { plyClocks, parseTimeControl } from './clock';

export type { AccountCheck } from '../chesscom';

export type GameSource = 'chesscom' | 'lichess';

export interface ImportProgress {
  source: GameSource;
  phase: 'listing' | 'downloading' | 'saving';
  /** In the unit of the phase: months (Chess.com) or games received (Lichess) while downloading, games while saving. */
  done: number;
  total?: number;
  /** Games added so far in this import. */
  added: number;
  /** A ready-to-show status line: the month being fetched, or why we are waiting. */
  label?: string;
  /** True while sitting out a rate limit or a retry delay. */
  waiting?: boolean;
}

export interface ImportResult {
  source: GameSource;
  added: number;
  /** Months ('YYYY-MM') that could not be downloaded this time. A later import picks them up. */
  failed: string[];
  /** True when something is missing: failed months, or the import was cancelled part-way. */
  partial: boolean;
  /** Repertoire lines put back in the drill queue because a new game left them. */
  requeued: number;
  /** True when `signal` cancelled the import. */
  aborted?: boolean;
  /** Why months failed, when they did. */
  reason?: 'rate-limited' | 'unreachable';
}

export type ImportFailure = 'invalid' | 'not-found' | 'unreachable' | 'rate-limited' | 'storage' | 'busy';

/** importFrom rejects with this when nothing could be imported. */
export class ImportError extends Error {
  readonly source: GameSource;
  readonly kind: ImportFailure;
  /** Months that were tried and failed, when it got that far. */
  readonly failed: string[];

  constructor(source: GameSource, kind: ImportFailure, failed: string[] = [], cause?: unknown) {
    super(`import from ${source} failed: ${kind}`, { cause });
    this.name = 'ImportError';
    this.source = source;
    this.kind = kind;
    this.failed = failed;
  }
}

/** A database write failed (quota, a closed or blocked database). Nothing after it will work either. */
export class StorageError extends Error {
  constructor(cause: unknown) {
    super(`storage: ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}`, { cause });
    this.name = 'StorageError';
  }
}

export function isStorageError(e: unknown): boolean {
  return e instanceof StorageError || e instanceof Dexie.DexieError || (e instanceof Error && /quota/i.test(e.name));
}

async function write<T>(fn: () => PromiseLike<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw e instanceof StorageError ? e : new StorageError(e);
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/**
 * Lets the browser paint and handle input between chunks of main-thread work.
 * Not a timer where it can be helped: browsers slow timers in background tabs
 * to one a second or worse, which would stretch a big import to hours.
 */
function breathe(): Promise<void> {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof s?.yield === 'function') return s.yield();
  if (typeof MessageChannel === 'undefined') return new Promise<void>((r) => setTimeout(r, 0));
  return new Promise<void>((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(null);
  });
}

// ---- accounts ---------------------------------------------------------------

const ACCOUNT_KEY: Record<GameSource, string> = { chesscom: 'username', lichess: 'lichessUsername' };
const USERNAME: Record<GameSource, RegExp> = { chesscom: USERNAME_RE, lichess: LICHESS_USERNAME_RE };

export const validUsername = (source: GameSource, username: string): boolean => USERNAME[source].test(username.trim());

export async function getAccounts(): Promise<{ chesscom?: string; lichess?: string }> {
  const [chesscom, lichess] = await Promise.all([getSetting<string>(ACCOUNT_KEY.chesscom), getSetting<string>(ACCOUNT_KEY.lichess)]);
  return { chesscom: chesscom || undefined, lichess: lichess || undefined };
}

/** Stores (or, with undefined or '', clears) the username for a site. Throws ImportError 'invalid' for a name the site could not have. */
export async function setAccount(source: GameSource, username: string | undefined): Promise<void> {
  const u = username?.trim();
  if (u && !validUsername(source, u)) throw new ImportError(source, 'invalid');
  await setSetting(ACCOUNT_KEY[source], u || undefined);
}

export function checkAccount(source: GameSource, username: string): Promise<AccountCheck> {
  return source === 'chesscom' ? checkChessCom(username) : checkLichess(username);
}

// ---- preparing and saving rows ---------------------------------------------

export function withBook(row: GameRow, openings?: OpeningBook): GameRow {
  try {
    const plies = parseGamePgn(row.pgn);
    const named = openings ? nameOpening(plies, openings) : null;
    return {
      ...row,
      book: bookReport(plies, row.userColor),
      opening: named ? { eco: named.eco, name: named.name } : row.opening,
    };
  } catch {
    return row; // unparseable PGN: keep the game, skip the report
  }
}

/**
 * An imported row made ready to store: book report, opening name. Null when
 * you never moved (an aborted game has nothing to review). A PGN that cannot
 * be replayed is kept, flagged so it never queues for analysis.
 */
function prepareRow(row: GameRow, openings?: OpeningBook): GameRow | null {
  let plies: GamePly[];
  try {
    plies = parseGamePgn(row.pgn);
  } catch {
    return { ...row, unreadable: true };
  }
  if (userPlyCount(plies, row.userColor) < 1) return null;
  const named = openings ? nameOpening(plies, openings) : null;
  const out: GameRow = { ...row, book: bookReport(plies, row.userColor) };
  if (named) out.opening = { eco: named.eco, name: named.name };
  else if (openings && !out.opening) out.openingChecked = true;
  return out;
}

const CHUNK = 20;

/**
 * Stores the rows that are not in the database yet and returns them. PGNs are
 * parsed a few at a time with a pause in between, so a month of thousands of
 * games does not freeze the page. Safe against another tab importing the same
 * games: ids are re-checked inside the write transaction.
 */
async function saveRows(rows: GameRow[], openings: OpeningBook | undefined, onChunk?: (done: number, total: number) => void): Promise<GameRow[]> {
  if (!rows.length) return [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const have = new Set(await db.games.where('id').anyOf([...byId.keys()]).primaryKeys());
  const todo = [...byId.values()].filter((r) => !have.has(r.id));
  const ready: GameRow[] = [];
  for (let i = 0; i < todo.length; i += CHUNK) {
    for (const r of todo.slice(i, i + CHUNK)) {
      const row = prepareRow(r, openings);
      if (row) ready.push(row);
    }
    onChunk?.(Math.min(todo.length, i + CHUNK), todo.length);
    await breathe();
  }
  if (!ready.length) return [];
  return write(() =>
    db.transaction('rw', db.games, async () => {
      const now = new Set(await db.games.where('id').anyOf(ready.map((r) => r.id)).primaryKeys());
      const fresh = ready.filter((r) => !now.has(r.id));
      await db.games.bulkPut(fresh);
      return fresh;
    }),
  );
}

/**
 * Requeues the repertoire lines you went wrong in.
 * Only lines you've already started: an unlearned line isn't a memory lapse.
 */
async function requeueLines(fresh: GameRow[]): Promise<number> {
  let requeued = 0;
  for (const g of fresh) {
    const line = g.book?.status === 'you-deviated' && g.book.lineId ? getLine(g.book.lineId) : undefined;
    const card = line && (await db.cards.get(line.id));
    // A mistake from before you learned the line isn't a lapse.
    if (line && card && g.endTime > card.addedAt) {
      await write(() => makeLineDue(line));
      requeued++;
    }
  }
  return requeued;
}

// ---- import status (outside React, like the analysis queue) -----------------

export type ImportStatus = { [S in GameSource]?: ImportProgress };

let status: ImportStatus = {};
const statusListeners = new Set<() => void>();

function setStatus(source: GameSource, p: ImportProgress | undefined) {
  status = { ...status, [source]: p };
  for (const l of statusListeners) l();
}

export function subscribeImports(l: () => void) {
  statusListeners.add(l);
  return () => void statusListeners.delete(l);
}

/** The latest progress of each running import; a site that is not importing is absent. */
export const getImportStatus = () => status;

export function useImportStatus(): ImportStatus {
  return useSyncExternalStore(subscribeImports, getImportStatus, getImportStatus);
}

type Emit = (p: Omit<ImportProgress, 'source'>) => void;

const waitLabel = (site: string, info: RetryInfo) => {
  const secs = Math.max(1, Math.round(info.waitMs / 1000));
  return info.reason === 'rate-limited' ? copy.importer.rateLimited(site, secs) : copy.importer.retrying(site, secs);
};

/** 'YYYY-MM' as a month name in the reader's language, e.g. "March 2026". */
export function monthLabel(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return ym;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

const reasonOf = (e: FetchError | undefined): 'rate-limited' | 'unreachable' => (e?.kind === 'rate-limited' ? 'rate-limited' : 'unreachable');

// ---- Chess.com --------------------------------------------------------------

interface ChessComMarker {
  user: string;
  months: number;
  done?: string[];
}

/**
 * A month's archive only stops changing once the month is over everywhere
 * and Chess.com's caches have caught up; three days is generous.
 */
const SETTLE_MS = 3 * 86_400_000;

/** Your most recent stored game from a site, if there is one. */
function newestStored(source: GameSource, me: string): Promise<GameRow | undefined> {
  return db.games
    .orderBy('endTime')
    .reverse()
    .filter((g) => g.source === source && (g.white.toLowerCase() === me || g.black.toLowerCase() === me))
    .first();
}

async function runChessComImport(username: string, months: number, signal: AbortSignal | undefined, emit: Emit): Promise<ImportResult> {
  const site = copy.importer.sites.chesscom;
  const me = username.toLowerCase();
  const saved = await getSetting<ChessComMarker>('imported');
  const newest = saved && saved.user === me ? await newestStored('chesscom', me) : undefined;
  // The marker describes games that should be in the database. With none there
  // (a reset, a cleared browser) it describes nothing, and everything is fetched again.
  const mine = saved && newest ? saved : undefined;
  const result = (r: Partial<ImportResult>): ImportResult => ({ source: 'chesscom', added: 0, failed: [], partial: false, requeued: 0, ...r });

  let archives: ArchiveRef[];
  try {
    archives = await listArchives(username, {
      signal,
      onRetry: (info) => emit({ phase: 'listing', done: 0, added: 0, label: waitLabel(site, info), waiting: true }),
    });
  } catch (e) {
    if (isAbortError(e)) return result({ partial: true, aborted: true });
    throw e;
  }

  const done = new Set(Array.isArray(mine?.done) ? mine.done : []);
  if (mine && !Array.isArray(mine.done) && mine.months > 0) {
    // Imports from before months were tracked were all or nothing: every month up to
    // the one holding your newest stored game was fetched in full, `months` archives back.
    const newestKey = newest!.endTime.getUTCFullYear() * 100 + newest!.endTime.getUTCMonth() + 1;
    for (const a of archives.slice(-mine.months)) if (a.key < newestKey) done.add(a.label);
  }

  const cut = new Date(Date.now() - SETTLE_MS);
  const cutKey = cut.getUTCFullYear() * 100 + cut.getUTCMonth() + 1;
  const settled = (a: ArchiveRef) => a.key < cutKey;
  // Newest first, one at a time. Finished months already fetched are never asked for again.
  const todo = archives.slice(-months).filter((a) => !(done.has(a.label) && settled(a))).reverse();
  const openings = await loadOpenings().catch(() => undefined);
  const keptMonths = isNum(mine?.months) ? mine.months : 0;
  const mark = (m: number) => write(() => setSetting('imported', { user: me, months: m, done: [...done].sort() }));

  let added = 0;
  let requeued = 0;
  let aborted = false;
  let streak = 0;
  let reason: ImportResult['reason'];
  const failed: string[] = [];
  const rest = (from: number) => todo.slice(from).map((a) => a.label);

  for (let i = 0; i < todo.length; i++) {
    const ref = todo[i];
    if (signal?.aborted) {
      aborted = true;
      failed.push(...rest(i));
      break;
    }
    const at = { phase: 'downloading' as const, done: i, total: todo.length };
    emit({ ...at, added, label: copy.importer.month(monthLabel(ref.label)) });
    let rows: GameRow[];
    try {
      rows = await fetchArchive(ref, username, {
        signal,
        onRetry: (info) => emit({ ...at, added, label: waitLabel(site, info), waiting: true }),
      });
    } catch (e) {
      if (isAbortError(e)) {
        aborted = true;
        failed.push(...rest(i));
        break;
      }
      if (!(e instanceof FetchError)) throw e;
      if (e.kind === 'not-found') {
        // Listed but gone: nothing there to fetch, now or later.
        if (settled(ref)) done.add(ref.label);
        continue;
      }
      failed.push(ref.label);
      reason = reasonOf(e);
      // Told to back off, or two months in a row with no answer: asking for the rest now only makes it worse.
      if (e.kind === 'rate-limited' || ++streak >= 2) {
        failed.push(...rest(i + 1));
        break;
      }
      continue;
    }
    streak = 0;
    const fresh = await saveRows(rows, openings, (n, total) =>
      emit({ phase: 'saving', done: n, total, added, label: copy.importer.saving(total) }),
    );
    added += fresh.length;
    requeued += await requeueLines(fresh);
    // Saved, so remember it now: a crash or a closed tab later must not cost this month again.
    if (settled(ref)) done.add(ref.label);
    await mark(keptMonths);
  }

  if (!failed.length && !aborted) await mark(Math.max(months, keptMonths));
  else if (todo.length && failed.length === todo.length && !aborted) {
    throw new ImportError('chesscom', reason ?? 'unreachable', failed);
  }
  return result({ added, requeued, failed, partial: failed.length > 0 || aborted, aborted: aborted || undefined, reason: failed.length && !aborted ? reason : undefined });
}

// ---- Lichess ----------------------------------------------------------------

interface LichessMarker {
  user: string;
  /** Everything between these two times (ms) has been downloaded. */
  from: number;
  to: number;
}

const DAY = 86_400_000;
/** A game started before the last import can have finished after it; look back this far to catch it. */
const LICHESS_OVERLAP = DAY;
/** Safety valve for one request. Hitting it is not a failure: the next import carries on from there. */
const LICHESS_MAX = 20_000;

function monthsAgo(now: number, months: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());
}

/** Every 'YYYY-MM' touched by the time span, oldest first. */
function monthsBetween(from: number, to: number): string[] {
  const out: string[] = [];
  const d = new Date(Math.min(from, to));
  let y = d.getUTCFullYear();
  let m = d.getUTCMonth();
  const end = new Date(Math.max(from, to));
  const endKey = end.getUTCFullYear() * 12 + end.getUTCMonth();
  while (y * 12 + m <= endKey && out.length < 240) {
    out.push(monthOf(new Date(Date.UTC(y, m, 1))));
    if (++m > 11) {
      m = 0;
      y++;
    }
  }
  return out;
}

async function runLichessImport(username: string, months: number, signal: AbortSignal | undefined, emit: Emit): Promise<ImportResult> {
  const site = copy.importer.sites.lichess;
  const me = username.toLowerCase();
  const now = Date.now();
  const start = monthsAgo(now, months);
  const saved = await getSetting<LichessMarker>('importedLichess');
  // A stored span that ends before the window starts is no use for it: start over.
  // So is one with no games behind it (a reset, a cleared browser).
  let mark: LichessMarker | undefined =
    saved && saved.user === me && isNum(saved.from) && isNum(saved.to) && saved.from <= saved.to && saved.to > start && (await newestStored('lichess', me))
      ? { user: me, from: saved.from, to: saved.to }
      : undefined;
  const openings = await loadOpenings().catch(() => undefined);
  const saveMark = () => write(() => setSetting('importedLichess', mark));

  let added = 0;
  let requeued = 0;
  let received = 0;
  let aborted = false;
  let error: FetchError | undefined;
  const gaps: [number, number][] = [];

  /** One request; `covered` is told how far back the saved games now reach. */
  const pull = async (q: { since: number; until?: number }, covered?: (oldest: number) => Promise<void>): Promise<LichessFetchResult> => {
    const base = received;
    const r = await fetchLichessGames(
      username,
      {
        ...q,
        max: LICHESS_MAX,
        signal,
        onRetry: (info) => emit({ phase: 'downloading', done: received, added, label: waitLabel(site, info), waiting: true }),
      },
      async (rows, info) => {
        received = base + info.received;
        const fresh = await saveRows(rows, openings);
        added += fresh.length;
        requeued += await requeueLines(fresh);
        if (covered && info.oldest !== undefined) await covered(info.oldest);
        emit({ phase: 'downloading', done: received, added, label: copy.importer.received(received) });
      },
    );
    received = base + r.received;
    if (r.aborted) aborted = true;
    if (r.error) error = r.error;
    return r;
  };

  if (mark) {
    const known = mark;
    // 1. What you have played since the last import.
    const recent = await pull({ since: Math.max(start, known.to - LICHESS_OVERLAP) });
    if (recent.complete) {
      known.to = now;
      await saveMark();
    } else {
      gaps.push([known.to, recent.oldest ?? now]);
    }
    // 2. Older games, when the window reaches further back than what is stored.
    if (known.from > start + DAY) {
      if (!recent.complete) {
        gaps.push([start, known.from]);
      } else {
        const older = await pull({ since: start, until: known.from }, async (oldest) => {
          known.from = Math.min(known.from, oldest);
          await saveMark();
        });
        if (older.complete) known.from = start;
        else gaps.push([start, known.from]);
        await saveMark();
      }
    }
  } else {
    // First import (or the first in a long while): newest first, so the span grows backwards from now.
    const all = await pull({ since: start }, async (oldest) => {
      mark = { user: me, from: oldest, to: now };
      await saveMark();
    });
    if (all.complete) {
      mark = { user: me, from: start, to: now };
      await saveMark();
    } else {
      gaps.push([start, all.oldest ?? now]);
    }
  }

  const failed = [...new Set(gaps.flatMap(([a, b]) => monthsBetween(a, b)))].sort();
  if (failed.length && !aborted && received === 0 && error) {
    throw new ImportError('lichess', reasonOf(error), failed, error);
  }
  return {
    source: 'lichess',
    added,
    requeued,
    failed,
    partial: failed.length > 0 || aborted,
    aborted: aborted || undefined,
    reason: failed.length && !aborted && error ? reasonOf(error) : undefined,
  };
}

// ---- one entry point --------------------------------------------------------

interface Running {
  user: string;
  promise: Promise<ImportResult>;
  listeners: Set<(p: ImportProgress) => void>;
  cancel: () => void;
}
const running = new Map<GameSource, Running>();

function toImportError(source: GameSource, e: unknown): unknown {
  if (e instanceof ImportError) return e;
  if (e instanceof FetchError) {
    return new ImportError(source, e.kind === 'not-found' ? 'not-found' : e.kind === 'rate-limited' ? 'rate-limited' : 'unreachable', [], e);
  }
  if (isStorageError(e)) return new ImportError(source, 'storage', [], e);
  return e;
}

/** Imports new games from a site. See the header of this file for the contract. */
export function importFrom(
  source: GameSource,
  username: string,
  opts: { months?: number; signal?: AbortSignal; onProgress?: (p: ImportProgress) => void } = {},
): Promise<ImportResult> {
  const user = username.trim();
  if (!validUsername(source, user)) return Promise.reject(new ImportError(source, 'invalid'));

  const current = running.get(source);
  if (current) {
    if (current.user !== user.toLowerCase()) return Promise.reject(new ImportError(source, 'busy'));
    if (opts.onProgress) current.listeners.add(opts.onProgress);
    return current.promise;
  }

  const months = Math.max(1, Math.min(120, Math.floor(opts.months ?? 3) || 3));
  const listeners = new Set<(p: ImportProgress) => void>(opts.onProgress ? [opts.onProgress] : []);
  const emit: Emit = (p) => {
    const full: ImportProgress = { source, ...p };
    setStatus(source, full);
    for (const l of listeners) {
      try {
        l(full);
      } catch (e) {
        console.error(e);
      }
    }
  };

  // Said before any work starts, so a page that mounts mid-import sees it at once.
  emit({ phase: 'listing', done: 0, added: 0, label: copy.importer.listing(copy.importer.sites[source]) });
  // The import outlives the page that started it, so it carries its own switch (see cancelImport).
  const ctl = new AbortController();
  const forward = () => ctl.abort();
  if (opts.signal?.aborted) ctl.abort();
  else opts.signal?.addEventListener('abort', forward, { once: true });

  const promise = (async () => {
    try {
      return source === 'chesscom'
        ? await runChessComImport(user, months, ctl.signal, emit)
        : await runLichessImport(user, months, ctl.signal, emit);
    } catch (e) {
      throw toImportError(source, e);
    } finally {
      opts.signal?.removeEventListener('abort', forward);
      running.delete(source);
      setStatus(source, undefined);
    }
  })();
  running.set(source, { user: user.toLowerCase(), promise, listeners, cancel: forward });
  return promise;
}

/** Stops the running import from a site, if there is one. What it has saved stays; its promise resolves with `aborted`. */
export function cancelImport(source: GameSource): void {
  running.get(source)?.cancel();
}

/** The old entry point, kept for callers that have not moved to importFrom yet. */
export async function importChessCom(username: string, months = 3): Promise<{ added: number; requeued: number }> {
  const r = await importFrom('chesscom', username, { months });
  return { added: r.added, requeued: r.requeued };
}

// ---- upkeep -----------------------------------------------------------------

const UPKEEP_KEY = 'gamesChecked';
const UPKEEP_VERSION = 1;

/** Plies the user played, from the ply count alone (White moves first). */
const userPliesOf = (plyCount: number, color: 'white' | 'black') => (color === 'white' ? Math.ceil(plyCount / 2) : Math.floor(plyCount / 2));

/** An analysis from before short games were excluded: a game you barely moved in, scored 100%. */
const hollow = (g: GameRow) => !!g.analysis && userPliesOf(g.analysis.moves.length, g.userColor) < MIN_USER_PLIES;

/**
 * Names the opening of games stored without one. Returns how many were filled.
 *
 * Cheap to call on every visit: the table is only scanned when the number of
 * games has changed since the last pass, games that turn out to have no named
 * opening are marked so they are never parsed again, and all changes go in one
 * write. The same pass retires analyses of games too short to score.
 */
export async function ensureOpenings(): Promise<number> {
  const count = await db.games.count();
  const last = await getSetting<{ v: number; count: number }>(UPKEEP_KEY);
  if (last?.v === UPKEEP_VERSION && last.count === count) return 0;
  const openings = await loadOpenings().catch(() => undefined);
  if (!openings) return 0; // offline before the table was cached: try again next time

  const rows = await db.games.filter((g) => (!g.opening && !g.openingChecked) || hollow(g)).toArray();
  const changes: { key: string; changes: Partial<GameRow> }[] = [];
  const retired: string[] = [];
  let named = 0;
  for (let i = 0; i < rows.length; i++) {
    const g = rows[i];
    const patch: Partial<GameRow> = {};
    if (hollow(g)) {
      patch.analysis = undefined;
      patch.unanalysable = true;
      retired.push(g.id);
    }
    if (!g.opening && !g.openingChecked) {
      let hit: ReturnType<typeof nameOpening> = null;
      try {
        hit = nameOpening(parseGamePgn(g.pgn), openings);
      } catch {
        /* unparseable PGN: nothing to name */
      }
      if (hit) {
        patch.opening = { eco: hit.eco, name: hit.name };
        named++;
      } else {
        patch.openingChecked = true;
      }
    }
    changes.push({ key: g.id, changes: patch });
    if (i % CHUNK === CHUNK - 1) await breathe();
  }
  await write(async () => {
    if (changes.length) await db.games.bulkUpdate(changes);
    for (const id of retired) await syncGamePuzzles(id, []);
    await setSetting(UPKEEP_KEY, { v: UPKEEP_VERSION, count });
  });
  return named;
}

// ---- analysis ---------------------------------------------------------------

/** Is this game waiting for Stockfish? Not analysed yet, or analysed by an older version, and analysable at all. */
export function needsAnalysis(g: GameRow): boolean {
  if (g.unreadable || g.unanalysable) return false;
  return !g.analysis || (g.analysis.version ?? 1) < ANALYSIS_VERSION;
}

export interface AnalyzeOutcome {
  /** 'missing': no such game. 'unreadable': the PGN cannot be replayed. 'unanalysable': fewer than two moves of yours. */
  status: 'analysed' | 'unreadable' | 'unanalysable' | 'missing';
  /** Puzzles created for mistakes that had none. */
  added: number;
  /** Existing puzzles whose position, solution or theme changed; their schedule is kept. */
  updated: number;
  /** Puzzles deleted because their move is no longer a mistake. */
  removed: number;
  /** Your mistakes and blunders in the game; each one has a puzzle now. */
  mistakes: number;
}

/**
 * Analyses a stored game and brings its puzzles in line with the result.
 * Rejects with an AbortError when `opts.signal` fires, a StorageError when the
 * result cannot be saved, and whatever the engine throws when it dies.
 */
export async function analyzeStoredGameFull(id: string, onProgress?: (p: number) => void, opts: AnalyzeOptions = {}): Promise<AnalyzeOutcome> {
  const skip = (s: AnalyzeOutcome['status'], removed = 0): AnalyzeOutcome => ({ status: s, added: 0, updated: 0, removed, mistakes: 0 });
  const g = await db.games.get(id);
  if (!g) return skip('missing');
  let plies: GamePly[];
  try {
    plies = parseGamePgn(g.pgn);
  } catch {
    await write(() => db.games.update(id, { unreadable: true }));
    return skip('unreadable');
  }
  if (userPlyCount(plies, g.userColor) < MIN_USER_PLIES) {
    // Nothing to review, and "100% accuracy" for a game you never played would skew every average.
    const removed = await write(() =>
      db.transaction('rw', db.games, db.puzzles, async () => {
        await db.games.update(id, { unanalysable: true, analysis: undefined });
        return (await syncGamePuzzles(id, [])).removed;
      }),
    );
    return skip('unanalysable', removed);
  }

  const openings = await loadOpenings().catch(() => undefined); // names are a nice-to-have
  const clocks = plyClocks(g.pgn, plies.length);
  const tc = parseTimeControl(g.pgn);
  const analysis = await analyzeGame(plies, g.userColor, onProgress, openings, clocks && tc ? { tc, plies: clocks } : null, opts);

  const wanted: Omit<PuzzleRow, 'card' | 'addedAt'>[] = [];
  for (let i = 0; i < plies.length; i++) {
    const r = analysis.moves[i];
    if (!r.kind || !r.best) continue;
    wanted.push({ id: `mine:${id}:${i}`, source: 'mine', fen: plies[i].fenBefore, moves: [r.best], theme: r.kind, gameId: id, ply: i });
  }
  // One transaction: the analysis and its puzzles are saved together or not at all.
  const sync = await write(() =>
    db.transaction('rw', db.games, db.puzzles, async () => {
      // The game can be gone by now (a reset or a restore while the engine ran).
      if (!(await db.games.where('id').equals(id).count())) return { added: 0, updated: 0, removed: 0 };
      await db.games.update(id, { analysis });
      return syncGamePuzzles(id, wanted);
    }),
  );
  return { status: 'analysed', ...sync, mistakes: wanted.length };
}

/** Analyses a stored game and turns your mistakes and blunders into puzzles. Returns how many puzzles are new. */
export async function analyzeStoredGame(id: string, onProgress?: (p: number) => void, opts: AnalyzeOptions = {}): Promise<number> {
  return (await analyzeStoredGameFull(id, onProgress, opts)).added;
}
