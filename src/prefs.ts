import { useSyncExternalStore } from 'react';

export type BoardTheme = 'slate' | 'walnut' | 'forest' | 'ocean' | 'rose';
export type PieceSet = 'california' | 'staunty' | 'maestro' | 'cardinal' | 'chessnut' | 'cburnett' | 'merida' | 'pirouetti' | 'kiwen-suwi' | 'firi';
export interface Prefs {
  boardTheme: BoardTheme;
  pieces: PieceSet;
  sound: boolean;
  animation: 'off' | 'normal' | 'slow';
  coach: boolean;
  /** a-h / 1-8 on the edge squares */
  coordinates: boolean;
  /** dots on the squares the picked-up piece can go to */
  showDests: boolean;
  highlightLast: boolean;
  /** promote straight to a queen, no picker */
  autoQueen: boolean;
  /** move list with piece icons instead of letters */
  figurines: boolean;
  /** 0.6 - 1, set by the board's corner grip */
  boardScale: number;
}

export const BOARD_THEMES: { id: BoardTheme; label: string; light: string; dark: string }[] = [
  { id: 'forest', label: 'Green', light: '#ebecd0', dark: '#739552' },
  { id: 'walnut', label: 'Brown', light: '#f0d9b5', dark: '#b58863' },
  { id: 'slate', label: 'Stone', light: '#ebe6db', dark: '#a0978a' },
  { id: 'ocean', label: 'Ocean', light: '#dee3e6', dark: '#8ca2ad' },
  { id: 'rose', label: 'Rosewood', light: '#f3e5e0', dark: '#b07a74' },
];

export const PIECE_SETS: { id: PieceSet; label: string }[] = [
  { id: 'california', label: 'California' },
  { id: 'staunty', label: 'Staunty' },
  { id: 'maestro', label: 'Maestro' },
  { id: 'cardinal', label: 'Cardinal' },
  { id: 'chessnut', label: 'Chessnut' },
  { id: 'cburnett', label: 'Classic' },
  { id: 'merida', label: 'Merida' },
  { id: 'pirouetti', label: 'Pirouetti' },
  { id: 'kiwen-suwi', label: 'Kiwen-Suwi' },
  { id: 'firi', label: 'Firi' },
];

const KEY = 'prefs';
const DEFAULTS: Prefs = {
  boardTheme: 'forest',
  pieces: 'staunty',
  sound: true,
  animation: 'normal',
  coach: true,
  coordinates: true,
  showDests: true,
  highlightLast: true,
  autoQueen: false,
  figurines: true,
  boardScale: 1,
};

// v2 moved everyone to the new board (Green) and pieces (Staunty) once;
// anything picked after that sticks.
const VERSION = 2;
let current: Prefs = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const prefs = { ...DEFAULTS, ...saved };
    if (saved.v !== VERSION) {
      prefs.boardTheme = DEFAULTS.boardTheme;
      prefs.pieces = DEFAULTS.pieces;
      localStorage.setItem(KEY, JSON.stringify({ ...prefs, v: VERSION }));
    }
    return prefs;
  } catch {
    return DEFAULTS;
  }
})();
const listeners = new Set<() => void>();

export const getPrefs = () => current;

export function setPrefs(patch: Partial<Prefs>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...current, v: VERSION }));
  } catch {
    /* private mode */
  }
  applyPrefsToDocument();
  listeners.forEach((l) => l());
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getPrefs,
  );
}

export const applyPrefsToDocument = () => {
  const root = document.documentElement;
  root.dataset.board = current.boardTheme;
  root.dataset.pieces = current.pieces;
  root.style.setProperty('--board-scale', String(current.boardScale));
};
