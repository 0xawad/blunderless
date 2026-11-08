// The game you're in the middle of against Stockfish, so leaving the page
// (or closing the tab) doesn't lose it. Only one at a time.
import { useSyncExternalStore } from 'react';

export interface SavedGame {
  v: 1;
  setup: { level: number; time: number; guard: boolean; cct: boolean };
  color: 'white' | 'black';
  startFen?: string;
  /** UCI moves played so far */
  moves: string[];
  /** ms left per side at the moment of saving */
  clocks: { w: number; b: number };
  log: { san: string; color: 'w' | 'b'; verdict?: string; better?: string }[];
  saves: number;
  hints: number;
  savedAt: number;
}

const KEY = 'play-game';
const listeners = new Set<() => void>();
let cached: SavedGame | null | undefined;

function read(): SavedGame | null {
  if (cached !== undefined) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as SavedGame) : null;
    cached = v && v.v === 1 && Array.isArray(v.moves) && v.moves.length > 0 ? v : null;
  } catch {
    cached = null;
  }
  return cached;
}

function write(v: SavedGame | null) {
  cached = v;
  try {
    if (v) localStorage.setItem(KEY, JSON.stringify(v));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
  listeners.forEach((l) => l());
}

export const getSavedGame = read;
export const saveGame = (g: SavedGame) => write(g);
export const clearSavedGame = () => write(null);

export function useSavedGame(): SavedGame | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    read,
    () => null,
  );
}
