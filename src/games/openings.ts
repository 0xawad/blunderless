import { fenKey } from '../chess/game';

export type OpeningBook = Map<string, { eco: string; name: string }>;

let cached: Promise<OpeningBook> | null = null;

/** Loads public/openings.json ({ fen4: "eco|name" }) once. */
export function loadOpenings(): Promise<OpeningBook> {
  cached ??= fetch('/openings.json')
    .then((r) => r.json() as Promise<Record<string, string>>)
    .then((raw) => {
      const book: OpeningBook = new Map();
      for (const [k, v] of Object.entries(raw)) {
        const i = v.indexOf('|');
        book.set(k, { eco: v.slice(0, i), name: v.slice(i + 1) });
      }
      return book;
    })
    .catch((e) => {
      cached = null;
      throw e;
    });
  return cached;
}

/** Deepest opening the game passed through; ply is 1-based. */
export function nameOpening(
  plies: { fenAfter: string }[],
  book: OpeningBook,
): { eco: string; name: string; ply: number } | null {
  for (let i = plies.length - 1; i >= 0; i--) {
    const hit = book.get(fenKey(plies[i].fenAfter));
    if (hit) return { ...hit, ply: i + 1 };
  }
  return null;
}

export { fenKey as fen4 };
