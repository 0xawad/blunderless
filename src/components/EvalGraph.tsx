import { winPct } from '../engine/engine';
import type { MoveReview } from '../srs/types';

interface Props {
  evals: number[]; // White POV centipawns per position
  moves: MoveReview[];
  userColor: 'white' | 'black';
  ply: number; // current position index (0 = start)
  onSelect: (ply: number) => void;
}

const W = 600;
const H = 120;
const MARK: Record<string, string> = { blunder: 'var(--bad)', 'missed-win': 'var(--bad)', mistake: 'var(--warn)', inaccuracy: 'var(--brand)' };

/** Win% over the game from your point of view. Click to jump. */
export function EvalGraph({ evals, moves, userColor, ply, onSelect }: Props) {
  const sign = userColor === 'white' ? 1 : -1;
  const n = evals.length;
  if (n < 2) return null;
  const x = (i: number) => (i / (n - 1)) * W;
  const y = (cp: number) => H - (winPct(sign * cp) / 100) * H;
  const pts = evals.map((e, i) => `${x(i).toFixed(1)},${y(e).toFixed(1)}`);
  const area = `M0,${H} L${pts.join(' L')} L${W},${H} Z`;
  const line = `M${pts.join(' L')}`;

  return (
    <div className="evalgraph">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Evaluation over the game">
        <defs>
          <clipPath id="eg-top"><rect x="0" y="0" width={W} height={H / 2} /></clipPath>
          <clipPath id="eg-bottom"><rect x="0" y={H / 2} width={W} height={H / 2} /></clipPath>
        </defs>
        <rect x="0" y="0" width={W} height={H} className="eg-bg" />
        <path d={area} className="eg-area good" clipPath="url(#eg-top)" />
        <path d={area} className="eg-area bad" clipPath="url(#eg-bottom)" />
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} className="eg-mid" />
        <path d={line} className="eg-line" />
        {moves.map((m, i) =>
          MARK[m.cls] ? (
            <circle key={i} cx={x(i + 1)} cy={y(evals[i + 1])} r="4" fill={MARK[m.cls]} className="eg-mark" />
          ) : null,
        )}
        <line x1={x(ply)} y1="0" x2={x(ply)} y2={H} className="eg-cursor" />
        <rect
          x="0" y="0" width={W} height={H} fill="transparent" style={{ cursor: 'pointer' }}
          onClick={(e) => {
            const r = (e.target as SVGRectElement).getBoundingClientRect();
            const f = (e.clientX - r.left) / r.width;
            onSelect(Math.max(0, Math.min(n - 1, Math.round(f * (n - 1)))));
          }}
        />
      </svg>
    </div>
  );
}
