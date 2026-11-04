// Thin UCI wrapper around the Stockfish 19 lite WASM build in a Web Worker.
// Searches are serialised: one position at a time, in call order.

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
}

const MULTI = '/engine/stockfish-19-lite.js';
const SINGLE = '/engine/stockfish-19-lite-single.js';
const BOOT_TIMEOUT = 10_000;

function parseInfo(line: string): Omit<SearchResult, 'bestmove'> | null {
  const t = line.split(' ');
  if (t[0] !== 'info' || !t.includes('pv') || !t.includes('score')) return null;
  const mpv = t.indexOf('multipv');
  if (mpv !== -1 && t[mpv + 1] !== '1') return null;
  const s = t.indexOf('score');
  const kind = t[s + 1];
  const val = Number(t[s + 2]);
  const score: Score = kind === 'mate' ? { mate: val } : { cp: val };
  return { score, depth: Number(t[t.indexOf('depth') + 1]), pv: t.slice(t.indexOf('pv') + 1) };
}

export class Engine {
  private worker!: Worker;
  private listener: ((line: string) => void) | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private skill = 20;
  readonly ready: Promise<void>;
  threaded = false;

  constructor() {
    this.ready = this.boot();
  }

  private spawn(url: string): Promise<void> {
    this.worker?.terminate();
    this.worker = new Worker(url);
    this.worker.onmessage = (e: MessageEvent) => this.listener?.(String(e.data));
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('engine boot timeout')), BOOT_TIMEOUT);
      this.worker.onerror = () => {
        clearTimeout(timer);
        reject(new Error('engine failed to load'));
      };
      this.listener = (line) => {
        if (line === 'uciok') {
          clearTimeout(timer);
          resolve();
        }
      };
      this.send('uci');
    });
  }

  private async boot() {
    if (globalThis.crossOriginIsolated) {
      try {
        await this.spawn(MULTI);
        this.threaded = true;
        const threads = Math.max(1, Math.min(4, (navigator.hardwareConcurrency ?? 2) - 1));
        this.send(`setoption name Threads value ${threads}`);
      } catch {
        await this.spawn(SINGLE);
      }
    } else {
      await this.spawn(SINGLE);
    }
    this.send('setoption name Hash value 32');
    await this.waitFor('isready', (l) => l === 'readyok');
  }

  private send(cmd: string) {
    this.worker.postMessage(cmd);
  }

  private waitFor(cmd: string, done: (line: string) => boolean): Promise<void> {
    return new Promise((resolve) => {
      this.listener = (line) => {
        if (done(line)) resolve();
      };
      this.send(cmd);
    });
  }

  search(fen: string, opts: SearchOptions = {}): Promise<SearchResult> {
    const run = async () => {
      await this.ready;
      const skill = opts.skill ?? 20;
      if (skill !== this.skill) {
        this.send(`setoption name Skill Level value ${skill}`);
        this.skill = skill;
      }
      return new Promise<SearchResult>((resolve) => {
        let last: Omit<SearchResult, 'bestmove'> = { score: { cp: 0 }, pv: [], depth: 0 };
        this.listener = (line) => {
          const info = parseInfo(line);
          if (info) last = info;
          else if (line.startsWith('bestmove')) {
            const best = line.split(' ')[1];
            resolve({ ...last, bestmove: best === '(none)' ? '' : best });
          }
        };
        this.send(`position fen ${fen}`);
        this.send(opts.movetime ? `go movetime ${opts.movetime}` : `go depth ${opts.depth ?? 12}`);
      });
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }

  terminate() {
    this.worker?.terminate();
  }
}

let shared: Engine | null = null;
export const getEngine = () => (shared ??= new Engine());

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
