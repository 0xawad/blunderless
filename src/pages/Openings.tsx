import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { copy } from '../copy';
import { repertoires, type Repertoire } from '../repertoire';
import { RepertoireTile, useCards } from '../components/ui';
import { db, statusOf, type CardRow } from '../srs/db';
import { openingFamilies, repReport, type RepReport } from '../games/openingReport';
import { toggleFocus, useFocus } from '../focus';
import type { GameRow } from '../srs/types';

export function useGamesNewestFirst() {
  return useLiveQuery(() => db.games.orderBy('endTime').reverse().toArray(), []);
}

/** Big card for a focus opening: progress, real-game numbers, and the three ways to practise. */
export function FocusCard({ rep, cards, report, onUnfocus }: { rep: Repertoire; cards?: Map<string, CardRow>; report?: RepReport; onUnfocus?: () => void }) {
  const counts = { new: 0, learning: 0, due: 0, known: 0 };
  for (const l of rep.lines) counts[statusOf(cards?.get(l.id))]++;
  const total = rep.lines.length;
  const started = total - counts.new;
  const nextNew = rep.lines.findIndex((l) => !cards?.get(l.id));
  const score = report?.adopted ? Math.round(((report.wins + report.draws / 2) / report.adopted) * 100) : null;

  return (
    <section className={`card focus-card ${rep.side}`}>
      <div className="focus-head">
        <div>
          <p className="tile-side">{rep.side === 'white' ? '♔ as White' : '♚ as Black'}</p>
          <h2><Link to={`/openings/${rep.id}`}>{rep.title}</Link></h2>
          <p className="muted small">{rep.tagline}</p>
        </div>
        <div className="row">
          {counts.due > 0 && (
            <Link to={`/drill?rep=${rep.id}`} className="btn primary small">{copy.rep.drill(counts.due)}</Link>
          )}
          {onUnfocus && (
            <button className="iconbtn star on" onClick={onUnfocus} aria-label={copy.map.removeFocus} title={copy.map.removeFocus}>★</button>
          )}
        </div>
      </div>

      <div className="meter" aria-label={copy.rep.progress(counts.known, started, total)}>
        <span className="known" style={{ width: `${(counts.known / total) * 100}%` }} />
        <span className="learning" style={{ width: `${((counts.learning + counts.due) / total) * 100}%` }} />
      </div>
      <p className="muted small focus-stats">
        <span>{copy.rep.progress(counts.known, started, total)}</span>
        <span>
          {report?.reached ? copy.rep.adoption(report.adopted, report.reached) : copy.rep.adoptionNone}
          {score !== null && ` · ${copy.rep.score(score)}`}
        </span>
      </p>

      <div className="practice">
        <Link to={nextNew >= 0 ? `/learn/${rep.id}/${nextNew}` : `/openings/${rep.id}`} className="practice-btn">
          <span className="action-icon brand" aria-hidden>♗</span>
          <span><strong>{copy.rep.learn}</strong><span className="muted small">{copy.rep.learnSub}</span></span>
        </Link>
        <Link to={`/openings/${rep.id}/map?mode=spar`} className="practice-btn">
          <span className="action-icon good" aria-hidden>⚔</span>
          <span><strong>{copy.rep.spar}</strong><span className="muted small">{copy.rep.sparSub}</span></span>
        </Link>
        <Link to={`/openings/${rep.id}/map`} className="practice-btn">
          <span className="action-icon accent" aria-hidden>⌖</span>
          <span><strong>{copy.rep.explore}</strong><span className="muted small">{copy.rep.exploreSub}</span></span>
        </Link>
      </div>
    </section>
  );
}

/** Replaying every PGN is heavy with a year of blitz; do it after the page has painted. */
export function useRepReports(games: GameRow[] | undefined) {
  const [reports, setReports] = useState<Map<string, RepReport>>(() => new Map());
  useEffect(() => {
    if (!games) return;
    let alive = true;
    const id = window.setTimeout(() => {
      const next = new Map(repertoires.map((r) => [r.id, repReport(r, games)]));
      if (alive) setReports(next);
    }, 0);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [games]);
  return reports;
}

export function Openings() {
  const cards = useCards();
  const focus = useFocus();
  const games = useGamesNewestFirst();
  const reports = useRepReports(games);
  const families = useMemo(() => (games ? openingFamilies(games) : []), [games]);
  if (!focus) return null;

  const focused = repertoires.filter((r) => focus.includes(r.id));
  const others = repertoires.filter((r) => !focus.includes(r.id));

  return (
    <>
      <h1>{copy.rep.focusTitle}</h1>
      <p className="lead">{copy.rep.focusLead}</p>
      <div className="focus-grid">
        {focused.map((r) => (
          <FocusCard key={r.id} rep={r} cards={cards} report={reports.get(r.id)} onUnfocus={() => toggleFocus(r.id, focus)} />
        ))}
      </div>

      {others.length > 0 && (
        <>
          <h2 className="section-title">{copy.rep.others}</h2>
          <p className="muted small">{copy.rep.othersLead}</p>
          <section className="grid">
            {others.map((r) => (
              <div key={r.id} className="tile-wrap">
                <RepertoireTile rep={r} cards={cards} />
                <button className="chip focus-toggle" onClick={() => toggleFocus(r.id, focus)} aria-label={`${copy.map.addFocus}: ${r.title}`}>☆ {copy.rep.focus}</button>
              </div>
            ))}
          </section>
        </>
      )}

      <h2 className="section-title">{copy.rep.families}</h2>
      <p className="muted small">{copy.rep.familiesLead}</p>
      {families.length ? (
        <div className="families">
          {(['white', 'black'] as const).map((side) => (
            <section key={side} className="card">
              <p className="eyebrow">{side === 'white' ? copy.rep.asWhite : copy.rep.asBlack}</p>
              <ul className="hbars">
                {families
                  .filter((f) => f.side === side)
                  .slice(0, 8)
                  .map((f) => (
                    <li key={f.name}>
                      <span className="hlabel" title={f.name}>{f.name}</span>
                      <span className="htrack">
                        <span className={`bar ${f.score >= 55 ? 'good' : f.score < 45 ? 'bad' : ''}`} style={{ width: `${f.score}%` }} />
                      </span>
                      <span className="hval">{f.score}% · {f.games}</span>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <p className="muted small">{copy.rep.familiesNone}</p>
      )}
    </>
  );
}
