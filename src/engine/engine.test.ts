import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Engine, EngineError, parseInfoLine, scoreToCp, type PvLine } from './engine';

/** Stands in for the Stockfish worker: records what it is sent and says what the test tells it to. */
class FakeWorker {
  static all: FakeWorker[] = [];
  /** Per-URL override: return true when the command was handled. */
  static script: (w: FakeWorker, cmd: string) => boolean = () => false;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  terminated = false;
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeWorker.all.push(this);
  }

  postMessage(cmd: string) {
    this.sent.push(cmd);
    if (FakeWorker.script(this, cmd)) return;
    if (cmd === 'uci') queueMicrotask(() => this.say('uciok'));
    if (cmd === 'isready') queueMicrotask(() => this.say('readyok'));
  }

  terminate() {
    this.terminated = true;
  }

  say(line: string) {
    if (!this.terminated) this.onmessage?.({ data: line });
  }
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const outcome = <T>(p: Promise<T>) => p.then((value) => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }));
const isAbort = (e: unknown) => e instanceof Error && e.name === 'AbortError';

async function boot(): Promise<{ engine: Engine; worker: FakeWorker }> {
  const engine = new Engine();
  await engine.ready;
  return { engine, worker: FakeWorker.all[FakeWorker.all.length - 1] };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  FakeWorker.all = [];
  FakeWorker.script = () => false;
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('crossOriginIsolated', false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('parseInfoLine', () => {
  it('reads score, depth, multipv and pv', () => {
    expect(parseInfoLine('info depth 12 seldepth 18 multipv 2 score cp -34 nodes 1000 nps 9 pv e7e5 g1f3')).toEqual({
      multipv: 2, score: { cp: -34 }, depth: 12, pv: ['e7e5', 'g1f3'],
    });
    expect(parseInfoLine('info depth 9 score mate 3 pv d8h4')).toMatchObject({ multipv: 1, score: { mate: 3 }, pv: ['d8h4'] });
  });

  it('marks bounds', () => {
    expect(parseInfoLine('info depth 14 score cp 80 lowerbound pv e2e4')?.bound).toBe('lower');
    expect(parseInfoLine('info depth 14 score cp 10 upperbound pv e2e4')?.bound).toBe('upper');
    expect(parseInfoLine('info depth 14 score cp 10 pv e2e4')?.bound).toBeUndefined();
  });

  it('keeps a score-only line: all the engine says about a mated position', () => {
    expect(parseInfoLine('info depth 0 score mate 0')).toEqual({ multipv: 1, score: { mate: 0 }, depth: 0, pv: [] });
    expect(parseInfoLine('info depth 0 score cp 0')).toMatchObject({ score: { cp: 0 }, pv: [] });
  });

  it('ignores everything else', () => {
    expect(parseInfoLine('info depth 10 currmove e2e4 currmovenumber 1')).toBeNull();
    expect(parseInfoLine('info string NNUE evaluation enabled')).toBeNull();
    expect(parseInfoLine('bestmove e2e4 ponder e7e5')).toBeNull();
  });
});

describe('search', () => {
  it('returns the last exact score, not an aspiration bound', async () => {
    const { engine, worker } = await boot();
    const p = engine.search(START, { movetime: 500 });
    await vi.advanceTimersByTimeAsync(0);
    expect(worker.sent).toContain('go movetime 500');
    worker.say('info depth 10 multipv 1 score cp 30 pv e2e4 e7e5');
    worker.say('info depth 11 multipv 1 score cp 55 lowerbound pv d2d4');
    worker.say('bestmove d2d4 ponder d7d5');
    await expect(p).resolves.toEqual({ bestmove: 'd2d4', score: { cp: 30 }, pv: ['e2e4', 'e7e5'], depth: 10 });
  });

  it('reports a mated position as mate 0 instead of equal', async () => {
    const { engine, worker } = await boot();
    const p = engine.search('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
    await vi.advanceTimersByTimeAsync(0);
    worker.say('info depth 0 score mate 0');
    worker.say('bestmove (none)');
    const r = await p;
    expect(r).toMatchObject({ bestmove: '', score: { mate: 0 }, pv: [] });
    expect(scoreToCp(r.score)).toBe(-10_000);
  });

  it('skips a queued search whose signal fired before its turn', async () => {
    const { engine, worker } = await boot();
    const first = engine.search(START, { depth: 12 });
    const ctl = new AbortController();
    const second = outcome(engine.search('8/8/8/8/8/8/4K3/7k w - - 0 1', { depth: 12, signal: ctl.signal }));
    await vi.advanceTimersByTimeAsync(0);
    ctl.abort();
    worker.say('info depth 12 score cp 20 pv e2e4');
    worker.say('bestmove e2e4');
    await first;
    expect(isAbort((await second).error)).toBe(true);
    expect(worker.sent.filter((c) => c.startsWith('position'))).toHaveLength(1);
    expect(worker.sent).not.toContain('stop');
    expect(engine.dead).toBe(false);
  });

  it('stops a running search when its signal fires, and stays usable', async () => {
    const { engine, worker } = await boot();
    const ctl = new AbortController();
    const p = outcome(engine.search(START, { depth: 20, signal: ctl.signal }));
    await vi.advanceTimersByTimeAsync(0);
    ctl.abort();
    expect(worker.sent[worker.sent.length - 1]).toBe('stop');
    worker.say('bestmove e2e4');
    expect(isAbort((await p).error)).toBe(true);
    // The stop timer died with the job.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(engine.dead).toBe(false);
    const next = engine.search(START, { depth: 1 });
    await vi.advanceTimersByTimeAsync(0);
    worker.say('info depth 1 score cp 10 pv g1f3');
    worker.say('bestmove g1f3');
    await expect(next).resolves.toMatchObject({ bestmove: 'g1f3' });
  });

  it('asks an overrunning search to stop and takes its answer rather than killing the engine', async () => {
    const { engine, worker } = await boot();
    const p = engine.search(START, { depth: 30 });
    await vi.advanceTimersByTimeAsync(0);
    worker.say('info depth 22 score cp 18 pv e2e4');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(worker.sent[worker.sent.length - 1]).toBe('stop');
    expect(engine.dead).toBe(false);
    worker.say('bestmove e2e4');
    await expect(p).resolves.toMatchObject({ bestmove: 'e2e4', depth: 22 });
  });

  it('kills the engine only when stop is ignored too', async () => {
    const { engine } = await boot();
    const p = outcome(engine.search(START, { depth: 30 }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(engine.dead).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    const { error } = await p;
    expect(error).toBeInstanceOf(EngineError);
    expect(engine.dead).toBe(true);
  });
});

describe('analyse', () => {
  it('a stop() after the analysis finished is a no-op: no stray stop, no kill five seconds later', async () => {
    const { engine, worker } = await boot();
    const done = vi.fn();
    const h = engine.analyse(START, { multipv: 1, depth: 18, onDone: done }, () => undefined);
    await vi.advanceTimersByTimeAsync(0);
    worker.say('info depth 18 multipv 1 score cp 25 pv e2e4 e7e5');
    worker.say('bestmove e2e4');
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toHaveBeenCalledWith([expect.objectContaining({ depth: 18 })], 'depth');

    await h.stop();
    expect(worker.sent).not.toContain('stop');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(engine.dead).toBe(false);
    expect(worker.terminated).toBe(false);
  });

  it('streams lines, ignoring bounds, and goes quiet after stop()', async () => {
    const { engine, worker } = await boot();
    const seen: PvLine[][] = [];
    const done = vi.fn();
    const h = engine.analyse(START, { multipv: 2, onDone: done }, (ls) => seen.push(ls));
    await vi.advanceTimersByTimeAsync(0);
    expect(worker.sent).toContain('setoption name MultiPV value 2');
    worker.say('info depth 8 multipv 1 score cp 30 pv e2e4');
    worker.say('info depth 8 multipv 2 score cp 20 pv d2d4');
    worker.say('info depth 9 multipv 1 score cp 90 lowerbound pv e2e4');
    expect(seen).toHaveLength(2);
    expect(seen[1].map((l) => l.score)).toEqual([{ cp: 30 }, { cp: 20 }]);

    const stopped = h.stop();
    expect(worker.sent[worker.sent.length - 1]).toBe('stop');
    worker.say('info depth 9 multipv 1 score cp 31 pv e2e4');
    worker.say('bestmove e2e4');
    await stopped;
    expect(seen).toHaveLength(2);
    expect(done).not.toHaveBeenCalled();
    expect(worker.sent[worker.sent.length - 1]).toBe('setoption name MultiPV value 1');
  });

  it('on a slow search the watchdog stops it, keeps the lines and reports a timeout', async () => {
    const { engine, worker } = await boot();
    const done = vi.fn();
    const error = vi.fn();
    engine.analyse(START, { multipv: 1, depth: 30, onDone: done, onError: error }, () => undefined);
    await vi.advanceTimersByTimeAsync(0);
    worker.say('info depth 21 multipv 1 score cp 12 pv e2e4');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(worker.sent[worker.sent.length - 1]).toBe('stop');
    expect(engine.dead).toBe(false);
    worker.say('bestmove e2e4');
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toHaveBeenCalledWith([expect.objectContaining({ depth: 21 })], 'timeout');
    expect(error).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(engine.dead).toBe(false);
  });

  it('tells the caller when the engine dies', async () => {
    const { engine, worker } = await boot();
    const error = vi.fn();
    engine.analyse(START, { onError: error }, () => undefined);
    await vi.advanceTimersByTimeAsync(0);
    worker.onerror?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(error).toHaveBeenCalledWith(expect.any(EngineError));
    expect(engine.dead).toBe(true);
  });

  it('a throwing callback does not wedge the queue', async () => {
    const { engine, worker } = await boot();
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    engine.analyse(START, { multipv: 1 }, () => {
      throw new Error('render blew up');
    });
    await vi.advanceTimersByTimeAsync(0);
    worker.say('info depth 5 multipv 1 score cp 1 pv e2e4');
    worker.say('bestmove e2e4');
    const next = engine.search(START, { depth: 1 });
    await vi.advanceTimersByTimeAsync(0);
    worker.say('bestmove e2e4');
    await expect(next).resolves.toMatchObject({ bestmove: 'e2e4' });
    quiet.mockRestore();
  });
});

describe('boot', () => {
  it('falls back to the single-threaded build when the threaded one stalls before readyok', async () => {
    vi.stubGlobal('crossOriginIsolated', true);
    // The threaded worker answers `uci` and then never gets through its setup.
    FakeWorker.script = (w, cmd) => !w.url.includes('single') && cmd === 'isready';
    const engine = new Engine();
    const ready = outcome(engine.ready);
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await ready).error).toBeUndefined();
    expect(FakeWorker.all.map((w) => w.url)).toEqual(['/engine/stockfish-19-lite.js', '/engine/stockfish-19-lite-single.js']);
    expect(FakeWorker.all[0].terminated).toBe(true);
    expect(engine.threaded).toBe(false);
    expect(engine.dead).toBe(false);
  });

  it('uses the threaded build when it comes up', async () => {
    vi.stubGlobal('crossOriginIsolated', true);
    const { engine, worker } = await boot();
    expect(engine.threaded).toBe(true);
    expect(worker.sent.some((c) => c.startsWith('setoption name Threads value'))).toBe(true);
  });

  it('fails every waiting search instead of hanging when no build answers', async () => {
    FakeWorker.script = (_w, cmd) => cmd === 'isready';
    const engine = new Engine();
    const p = outcome(engine.search(START));
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await p).error).toBeInstanceOf(EngineError);
    expect(engine.dead).toBe(true);
  });

  it('fails over when the worker crashes during setup', async () => {
    vi.stubGlobal('crossOriginIsolated', true);
    FakeWorker.script = (w, cmd) => {
      if (w.url.includes('single') || cmd !== 'isready') return false;
      queueMicrotask(() => w.onerror?.());
      return true;
    };
    const engine = new Engine();
    await engine.ready;
    expect(engine.threaded).toBe(false);
    expect(FakeWorker.all).toHaveLength(2);
  });

  it('terminate() during boot leaves no live worker behind', async () => {
    vi.stubGlobal('crossOriginIsolated', true);
    FakeWorker.script = (_w, cmd) => cmd === 'uci'; // never answers
    const engine = new Engine();
    const ready = outcome(engine.ready);
    engine.terminate();
    expect((await ready).error).toBeInstanceOf(EngineError);
    expect(FakeWorker.all).toHaveLength(1);
    expect(FakeWorker.all[0].terminated).toBe(true);
  });
});
