import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Chess } from 'chess.js';
import { parseGamePgn } from '../chess/game';
import type { SearchOptions, SearchResult } from '../engine/engine';
import { db, getSetting, setSetting } from '../srs/db';
import type { GameAnalysis, GameRow } from '../srs/types';
import { ANALYSIS_DEPTH, ANALYSIS_VERSION, EvalCache, UnanalysableError, analyzeGame, evalCache, userPlyCount } from './analyze';
import { StorageError, analyzeStoredGame, analyzeStoredGameFull, ensureOpenings, isStorageError, needsAnalysis } from './store';

// ---- a scripted engine --------------------------------------------------------

/** Per-position overrides, keyed by the position's FEN: the score is from the side to move. */
const script = { cp: new Map<string, number>(), best: new Map<string, string>() };
const searched: string[] = [];
let hold: Promise<void> | null = null;

const abortErr = () => Object.assign(new Error('search aborted'), { name: 'AbortError' });

async function fakeSearch(fen: string, opts: SearchOptions = {}): Promise<SearchResult> {
  if (opts.signal?.aborted) throw abortErr();
  searched.push(fen);
  if (hold) {
    await new Promise<void>((resolve, reject) => {
      opts.signal?.addEventListener('abort', () => reject(abortErr()), { once: true });
      void hold!.then(resolve);
    });
  }
  const first = new Chess(fen).moves({ verbose: true })[0];
  const best = script.best.get(fen) ?? first.from + first.to + (first.promotion ?? '');
  return { bestmove: best, score: { cp: script.cp.get(fen) ?? 20 }, pv: [best], depth: opts.depth ?? 12 };
}

vi.mock('../engine/engine', async (original) => ({
  ...(await original<typeof import('../engine/engine')>()),
  getEngine: () => ({ search: fakeSearch }),
}));

const BOOK = { 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -': "B00|King's Pawn" };

// ---- games ----------------------------------------------------------------------

function pgnOf(sans: string[]): string {
  const c = new Chess();
  for (const s of sans) c.move(s);
  return c.pgn();
}

function game(id: string, sans: string[], patch: Partial<GameRow> = {}): GameRow {
  return {
    id, source: 'chesscom', pgn: pgnOf(sans), white: 'Hero', black: 'opp', userColor: 'white', result: 'loss',
    timeClass: 'blitz', endTime: new Date('2026-11-01T10:00:00Z'), ...patch,
  };
}

// 3.Ng5 leaves the knight to the queen: the position before it is ply index 4.
const HANG = ['e4', 'e5', 'Nf3', 'Nc6', 'Ng5', 'Qxg5'];
const plies = parseGamePgn(pgnOf(HANG));
const beforeNg5 = plies[4].fenBefore;
const afterNg5 = plies[4].fenAfter;

/** Makes the engine see 3.Ng5 as a blunder with `best` as the move that was better. */
function blunderAt(best: string) {
  script.cp.set(beforeNg5, 30);
  script.best.set(beforeNg5, best);
  script.cp.set(afterNg5, 350); // Black to move and a knight up
  script.best.set(afterNg5, 'd8g5');
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  script.cp.clear();
  script.best.clear();
  searched.length = 0;
  hold = null;
  evalCache.clear();
  // openings.json is loaded once per module and cached, so every test gets the same tiny table.
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(BOOK))));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('analyzeStoredGame', () => {
  it('turns your mistakes into puzzles and saves the analysis', async () => {
    await db.games.add(game('g1', HANG));
    blunderAt('f1c4');
    const made = await analyzeStoredGame('g1');
    expect(made).toBe(1);
    const g = await db.games.get('g1');
    expect(g?.analysis).toMatchObject({ version: ANALYSIS_VERSION, depth: ANALYSIS_DEPTH, blunders: 1 });
    expect(g?.analysis?.moves[4]).toMatchObject({ cls: 'blunder', best: 'f1c4', kind: 'hung-piece' });
    expect(needsAnalysis(g!)).toBe(false);
    expect(await db.puzzles.toArray()).toMatchObject([
      { id: 'mine:g1:4', source: 'mine', fen: beforeNg5, moves: ['f1c4'], theme: 'hung-piece', gameId: 'g1', ply: 4 },
    ]);
  });

  it('on re-analysis updates the puzzle in place and keeps its schedule', async () => {
    await db.games.add(game('g1', HANG));
    blunderAt('f1c4');
    await analyzeStoredGameFull('g1', undefined, { cache: null });
    // The puzzle has been practised since: its card is no longer new.
    const first = (await db.puzzles.get('mine:g1:4'))!;
    const due = new Date('2027-03-01T00:00:00Z');
    await db.puzzles.put({ ...first, card: { ...first.card, reps: 3, stability: 12.5, due } });

    // A newer analysis prefers another move and reads the mistake differently.
    blunderAt('d2d4');
    script.best.set(afterNg5, 'h7h6'); // no longer "the queen takes it"
    const r = await analyzeStoredGameFull('g1', undefined, { cache: null });
    expect(r).toEqual({ status: 'analysed', added: 0, updated: 1, removed: 0, mistakes: 1 });
    const again = (await db.puzzles.get('mine:g1:4'))!;
    expect(again.moves).toEqual(['d2d4']);
    expect(again.theme).not.toBe('hung-piece');
    expect(again.card).toMatchObject({ reps: 3, stability: 12.5 });
    expect(again.card.due).toEqual(due);
    expect(again.addedAt).toEqual(first.addedAt);
    expect(await db.puzzles.count()).toBe(1);
  });

  it('deletes the puzzle of a move that is no longer a mistake, and only that game\'s', async () => {
    await db.games.bulkAdd([game('g1', HANG), game('g1:9', HANG)]);
    blunderAt('f1c4');
    await analyzeStoredGameFull('g1', undefined, { cache: null });
    await analyzeStoredGameFull('g1:9', undefined, { cache: null });
    expect((await db.puzzles.toArray()).map((p) => p.id).sort()).toEqual(['mine:g1:4', 'mine:g1:9:4']);

    script.cp.clear();
    script.best.clear();
    const r = await analyzeStoredGameFull('g1', undefined, { cache: null });
    expect(r).toEqual({ status: 'analysed', added: 0, updated: 0, removed: 1, mistakes: 0 });
    // "mine:g1:" is also a prefix of the other game's puzzle; it must survive.
    expect((await db.puzzles.toArray()).map((p) => p.id)).toEqual(['mine:g1:9:4']);
  });

  it('leaves an unchanged puzzle untouched', async () => {
    await db.games.add(game('g1', HANG));
    blunderAt('f1c4');
    await analyzeStoredGameFull('g1', undefined, { cache: null });
    const r = await analyzeStoredGameFull('g1', undefined, { cache: null });
    expect(r).toEqual({ status: 'analysed', added: 0, updated: 0, removed: 0, mistakes: 1 });
  });

  it('marks a game with fewer than two moves of yours unanalysable instead of scoring it', async () => {
    await db.games.bulkAdd([
      game('none', []),
      game('one', ['e4', 'e5']), // one ply as White
      game('black-one', ['e4', 'e5', 'Nf3'], { userColor: 'black' }),
      game('two', ['e4', 'e5', 'Nf3']),
    ]);
    for (const id of ['none', 'one', 'black-one']) {
      expect(await analyzeStoredGameFull(id)).toMatchObject({ status: 'unanalysable', added: 0, mistakes: 0 });
      const g = (await db.games.get(id))!;
      expect(g.unanalysable).toBe(true);
      expect(g.analysis).toBeUndefined();
      expect(needsAnalysis(g)).toBe(false);
    }
    expect(searched).toHaveLength(0); // the engine was never bothered
    expect(await analyzeStoredGameFull('two')).toMatchObject({ status: 'analysed' });
    expect((await db.games.get('two'))?.analysis?.accuracy).toBeGreaterThan(0);
  });

  it('flags an unreadable PGN and reports a missing game', async () => {
    await db.games.add(game('bad', [], { pgn: '1. e4 e5 2. Ke3 1-0' }));
    expect(await analyzeStoredGameFull('bad')).toMatchObject({ status: 'unreadable' });
    expect((await db.games.get('bad'))?.unreadable).toBe(true);
    expect(await analyzeStoredGameFull('nope')).toMatchObject({ status: 'missing' });
    expect(await analyzeStoredGame('nope')).toBe(0);
  });

  it('stops at once when aborted and saves nothing', async () => {
    await db.games.add(game('g1', HANG));
    let release!: () => void;
    hold = new Promise<void>((r) => (release = r));
    const ctl = new AbortController();
    const progress: number[] = [];
    const p = analyzeStoredGameFull('g1', (x) => progress.push(x), { signal: ctl.signal, cache: null }).catch((e: unknown) => e);
    await vi.waitFor(() => expect(searched).toHaveLength(1));
    ctl.abort();
    const e = (await p) as Error;
    expect(e.name).toBe('AbortError');
    release();
    expect(searched).toHaveLength(1); // not one more position after the abort
    expect(progress).toEqual([]);
    expect((await db.games.get('g1'))?.analysis).toBeUndefined();
    expect(await db.puzzles.count()).toBe(0);
  });

  it('does not write puzzles for a game deleted while the engine ran', async () => {
    await db.games.add(game('g1', HANG));
    blunderAt('f1c4');
    let release!: () => void;
    hold = new Promise<void>((r) => (release = r));
    const p = analyzeStoredGameFull('g1', undefined, { cache: null });
    await vi.waitFor(() => expect(searched).toHaveLength(1));
    await db.games.delete('g1');
    release();
    expect(await p).toMatchObject({ status: 'analysed', added: 0 });
    expect(await db.puzzles.count()).toBe(0);
  });

  it('wraps a failed save so the queue can tell it from an engine failure', async () => {
    await db.games.add(game('g1', HANG));
    const boom = Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
    const spy = vi.spyOn(db.games, 'update').mockRejectedValue(boom);
    const e = await analyzeStoredGameFull('g1', undefined, { cache: null }).catch((x: unknown) => x);
    spy.mockRestore();
    expect(e).toBeInstanceOf(StorageError);
    expect(isStorageError(e)).toBe(true);
    expect(isStorageError(boom)).toBe(true);
    expect(isStorageError(new Error('engine is dead'))).toBe(false);
    expect(await db.puzzles.count()).toBe(0); // the transaction took the puzzles down with it
  });
});

describe('analyzeGame', () => {
  it('refuses a game with nothing of yours in it', async () => {
    await expect(analyzeGame(parseGamePgn(pgnOf(['e4', 'e5'])), 'white')).rejects.toBeInstanceOf(UnanalysableError);
    await expect(analyzeGame([], 'black')).rejects.toBeInstanceOf(UnanalysableError);
    expect(userPlyCount(plies, 'white')).toBe(3);
    expect(userPlyCount(plies, 'black')).toBe(3);
  });

  it('searches a position shared by two games only once', async () => {
    const a = parseGamePgn(pgnOf(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']));
    const b = parseGamePgn(pgnOf(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']));
    await analyzeGame(a, 'white');
    expect(searched).toHaveLength(6);
    await analyzeGame(b, 'white');
    // Five positions in common (the start and four moves); only the last one is new.
    expect(searched).toHaveLength(7);
    // An interrupted game costs nothing the second time.
    await analyzeGame(a, 'white');
    expect(searched).toHaveLength(7);
  });

  it('can be told to search afresh, and does not cache a search that was cut short', async () => {
    const a = parseGamePgn(pgnOf(['e4', 'e5', 'Nf3']));
    await analyzeGame(a, 'white', undefined, undefined, null, { cache: null });
    await analyzeGame(a, 'white', undefined, undefined, null, { cache: null });
    expect(searched).toHaveLength(8);

    const cache = new EvalCache();
    cache.set(a[0].fenBefore, ANALYSIS_DEPTH, { score: { cp: 1 }, bestmove: 'e2e4', pv: [] });
    expect(cache.get(a[0].fenBefore, ANALYSIS_DEPTH)).toBeDefined();
    expect(cache.get(a[0].fenBefore, ANALYSIS_DEPTH + 2)).toBeUndefined();
  });

  it('reports progress per position', async () => {
    const seen: number[] = [];
    await analyzeGame(parseGamePgn(pgnOf(['e4', 'e5', 'Nf3'])), 'white', (p) => seen.push(p), undefined, null, { cache: null });
    // The first pass fills 80% of the bar; with nothing to re-check it then jumps to done.
    expect(seen.map((x) => Math.round(x * 100) / 100)).toEqual([0.2, 0.4, 0.6, 0.8, 1]);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });
});

describe('EvalCache', () => {
  it('ignores the move number but not the fifty-move clock', () => {
    const c = new EvalCache();
    c.set('8/8/8/8/8/8/4K3/7k w - - 0 40', 12, { score: { cp: 0 }, bestmove: 'e2e3', pv: [] });
    expect(c.get('8/8/8/8/8/8/4K3/7k w - - 0 73', 12)).toBeDefined();
    expect(c.get('8/8/8/8/8/8/4K3/7k w - - 98 73', 12)).toBeUndefined();
  });

  it('drops the least recently used entry when full', () => {
    const c = new EvalCache(2);
    const v = { score: { cp: 0 } as const, bestmove: '', pv: [] };
    c.set('a w - - 0 1', 12, v);
    c.set('b w - - 0 1', 12, v);
    c.get('a w - - 0 1', 12); // a is now the fresher one
    c.set('c w - - 0 1', 12, v);
    expect(c.size).toBe(2);
    expect(c.get('a w - - 0 1', 12)).toBeDefined();
    expect(c.get('b w - - 0 1', 12)).toBeUndefined();
  });
});

describe('ensureOpenings', () => {
  it('names what it can, marks what it cannot, and does not look again', async () => {
    await db.games.bulkAdd([
      game('named', ['e4', 'e5']),
      game('unnamed', ['a3', 'e5']),
      game('unreadable', [], { pgn: '1. e4 e5 2. Ke3 1-0' }),
      game('has-one', ['d4'], { opening: { eco: 'A40', name: "Queen's Pawn" } }),
    ]);
    expect(await ensureOpenings()).toBe(1);
    expect((await db.games.get('named'))?.opening).toEqual({ eco: 'B00', name: "King's Pawn" });
    expect((await db.games.get('unnamed'))?.openingChecked).toBe(true);
    expect((await db.games.get('unreadable'))?.openingChecked).toBe(true);
    expect((await db.games.get('has-one'))?.openingChecked).toBeUndefined();
    expect(await getSetting('gamesChecked')).toEqual({ v: 1, count: 4 });

    // Same number of games as last time: no scan at all.
    const scan = vi.spyOn(db.games, 'filter');
    expect(await ensureOpenings()).toBe(0);
    expect(scan).not.toHaveBeenCalled();

    // A new game triggers one pass, which skips everything already checked.
    await db.games.add(game('new', ['e4', 'c5']));
    expect(await ensureOpenings()).toBe(1);
    expect(scan).toHaveBeenCalledTimes(1);
    scan.mockRestore();
  });

  it('retires old analyses of games too short to score, and their puzzles', async () => {
    const hollow: GameAnalysis = {
      version: ANALYSIS_VERSION, depth: 12, evals: [0, 20], moves: [{ cls: 'good', drop: 0, best: 'e2e4' }],
      accuracy: 100, blunders: 0, mistakes: 0, analyzedAt: new Date(),
    };
    const real: GameAnalysis = { ...hollow, evals: [0, 1, 2, 3, 4], moves: Array.from({ length: 4 }, () => ({ cls: 'good' as const, drop: 0, best: 'e2e4' })), accuracy: 93 };
    await db.games.bulkAdd([
      game('zero', ['e4'], { userColor: 'black', analysis: hollow, opening: { eco: 'B00', name: "King's Pawn" } }),
      game('fine', ['e4', 'e5', 'Nf3', 'Nc6'], { analysis: real, opening: { eco: 'C44', name: "King's Knight" } }),
    ]);
    await setSetting('gamesChecked', undefined);
    await ensureOpenings();
    const zero = (await db.games.get('zero'))!;
    expect(zero.analysis).toBeUndefined();
    expect(zero.unanalysable).toBe(true);
    expect((await db.games.get('fine'))?.analysis?.accuracy).toBe(93);
  });
});
