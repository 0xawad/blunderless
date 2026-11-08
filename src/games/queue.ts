// One background analysis queue for the whole app. It lives outside React,
// so leaving the Games page doesn't stop a batch, and every page can show
// its progress.
import { useSyncExternalStore } from 'react';
import { analyzeStoredGame } from './store';

export interface QueueState {
  running: boolean;
  /** ids still waiting, current one first */
  pending: string[];
  current?: string;
  /** 0..1 progress through the current game */
  progress: number;
  done: number;
  total: number;
  puzzles: number;
  failed: boolean;
}

let state: QueueState = { running: false, pending: [], progress: 0, done: 0, total: 0, puzzles: 0, failed: false };
const listeners = new Set<() => void>();
let stopRequested = false;
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
  const fresh = ids.filter((id) => id !== state.current && !state.pending.includes(id));
  if (!fresh.length) return;
  if (!state.running) {
    set({ pending: fresh, total: fresh.length, done: 0, puzzles: 0, failed: false, progress: 0 });
    void run();
  } else {
    set({ pending: [...state.pending, ...fresh], total: state.total + fresh.length });
  }
}

export function stopQueue() {
  stopRequested = true;
  set({ pending: [], total: state.done + (state.current ? 1 : 0) });
}

async function run() {
  stopRequested = false;
  set({ running: true });
  while (state.pending.length && !stopRequested) {
    const [id, ...rest] = state.pending;
    set({ current: id, pending: rest, progress: 0 });
    try {
      const made = await analyzeStoredGame(id, (p) => set({ progress: p }));
      set({ done: state.done + 1, puzzles: state.puzzles + made });
    } catch (e) {
      // A dead or hung engine fails every game after it too; anything else is about this one game.
      if (/engine/i.test((e as Error)?.message ?? '')) {
        set({ failed: true, pending: [] });
        break;
      }
      set({ done: state.done + 1 });
    }
  }
  // Whatever is still waiting after a stop would otherwise look queued forever.
  set({ running: false, current: undefined, progress: 0, pending: [] });
  onFinish?.(state);
}
