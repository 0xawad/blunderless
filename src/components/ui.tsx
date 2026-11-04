import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { copy } from '../copy';
import { db, statusOf, type CardRow, type LineStatus } from '../srs/db';
import type { Repertoire } from '../repertoire';

export function useCards(): Map<string, CardRow> | undefined {
  return useLiveQuery(async () => new Map((await db.cards.toArray()).map((c) => [c.lineId, c])), []);
}

export function StatusBadge({ status }: { status: LineStatus }) {
  return <span className={`badge ${status}`}>{copy.status[status]}</span>;
}

export function RepertoireTile({ rep, cards }: { rep: Repertoire; cards?: Map<string, CardRow> }) {
  const counts = { new: 0, learning: 0, due: 0, known: 0 } satisfies Record<LineStatus, number>;
  for (const l of rep.lines) counts[statusOf(cards?.get(l.id))]++;
  const total = rep.lines.length;
  const started = total - counts.new;

  return (
    <Link to={`/openings/${rep.id}`} className={`card tile ${rep.side}`}>
      <div className="tile-side">{rep.side === 'white' ? '♔ as White' : '♚ as Black'}</div>
      <h3>{rep.title}</h3>
      <p className="muted">{rep.tagline}</p>
      <div className="meter" aria-label={`${started} of ${total} lines started`}>
        <span className="known" style={{ width: `${(counts.known / total) * 100}%` }} />
        <span className="learning" style={{ width: `${((counts.learning + counts.due) / total) * 100}%` }} />
      </div>
      <div className="tile-foot">
        <span>{started}/{total} lines</span>
        {counts.due > 0 && <StatusBadge status="due" />}
      </div>
    </Link>
  );
}
