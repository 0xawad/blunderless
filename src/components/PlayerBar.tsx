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
  active,
}: {
  name: string;
  sub?: string;
  side: 'white' | 'black';
  fen: string;
  /** Seconds left; omit for untimed. */
  clock?: number;
  /** This side is to move (its clock is running). */
  active?: boolean;
}) {
  const s = side === 'white' ? 'w' : 'b';
  const { captured, diff } = materialOf(fen);
  const lead = s === 'w' ? diff : -diff;
  const taken = captured[s];
  const theirColor = s === 'w' ? 'black' : 'white';
  const low = clock !== undefined && clock < 20;
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
      {clock !== undefined && (
        <span className={`clock ${active ? 'running' : ''} ${low ? 'low' : ''}`} role="timer" aria-label={`${name} clock`}>
          {fmtClock(Math.max(0, clock))}
        </span>
      )}
    </div>
  );
}
