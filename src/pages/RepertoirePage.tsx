import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { copy } from '../copy';
import { formatLine, formatPly, getRepertoire } from '../repertoire';
import { statusOf, weakSpots } from '../srs/db';
import { repReport, type Spot } from '../games/openingReport';
import { StatusBadge, useCards } from '../components/ui';
import { toggleFocus, useFocus } from '../focus';
import { useGamesNewestFirst } from './Openings';

function SpotList({ spots, repId, kind }: { spots: Spot[]; repId: string; kind: 'surprise' | 'slip' }) {
  return (
    <ul className="spots">
      {spots.map((s) => (
        <li key={s.before + s.move}>
          <Link
            to={kind === 'slip' ? `/openings/${repId}/map?mode=explore&moves=${encodeURIComponent(s.sans.join(','))}` : `/games/${encodeURIComponent(s.lastGameId)}`}
          >
            <span>
              <span className="muted small">{s.before || 'Start'} </span>
              <strong>{kind === 'slip' ? copy.rep.instead(formatPly(s.sans.length, s.move), s.expected!) : formatPly(s.sans.length, s.move)}</strong>
            </span>
            <span className="badge due">{copy.rep.timesSeen(s.count)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function RepertoirePage() {
  const { repId = '' } = useParams();
  const rep = getRepertoire(repId);
  const cards = useCards();
  const focus = useFocus();
  const spots = useLiveQuery(() => weakSpots(repId, 6), [repId]);
  const games = useGamesNewestFirst();
  const report = useMemo(() => (rep && games ? repReport(rep, games) : undefined), [rep, games]);
  if (!rep) return <p className="empty">{copy.notFound}</p>;

  const dueHere = rep.lines.filter((l) => statusOf(cards?.get(l.id)) === 'due').length;
  const started = rep.lines.filter((l) => cards?.get(l.id)).length;
  const nextNew = rep.lines.find((l) => !cards?.get(l.id));
  const inFocus = focus?.includes(rep.id);

  return (
    <>
      <Link to="/openings" className="back">← All openings</Link>
      <div className="page-head">
        <div>
          <p className="tile-side">{rep.side === 'white' ? '♔ as White' : '♚ as Black'}</p>
          <h1>{rep.title}</h1>
          <p className="lead">{rep.tagline}</p>
        </div>
        <div className="row">
          {focus && (
            <button className={`chip ${inFocus ? 'on' : ''}`} aria-pressed={inFocus} onClick={() => toggleFocus(rep.id, focus)}>
              {inFocus ? `★ ${copy.rep.focusOn}` : `☆ ${copy.rep.focus}`}
            </button>
          )}
        </div>
      </div>

      <div className="practice wide">
        {dueHere > 0 && (
          <Link to={`/drill?rep=${rep.id}`} className="practice-btn hot">
            <span className="action-icon bad" aria-hidden>♘</span>
            <span><strong>{copy.rep.drill(dueHere)}</strong><span className="muted small">Spaced repetition</span></span>
          </Link>
        )}
        {nextNew && (
          <Link to={`/learn/${rep.id}/${rep.lines.indexOf(nextNew)}`} className="practice-btn">
            <span className="action-icon brand" aria-hidden>♗</span>
            <span>
              <strong>{started ? copy.rep.continueLearning : copy.rep.startLearning}</strong>
              <span className="muted small">{copy.rep.learnSub}</span>
            </span>
          </Link>
        )}
        <Link to={`/openings/${rep.id}/map?mode=spar`} className="practice-btn">
          <span className="action-icon good" aria-hidden>⚔</span>
          <span><strong>{copy.rep.spar}</strong><span className="muted small">{copy.rep.sparSub}</span></span>
        </Link>
        <Link to={`/openings/${rep.id}/map`} className="practice-btn">
          <span className="action-icon accent" aria-hidden>⌖</span>
          <span><strong>{copy.rep.explore}</strong><span className="muted small">{copy.rep.exploreSub}</span></span>
        </Link>
      </div>

      <div className="rep-panels">
        <section className="card rep-panel">
          <p className="eyebrow">{copy.rep.yourGames}</p>
          {report?.adopted ? (
            <>
              <div className="rep-nums">
                <div><strong>{report.adopted}</strong><span className="muted small">games</span></div>
                <div><strong>{Math.round(((report.wins + report.draws / 2) / report.adopted) * 100)}%</strong><span className="muted small">score</span></div>
                <div><strong>{report.avgBookMoves}</strong><span className="muted small">moves in book</span></div>
              </div>
              <p className="muted small">{copy.rep.adoption(report.adopted, report.reached)}.</p>
              <p className="muted small">{copy.rep.whoLeft(report.youLeft, report.theyLeft, report.fullPrep)}</p>
            </>
          ) : (
            <p className="muted small">{report?.reached ? copy.rep.adoption(0, report.reached) : copy.rep.noGames}</p>
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
                      <span>
                        <strong>{formatPly(s.ply, p.san)}</strong>
                        <span className="muted small"> · {s.line.chapterTitle} · {s.line.label}</span>
                      </span>
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

        {report && report.slips.length > 0 && (
          <section className="card rep-panel">
            <p className="eyebrow">{copy.rep.slips}</p>
            <p className="muted small">{copy.rep.slipsHint}</p>
            <SpotList spots={report.slips} repId={rep.id} kind="slip" />
          </section>
        )}
        {report && report.surprises.length > 0 && (
          <section className="card rep-panel">
            <p className="eyebrow">{copy.rep.surprises}</p>
            <p className="muted small">{copy.rep.surprisesHint}</p>
            <SpotList spots={report.surprises} repId={rep.id} kind="surprise" />
          </section>
        )}
      </div>

      {rep.chapters.map((ch, ci) => {
        const dueIn = ch.lines.filter((l) => statusOf(cards?.get(l.id)) === 'due').length;
        const known = ch.lines.filter((l) => statusOf(cards?.get(l.id)) === 'known').length;
        return (
        <details key={ch.id} className="card chapter" open={ci === 0 || dueIn > 0}>
          <summary>
            <span>
              <h2>{ch.title}</h2>
              {ch.intro && <p className="muted small">{ch.intro}</p>}
            </span>
            <span className="chapter-meta muted small">
              {copy.rep.chapterMeta(ch.lines.length, known)}
              {dueIn > 0 && <StatusBadge status="due" />}
            </span>
          </summary>
          <ul className="lines">
            {ch.lines.map((line) => {
              const index = rep.lines.indexOf(line);
              return (
                <li key={line.id}>
                  <Link to={`/learn/${rep.id}/${index}`}>
                    <span className="line-label">{line.label}</span>
                    <span className="line-moves">{formatLine(line.plies.slice(0, 12))}{line.plies.length > 12 ? ' …' : ''}</span>
                    <StatusBadge status={statusOf(cards?.get(line.id))} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </details>
        );
      })}
    </>
  );
}
