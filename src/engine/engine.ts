// Thin UCI wrapper around the Stockfish 19 lite WASM build in a Web Worker.
// Searches are serialised: one position at a time, in call order. If the
// worker dies or a search hangs, every pending search rejects and the next
// getEngine() call starts a fresh worker.
//
// A search that overruns its budget is first asked to stop (the engine then
// answers with the best move it has so far); the worker is only killed when
// it ignores that too.

export type Score = { cp: number; mate?: undefined } | { mate: number; cp?: undefined };

export interface SearchResult {
  bestmove: string;
  score: Score; // from the side to move's point of view
  pv: string[];
  depth: number;
}

export interface SearchOptions {
  depth?: number;
  movetime?: number;
  /** 0-20; omitted means full strength */
  skill?: number;
  /** Calibrated strength via UCI_LimitStrength (Stockfish accepts 1320-3190). Overrides skill. */
  elo?: number;
  /** Restrict the search to these moves (UCI). Used to ask "what is the best move other than X?". */
  searchmoves?: string[];
  /**
   * Abandons the search: a job still waiting its turn is skipped, a running
   * one is stopped. Either way the promise rejects with an AbortError.
   */
  signal?: AbortSignal;
}

export interface PvLine {
  multipv: number;
  score: Score; // side to move's POV
  depth: number;
  pv: string[];
}

export interface AnalyseOptions {
  multipv?: number;
  depth?: number;
  /**
   * The search ended by itself: it reached `depth`, or it ran out of time and
   * was stopped ('timeout') with the lines found so far. Not called after stop().
   */
  onDone?: (lines: PvLine[], how: 'depth' | 'timeout') => void;
  /** The engine failed to start or died. Not called after stop(). */
  onError?: (err: Error) => void;
}

export interface AnalysisHandle {
  /** Stops the search; resolves once the engine has acknowledged. A no-op once the search has ended. */
  stop(): Promise<void>;
}

/** The engine could not start, crashed, or stopped answering. */
export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineError';
  }
}

const MULTI = '/engine/stockfish-19-lite.js';
const SINGLE = '/engine/stockfish-19-lite-single.js';
const BOOT_TIMEOUT = 10_000;
/** Thread pool and hash allocation: slow on a weak phone, but never this slow unless something is wrong. */
const READY_TIMEOUT = 10_000;
const SEARCH_TIMEOUT = 60_000;
const ANALYSIS_TIMEOUT = SEARCH_TIMEOUT * 2;
/** After `stop` the engine must answer within a moment. */
const STOP_TIMEOUT = 5_000;

function abortError(): Error {
  const e = new Error('search aborted');
  e.name = 'AbortError';
  return e;
}

/** A callback from outside must not be able to break the engine's bookkeeping. */
function safely(fn: () => void) {
  try {
    fn();
  } catch (e) {
    console.error(e);
  }
}

export interface InfoLine extends PvLine {
  /** Set on aspiration-window lines: the score is only a bound, not a result. */
  bound?: 'lower' | 'upper';
}

/**
 * Parses a UCI `info` line that carries a score. Lines without a `pv` (the
 * engine's whole answer for a checkmated or stalemated position is
 * `info depth 0 score mate 0`) come back with an empty pv.
 */
export function parseInfoLine(line: string): InfoLine | null {
  const t = line.split(' ');
  if (t[0] !== 'info') return null;
  const s = t.indexOf('score');
  if (s === -1) return null;
  const kind = t[s + 1];
  const val = Number(t[s + 2]);
  if ((kind !== 'cp' && kind !== 'mate') || t[s + 2] === undefined || !Number.isFinite(val)) return null;
  const mpv = t.indexOf('multipv');
  const d = t.indexOf('depth');
  const pv = t.indexOf('pv');
  const info: InfoLine = {
    multipv: mpv === -1 ? 1 : Number(t[mpv + 1]) || 1,
    score: kind === 'mate' ? { mate: val } : { cp: val },
    depth: d === -1 ? 0 : Number(t[d + 1]) || 0,
    pv: pv === -1 ? [] : t.slice(pv + 1),
  };
  if (t[s + 3] === 'lowerbound') info.bound = 'lower';
  else if (t[s + 3] === 'upperbound') info.bound = 'upper';
  return info;
}

export class Engine {
  private worker!: Worker;
  private listener: ((line: string) => void) | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private failPending: ((err: Error) => void) | null = null;
  private skill = 20;
  private elo = 0; // 0 = not limited
  readonly ready: Promise<void>;
  threaded = false;
  dead = false;

  constructor() {
    this.ready = this.boot();
    this.ready.catch(() => this.kill(new EngineError('engine failed to boot')));
  }

  private spawn(url: string): Promise<void> {
    if (this.dead) return Promise.reject(new EngineError('engine terminated'));
    this.worker?.terminate();
    const worker = new Worker(url);
    this.worker = worker;
    // A worker that has been replaced must not talk over its successor.
    worker.onmessage = (e: MessageEvent) => {
      if (this.worker === worker) this.listener?.(String(e.data));
    };
    return this.expect('uciok', ['uci'], BOOT_TIMEOUT, 'engine failed to load');
  }

  /**
   * Sends `cmds` and waits for the line `answer`. Rejects if the worker
   * errors, is killed, or stays silent for `ms`, so no boot step can hang.
   */
  private expect(answer: string, cmds: string[], ms: number, what: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const settle = (err?: Error) => {
        clearTimeout(timer);
        this.listener = null;
        this.failPending = null;
        if (err) reject(err);
        else resolve();
      };
      const timer = setTimeout(() => settle(new EngineError(`${what} (timed out)`)), ms);
      this.worker.onerror = () => settle(new EngineError(what));
      this.failPending = settle;
      this.listener = (line) => {
        if (line === answer) settle();
      };
      for (const c of cmds) this.send(c);
    });
  }

  private async boot() {
    const hash = 'setoption name Hash value 32';
    const single = async () => {
      await this.spawn(SINGLE);
      await this.expect('readyok', [hash, 'isready'], READY_TIMEOUT, 'engine setup failed');
    };
    if (globalThis.crossOriginIsolated) {
      try {
        await this.spawn(MULTI);
        const threads = Math.max(1, Math.min(4, (navigator.hardwareConcurrency ?? 2) - 1));
        // Allocating the thread pool or the hash can stall or crash on a low-memory phone.
        await this.expect('readyok', [`setoption name Threads value ${threads}`, hash, 'isready'], READY_TIMEOUT, 'engine setup failed');
        this.threaded = true;
      } catch (e) {
        if (this.dead) throw e;
        await single();
      }
    } else {
      await single();
    }
    if (this.dead) throw new EngineError('engine terminated');
    // From here on a worker crash fails the running search instead of hanging it.
    this.worker.onerror = () => this.kill(new EngineError('engine crashed'));
  }

  private kill(err: Error) {
    this.dead = true;
    this.worker?.terminate();
    const fail = this.failPending;
    this.failPending = null;
    fail?.(err);
  }

  private send(cmd: string) {
    this.worker.postMessage(cmd);
  }

  search(fen: string, opts: SearchOptions = {}): Promise<SearchResult> {
    const { signal } = opts;
    const run = async () => {
      if (signal?.aborted) throw abortError(); // skipped while it was still queued
      await this.ready;
      if (this.dead) throw new EngineError('engine is dead');
      if (signal?.aborted) throw abortError();
      this.setStrength(opts.elo ? 20 : (opts.skill ?? 20), opts.elo ?? 0);
      return new Promise<SearchResult>((resolve, reject) => {
        let exact: InfoLine | null = null;
        let bound: InfoLine | null = null;
        let stopSent = false;
        let aborted = false;
        const stop = () => {
          if (stopSent) return;
          stopSent = true;
          this.send('stop');
          clearTimeout(timer);
          timer = setTimeout(() => this.kill(new EngineError('engine ignored stop')), STOP_TIMEOUT);
        };
        // Out of time: take the best move found so far rather than kill a healthy engine.
        let timer = setTimeout(stop, SEARCH_TIMEOUT);
        const onAbort = () => {
          aborted = true;
          stop();
        };
        const finish = () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          this.failPending = null;
          this.listener = null;
        };
        this.failPending = (err) => {
          finish();
          reject(err);
        };
        this.listener = (line) => {
          const info = parseInfoLine(line);
          if (info) {
            // A bound is not a score: a search cut off mid-window must not report one as its result.
            if (info.multipv !== 1) return;
            if (info.bound) bound = info;
            else exact = info;
            return;
          }
          if (!line.startsWith('bestmove')) return;
          finish();
          if (aborted) return reject(abortError());
          const best = line.split(' ')[1] ?? '';
          const last = exact ?? bound ?? { score: { cp: 0 } as Score, pv: [], depth: 0 };
          resolve({ score: last.score, pv: last.pv, depth: last.depth, bestmove: best === '(none)' ? '' : best });
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        this.send(`position fen ${fen}`);
        const only = opts.searchmoves?.length ? ` searchmoves ${opts.searchmoves.join(' ')}` : '';
        this.send((opts.movetime ? `go movetime ${opts.movetime}` : `go depth ${opts.depth ?? 12}`) + only);
      });
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }

  /**
   * Streams the top `multipv` lines for a position until stopped or `depth`
   * is reached. Queued behind other searches like everything else.
   * `opts.onDone` and `opts.onError` report how it ended.
   */
  analyse(fen: string, opts: AnalyseOptions, onLines: (lines: PvLine[]) => void): AnalysisHandle {
    let stopRequested = false;
    let sendStop: (() => void) | null = null;
    const multipv = opts.multipv ?? 3;

    const run = async () => {
      await this.ready;
      if (stopRequested) return;
      if (this.dead) throw new EngineError('engine is dead');
      this.setStrength(20, 0);
      this.send(`setoption name MultiPV value ${multipv}`);
      try {
        await new Promise<void>((resolve, reject) => {
          const lines: PvLine[] = [];
          let stopSent = false;
          let timedOut = false;
          const stop = () => {
            if (stopSent) return;
            stopSent = true;
            this.send('stop');
            clearTimeout(timer);
            timer = setTimeout(() => this.kill(new EngineError('engine ignored stop')), STOP_TIMEOUT);
          };
          // A deep search on a slow device is not a fault: stop it and keep what it found.
          // Both timers belong to this job only and are cleared the moment it ends.
          let timer = setTimeout(() => {
            timedOut = true;
            stop();
          }, ANALYSIS_TIMEOUT);
          const finish = () => {
            clearTimeout(timer);
            // The job is over: a late stop() must not reach the engine or arm a kill timer.
            sendStop = null;
            this.failPending = null;
            this.listener = null;
          };
          this.failPending = (err) => {
            finish();
            reject(err);
          };
          this.listener = (line) => {
            const l = parseInfoLine(line);
            if (l) {
              if (l.bound || !l.pv.length) return;
              lines[l.multipv - 1] = { multipv: l.multipv, score: l.score, depth: l.depth, pv: l.pv };
              if (!stopRequested) safely(() => onLines(lines.filter(Boolean)));
              return;
            }
            if (!line.startsWith('bestmove')) return;
            finish();
            if (!stopRequested) safely(() => opts.onDone?.(lines.filter(Boolean), timedOut ? 'timeout' : 'depth'));
            resolve();
          };
          sendStop = stop;
          this.send(`position fen ${fen}`);
          this.send(`go depth ${opts.depth ?? 20}`);
        });
      } finally {
        if (!this.dead) this.send('setoption name MultiPV value 1');
      }
    };

    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    p.catch((e: unknown) => {
      if (!stopRequested) safely(() => opts.onError?.(e instanceof Error ? e : new EngineError(String(e))));
    });
    return {
      stop: () => {
        stopRequested = true;
        sendStop?.();
        return p.catch(() => undefined);
      },
    };
  }

  private setStrength(skill: number, elo: number) {
    if (skill !== this.skill) {
      this.send(`setoption name Skill Level value ${skill}`);
      this.skill = skill;
    }
    if (elo !== this.elo) {
      if (elo) this.send(`setoption name UCI_Elo value ${Math.max(1320, Math.min(3190, elo))}`);
      this.send(`setoption name UCI_LimitStrength value ${elo ? 'true' : 'false'}`);
      this.elo = elo;
    }
  }

  terminate() {
    this.kill(new EngineError('engine terminated'));
  }
}

let shared: Engine | null = null;
export function getEngine(): Engine {
  if (!shared || shared.dead) shared = new Engine();
  return shared;
}

/** Mate scores folded into centipawns so they compare and average sensibly. */
export function scoreToCp(s: Score): number {
  if (s.mate !== undefined) return s.mate > 0 ? 10_000 - s.mate * 10 : -10_000 - s.mate * 10;
  return s.cp;
}

/** Lichess's win-probability curve, 0-100. */
export function winPct(cp: number): number {
  const c = Math.max(-1000, Math.min(1000, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
}

/** Lichess's per-move accuracy from a win% drop. */
export function moveAccuracy(winDrop: number): number {
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * Math.max(0, winDrop)) - 3.1669));
}
