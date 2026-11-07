// Clock data from Chess.com PGNs: [TimeControl "180+2"] and {[%clk 0:02:59.9]}
// after every move. Daily games and PGNs without clocks give null.

export interface TimeControl {
  base: number; // seconds
  inc: number; // seconds added per move
}

export function parseTimeControl(pgn: string): TimeControl | null {
  const m = /\[TimeControl "(\d+)(?:\+(\d+(?:\.\d+)?))?"\]/.exec(pgn);
  if (!m) return null; // "-", or "1/86400" for daily
  const base = Number(m[1]);
  return base > 0 ? { base, inc: Number(m[2] ?? 0) } : null;
}

/** Seconds left on the mover's clock after each ply, in order. */
export function parseClocks(pgn: string): number[] {
  const out: number[] = [];
  for (const m of pgn.matchAll(/\[%clk (\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)\]/g)) {
    out.push(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
  }
  return out;
}

export interface PlyClock {
  /** Seconds on your clock when it was your turn to move. */
  left: number;
  /** Seconds you spent on the move. */
  spent: number;
}

/** Per-ply clock readings, or null when the PGN doesn't carry one per move. */
export function plyClocks(pgn: string, plyCount: number): PlyClock[] | null {
  const tc = parseTimeControl(pgn);
  const clocks = parseClocks(pgn);
  if (!tc || clocks.length !== plyCount || !plyCount) return null;
  return clocks.map((after, i) => {
    const left = i >= 2 ? clocks[i - 2] : tc.base;
    return { left, spent: Math.max(0, Math.round((left + tc.inc - after) * 10) / 10) };
  });
}

/** Under this many seconds you're in time trouble. */
export const lowTime = (tc: TimeControl) => Math.max(20, tc.base * 0.1);

export function fmtClock(s: number): string {
  if (s >= 3600) return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  if (s >= 60) return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return s < 10 ? `${s.toFixed(1)}s` : `${Math.floor(s)}s`;
}
