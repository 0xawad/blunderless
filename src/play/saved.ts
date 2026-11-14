// The game you're in the middle of against Stockfish, so leaving the page
// (or closing the tab) doesn't lose it. Only one at a time.
import { useSyncExternalStore } from 'react';
import { Chess } from 'chess.js';
import { playUci } from '../chess/game';

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

/**
 * Checks a stored game before it is offered for resuming. Every move must replay
 * from the starting position; one that does not means the save is damaged or from
 * a build with different rules, and resuming it would drop you into a position you
 * never had. Such a save is refused outright. The move log is rebuilt when it does
 * not line up with the moves, so the list on screen always matches the board.
 */
export function validSave(v: unknown): SavedGame | null {
  if (!v || typeof v !== 'object') return null;
  const g = v as Partial<SavedGame>;
  if (g.v !== 1 || !Array.isArray(g.moves) || g.moves.length === 0 || g.moves.length > 1000) return null;
  if (g.color !== 'white' && g.color !== 'black') return null;
  const s = g.setup;
  if (!s || typeof s.level !== 'number' || typeof s.time !== 'number') return null;
  let chess: Chess;
  try {
    chess = g.startFen ? new Chess(g.startFen) : new Chess();
  } catch {
    return null;
  }
  const replayed: SavedGame['log'] = [];
  for (const u of g.moves) {
    const m = typeof u === 'string' ? playUci(chess, u) : null;
    if (!m) return null;
    replayed.push({ san: m.san, color: m.color });
  }
  const log = Array.isArray(g.log) && g.log.length === replayed.length && g.log.every((l, i) => l && l.san === replayed[i].san && l.color === replayed[i].color) ? g.log : replayed;
  const ms = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0);
  return {
    v: 1,
    setup: { level: s.level, time: s.time, guard: s.guard !== false, cct: s.cct === true },
    color: g.color,
    startFen: g.startFen,
    moves: g.moves,
    clocks: { w: ms(g.clocks?.w), b: ms(g.clocks?.b) },
    log,
    saves: ms(g.saves),
    hints: ms(g.hints),
    savedAt: ms(g.savedAt),
  };
}

const KEY = 'play-game';
const listeners = new Set<() => void>();
let cached: SavedGame | null | undefined;

function read(): SavedGame | null {
  if (cached !== undefined) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    cached = raw ? validSave(JSON.parse(raw)) : null;
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
