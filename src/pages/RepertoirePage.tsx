import { Link, useParams } from 'react-router-dom';
import { copy } from '../copy';
import { formatLine, getRepertoire } from '../repertoire';
import { statusOf } from '../srs/db';
import { StatusBadge, useCards } from '../components/ui';

export function RepertoirePage() {
  const { repId = '' } = useParams();
  const rep = getRepertoire(repId);
  const cards = useCards();
  if (!rep) return <p className="empty">{copy.notFound}</p>;

  const dueHere = rep.lines.filter((l) => statusOf(cards?.get(l.id)) === 'due').length;

  return (
    <>
      <Link to="/openings" className="back">← All openings</Link>
      <div className="page-head">
        <div>
          <h1>{rep.title}</h1>
          <p className="lead">{rep.tagline}</p>
        </div>
        {dueHere > 0 && (
          <Link to={`/drill?rep=${rep.id}`} className="btn primary">
            Drill {dueHere} due
          </Link>
        )}
      </div>

      {rep.chapters.map((ch) => (
        <section key={ch.id} className="card chapter">
          <h2>{ch.title}</h2>
          {ch.intro && <p className="muted">{ch.intro}</p>}
          <ul className="lines">
            {ch.lines.map((line) => {
              const index = rep.lines.indexOf(line);
              return (
                <li key={line.id}>
                  <Link to={`/learn/${rep.id}/${index}`}>
                    <span className="line-label">{line.label}</span>
                    <span className="line-moves">{formatLine(line.plies)}</span>
                    <StatusBadge status={statusOf(cards?.get(line.id))} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}
