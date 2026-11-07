import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { copy } from '../copy';
import { formatLine, formatPly, getRepertoire } from '../repertoire';
import { db, statusOf, weakSpots } from '../srs/db';
import { repertoireStats } from '../games/repstats';
import { StatusBadge, useCards } from '../components/ui';

export function RepertoirePage() {
  const { repId = '' } = useParams();
  const rep = getRepertoire(repId);
  const cards = useCards();
  const spots = useLiveQuery(() => weakSpots(repId, 6), [repId]);
  const stats = useLiveQuery(async () => repertoireStats(await db.games.toArray()).get(repId), [repId]);
  if (!rep) return <p className="empty">{copy.notFound}</p>;

  const dueHere = rep.lines.filter((l) => statusOf(cards?.get(l.id)) === 'due').length;
  const started = rep.lines.filter((l) => cards?.get(l.id)).length;
  const nextNew = rep.lines.find((l) => !cards?.get(l.id));

  return (
    <>
      <Link to="/openings" className="back">← All openings</Link>
      <div className="page-head">
        <div>
          <h1>{rep.title}</h1>
          <p className="lead">{rep.tagline}</p>
        </div>
        <div className="row">
          {dueHere > 0 && (
            <Link to={`/drill?rep=${rep.id}`} className="btn primary">
              Drill {dueHere} due
            </Link>
          )}
          {nextNew && (
            <Link to={`/learn/${rep.id}/${rep.lines.indexOf(nextNew)}`} className={`btn ${dueHere ? 'ghost' : 'primary'}`}>
              {started ? copy.rep.continueLearning : copy.rep.startLearning}
            </Link>
          )}
        </div>
      </div>

      <div className="rep-panels">
        <section className="card rep-panel">
          <p className="eyebrow">{copy.rep.yourGames}</p>
          {stats ? (
            <>
              <div className="rep-nums">
                <div><strong>{stats.games}</strong><span className="muted small">games</span></div>
                <div><strong>{Math.round(((stats.wins + stats.draws / 2) / stats.games) * 100)}%</strong><span className="muted small">score</span></div>
                <div><strong>{stats.avgBookMoves}</strong><span className="muted small">moves in book</span></div>
              </div>
              <p className="muted small">{copy.rep.leftFirst(stats.youLeftFirst, stats.games)}</p>
            </>
          ) : (
            <p className="muted small">{copy.rep.noGames}</p>
          )}
        </section>

        <section className="card rep-panel">
          <p className="eyebrow">{copy.rep.weakSpots}</p>
          {spots?.length ? (
            <ul className="spots">
              {spots.map((s) => {
                const p = s.line.plies[s.ply];
                return (
                  <li key={`${s.line.id}:${s.ply}`}>
                    <Link to={`/drill?line=${encodeURIComponent(s.line.id)}`}>
                      <strong>{formatPly(s.ply, p.san)}</strong>
                      <span className="muted small"> · {s.line.chapterTitle} · {s.line.label}</span>
                      <span className="badge due">×{s.misses}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted small">{copy.rep.noSpots}</p>
          )}
        </section>
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
