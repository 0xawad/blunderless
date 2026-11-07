import { useSyncExternalStore } from 'react';

export type BoardTheme = 'slate' | 'walnut' | 'forest' | 'ocean' | 'rose';
export type PieceSet = 'chessnut' | 'cburnett' | 'merida' | 'pirouetti' | 'kiwen-suwi' | 'firi';
export interface Prefs {
  boardTheme: BoardTheme;
  pieces: PieceSet;
  sound: boolean;
  animation: 'off' | 'normal' | 'slow';
  coach: boolean;
}

export const BOARD_THEMES: { id: BoardTheme; label: string; light: string; dark: string }[] = [
  { id: 'slate', label: 'Slate', light: '#eceff4', dark: '#8f9bb8' },
  { id: 'walnut', label: 'Walnut', light: '#f0d9b5', dark: '#b58863' },
  { id: 'forest', label: 'Forest', light: '#eeeed2', dark: '#769656' },
  { id: 'ocean', label: 'Ocean', light: '#dee3e6', dark: '#8ca2ad' },
  { id: 'rose', label: 'Rosewood', light: '#f3e5e0', dark: '#b07a74' },
];

export const PIECE_SETS: { id: PieceSet; label: string }[] = [
  { id: 'chessnut', label: 'Chessnut' },
  { id: 'cburnett', label: 'Classic' },
  { id: 'merida', label: 'Merida' },
  { id: 'pirouetti', label: 'Pirouetti' },
  { id: 'kiwen-suwi', label: 'Kiwen-Suwi' },
  { id: 'firi', label: 'Firi' },
];

const KEY = 'prefs';
const DEFAULTS: Prefs = { boardTheme: 'slate', pieces: 'chessnut', sound: true, animation: 'normal', coach: true };

let current: Prefs = (() => {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
  }
})();
const listeners = new Set<() => void>();

export const getPrefs = () => current;

export function setPrefs(patch: Partial<Prefs>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* private mode */
  }
  document.documentElement.dataset.board = current.boardTheme;
  document.documentElement.dataset.pieces = current.pieces;
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
  document.documentElement.dataset.board = current.boardTheme;
  document.documentElement.dataset.pieces = current.pieces;
};
