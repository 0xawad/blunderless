// One background analysis queue for the whole app. It lives outside React,
// so leaving the Games page doesn't stop a batch, and every page can show
// its progress.
//
// Reading QueueState:
//  - `done` counts games that were analysed and saved. A game that failed
//    (`errors`) or had nothing to analyse (`skipped`) leaves `total`, so
//    (done + progress) / total stays an honest progress figure.
//  - `failed` means the batch was cut short. `failure` says by what: 'engine'
//    (Stockfish died or never started) or 'storage' (the browser refused to
//    save, e.g. out of space). Either would hit every later game too.
//  - `stopped` means Stop ended it. The game in progress is abandoned at once
//    and counts as neither done nor failed.
//  - `puzzles` counts new puzzles; `mistakes` counts every mistake found, so a
//    re-analysis that only refreshed existing puzzles is not read as a clean game.
import { useSyncExternalStore } from 'react';
import { EngineError } from '../engine/engine';
import { analyzeStoredGameFull, isStorageError } from './store';

export interface QueueState {
  running: boolean;
  /** ids still waiting, current one first */
  pending: string[];
  current?: string;
  /** 0..1 progress through the current game */
  progress: number;
  /** Games analysed and saved in this batch. */
  done: number;
  /** Games in this batch that are done, in progress or waiting (failed and skipped ones are taken out). */
  total: number;
  /** New puzzles made in this batch. */
  puzzles: number;
  /** The batch was cut short by an error that would hit every later game too. */
  failed: boolean;
  /** Why, when `failed` is true. */
  failure?: 'engine' | 'storage';
  /** Games that could not be analysed or saved. The batch carried on unless `failed`. */
  errors: number;
  /** Message of the most recent error, for a details line or a bug report. */
  lastError?: string;
  /** Games with nothing to analyse: an unreadable PGN, or fewer than two moves of yours. */
  skipped: number;
  /** Your mistakes found in this batch, whether their puzzle is new or was already there. */
  mistakes: number;
  /** Stop ended the batch. */
  stopped: boolean;
}

const idle = {
  progress: 0,
  done: 0,
  total: 0,
  puzzles: 0,
  failed: false,
  failure: undefined,
  errors: 0,
  lastError: undefined,
  skipped: 0,
  mistakes: 0,
  stopped: false,
} satisfies Partial<QueueState>;

let state: QueueState = { running: false, pending: [], ...idle };
const listeners = new Set<() => void>();
let stopRequested = false;
let currentJob: AbortController | null = null;
let onFinish: ((s: QueueState) => void) | null = null;

function set(patch: Partial<QueueState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

export const getQueue = () => state;

export function useQueue(): QueueState {
  return useSyncExternalStore(subscribe, getQueue, getQueue);
}

/** Called once when a batch finishes (or is stopped). Last caller wins. */
export function onQueueFinish(fn: ((s: QueueState) => void) | null) {
  onFinish = fn;
}

export function enqueue(ids: string[]) {
  stopRequested = false; // a new request after Stop means "go on"
  const fresh = [...new Set(ids)].filter((id) => id !== state.current && !state.pending.includes(id));
  if (!fresh.length) return;
  if (!state.running) {
    set({ ...idle, pending: fresh, total: fresh.length });
    void run();
  } else {
    set({ pending: [...state.pending, ...fresh], total: state.total + fresh.length, stopped: false });
  }
}

/** Ends the batch now: the game being analysed is abandoned, not finished first. */
export function stopQueue() {
  if (!state.running) return;
  stopRequested = true;
  set({ pending: [], total: state.done, progress: 0, stopped: true });
  currentJob?.abort();
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message || e.name : String(e));
const isEngineError = (e: unknown) => e instanceof EngineError || /engine/i.test(messageOf(e));

async function run() {
  stopRequested = false;
  set({ running: true });
  while (state.pending.length && !stopRequested) {
    const [id, ...rest] = state.pending;
    const job = new AbortController();
    currentJob = job;
    set({ current: id, pending: rest, progress: 0 });
    try {
      const r = await analyzeStoredGameFull(id, (p) => !job.signal.aborted && set({ progress: p }), { signal: job.signal });
      if (r.status === 'analysed') set({ done: state.done + 1, puzzles: state.puzzles + r.added, mistakes: state.mistakes + r.mistakes });
      else set({ skipped: state.skipped + 1, total: Math.max(state.done, state.total - 1) });
    } catch (e) {
      // Stop was pressed: this game is neither done nor failed. The loop ends unless something new was queued since.
      if (job.signal.aborted) continue;
      const lastError = messageOf(e);
      const errors = state.errors + 1;
      // A dead engine or a full disk fails every game after this one too; anything else is about this one game.
      const failure = isStorageError(e) ? 'storage' : isEngineError(e) ? 'engine' : undefined;
      if (failure) {
        set({ failed: true, failure, errors, lastError, pending: [], total: state.done });
        break;
      }
      set({ errors, lastError, total: Math.max(state.done, state.total - 1) });
    }
  }
  currentJob = null;
  // Whatever is still waiting after a stop would otherwise look queued forever.
  set({ running: false, current: undefined, progress: 0, pending: [] });
  onFinish?.(state);
}
