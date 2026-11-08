import { useEffect, useState } from 'react';
import { materialOf } from '../chess/game';
import { fmtClock } from '../games/clock';

const ROLE: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen' };

/**
 * The strip above or below the board: who is playing this side, what they've
 * captured, the material balance, and (optionally) their clock.
 */
export function PlayerBar({
  name,
  sub,
  side,
  fen,
  clock,
  runningSince,
  active,
}: {
  name: string;
  sub?: string;
  side: 'white' | 'black';
  fen: string;
  /** Seconds left (at `runningSince`, if running); omit for untimed. */
  clock?: number;
  /** performance.now() when this clock started running; it then counts down by itself. */
  runningSince?: number;
  /** This side is to move (its clock is running). */
  active?: boolean;
}) {
  const s = side === 'white' ? 'w' : 'b';
  const { captured, diff } = materialOf(fen);
  const lead = s === 'w' ? diff : -diff;
  const taken = captured[s];
  const theirColor = s === 'w' ? 'black' : 'white';
  return (
    <div className={`player-bar ${active ? 'active' : ''}`}>
      <span className={`player-dot ${side}`} aria-hidden />
      <div className="player-id">
        <strong>{name}</strong>
        {sub && <span className="muted small">{sub}</span>}
      </div>
      <div className="captured cg-wrap" aria-label={taken.length ? `Captured: ${taken.map((t) => ROLE[t]).join(', ')}` : undefined}>
        {taken.map((t, i) => (
          <piece key={i} className={`${theirColor} ${ROLE[t]} ${taken[i - 1] === t ? 'stack' : ''}`} />
        ))}
        {lead > 0 && <span className="lead">+{lead}</span>}
      </div>
      {clock !== undefined && <Clock seconds={clock} since={runningSince} active={!!active} label={`${name} clock`} />}
    </div>
  );
}

/** Counts itself down while running, so the page around it doesn't re-render ten times a second. */
function Clock({ seconds, since, active, label }: { seconds: number; since?: number; active: boolean; label: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (since === undefined) return;
    const id = window.setInterval(() => tick((n) => n + 1), 100);
    return () => clearInterval(id);
  }, [since]);
  const left = Math.max(0, seconds - (since !== undefined ? (performance.now() - since) / 1000 : 0));
  return (
    <span className={`clock ${active ? 'running' : ''} ${left < 20 ? 'low' : ''}`} role="timer" aria-label={label}>
      {fmtClock(left)}
    </span>
  );
}
