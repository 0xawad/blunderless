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
// public/theme-init.js repeats the board, piece-set and scale rules to apply
// them before first paint: change them together (src/prefs.test.ts checks).
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
const ANIMATIONS: readonly Prefs['animation'][] = ['off', 'normal', 'slow'];
const SWITCHES = ['sound', 'coach', 'coordinates', 'showDests', 'highlightLast', 'autoQueen', 'figurines'] as const;
export const MIN_BOARD_SCALE = 0.6;

// Two counters are stored with the prefs.
// `v`: 2 moved everyone to the new board (Green) and pieces (Staunty) once;
//   anything picked after that sticks. Builds from before the redesign reset
//   the board and pieces whenever `v` is not exactly 2, so it has to stay 2.
// `rev`: later one-off changes. 1 = only what you chose is stored. Earlier
//   builds wrote every default back, so a stored value equal to the default
//   was not necessarily a choice and now follows the default again. That is
//   what lets piece animation default to off under prefers-reduced-motion.
const VERSION = 2;
const REVISION = 1;

/** What a setting is when you have not chosen: piece animation is off for people who asked their OS for less motion. */
export function defaultPrefs(reducedMotion: boolean): Prefs {
  return reducedMotion ? { ...DEFAULTS, animation: 'off' } : DEFAULTS;
}

/** Keeps the known keys that hold usable values, so a hand-edited or damaged entry cannot break the board. */
function clean(blob: Record<string, unknown>): Partial<Prefs> {
  const out: Partial<Prefs> = {};
  const board = BOARD_THEMES.find((b) => b.id === blob.boardTheme);
  if (board) out.boardTheme = board.id;
  const pieces = PIECE_SETS.find((p) => p.id === blob.pieces);
  if (pieces) out.pieces = pieces.id;
  const animation = ANIMATIONS.find((a) => a === blob.animation);
  if (animation) out.animation = animation;
  for (const k of SWITCHES) {
    const value = blob[k];
    if (typeof value === 'boolean') out[k] = value;
  }
  const scale = blob.boardScale;
  if (typeof scale === 'number' && Number.isFinite(scale)) out.boardScale = Math.min(1, Math.max(MIN_BOARD_SCALE, scale));
  return out;
}

/**
 * Reads the stored prefs entry into the settings the user chose.
 * `stale` means it was written by an older build (or never) and should be saved again.
 */
export function parseSavedPrefs(raw: string | null): { saved: Partial<Prefs>; stale: boolean } {
  let blob: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) blob = parsed as Record<string, unknown>;
  } catch {
    /* unreadable: start from the defaults */
  }
  const saved = clean(blob);
  let stale = false;
  if (blob.v !== VERSION) {
    delete saved.boardTheme;
    delete saved.pieces;
    stale = true;
  }
  if (!(typeof blob.rev === 'number' && blob.rev >= REVISION)) {
    for (const k of Object.keys(saved) as (keyof Prefs)[]) if (saved[k] === DEFAULTS[k]) delete saved[k];
    stale = true;
  }
  return { saved, stale };
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function readSaved() {
  try {
    return parseSavedPrefs(localStorage.getItem(KEY));
  } catch {
    return { saved: {}, stale: false };
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...saved, v: VERSION, rev: REVISION }));
  } catch {
    /* private mode */
  }
}

const initial = readSaved();
/** Only the settings the user has chosen; everything else follows the defaults. */
let saved: Partial<Prefs> = initial.saved;
let current: Prefs = { ...defaultPrefs(reducedMotion()), ...saved };
if (initial.stale) persist();

const listeners = new Set<() => void>();

export const getPrefs = () => current;

export function setPrefs(patch: Partial<Prefs>) {
  const keys = Object.keys(patch) as (keyof Prefs)[];
  if (keys.every((k) => patch[k] === current[k] && k in saved)) return;
  saved = { ...saved, ...patch };
  current = { ...current, ...patch };
  persist();
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
    getPrefs, // also the snapshot when rendering outside a browser (tests)
  );
}

export const applyPrefsToDocument = () => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.board = current.boardTheme;
  root.dataset.pieces = current.pieces;
  root.style.setProperty('--board-scale', String(current.boardScale));
};

// Another tab changed a setting: take it on, so this tab's next save does not undo it.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY && e.key !== null) return;
    saved = readSaved().saved;
    current = { ...defaultPrefs(reducedMotion()), ...saved };
    applyPrefsToDocument();
    listeners.forEach((l) => l());
  });
}
