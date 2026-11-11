import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { copy } from '../copy';
import { repertoires, type Repertoire } from '../repertoire';
import { EmptyState, LineMeter, PageHeader, Section, lineCounts, useCards } from '../components/ui';
import { ScoreBar } from '../components/charts';
import { ArrowRightIcon, BookIcon, CompassIcon, GamesIcon, SwordsIcon } from '../components/icons';
import '../styles/pages/openings.css';
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

/**
 * Replaying every PGN is heavy with a year of blitz: do it after the page has
 * painted, keep the last result while the next one is computed, and share the
 * work between Home and Openings (one cache per games array).
 */
let reportCache: { games: GameRow[]; map: Map<string, RepReport> } | null = null;
export function useRepReports(games: GameRow[] | undefined) {
  const [reports, setReports] = useState<Map<string, RepReport>>(() => (games && reportCache?.games === games ? reportCache.map : new Map()));
  useEffect(() => {
    if (!games) return;
    if (reportCache?.games === games) {
      setReports(reportCache.map);
      return;
    }
    let alive = true;
    const id = window.setTimeout(() => {
      const map = new Map(repertoires.map((r) => [r.id, repReport(r, games)]));
      reportCache = { games, map };
      if (alive) setReports(map);
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
  const due = repertoires.reduce((n, r) => n + lineCounts(r, cards).due, 0);
  // The one thing to do next: drill what is due, else learn the next new line of a focus opening.
  const nextNew = focused.flatMap((r) => r.lines.map((l, i) => ({ r, l, i }))).find((x) => !cards?.has(x.l.id));

  const row = (r: Repertoire, isFocus: boolean) => {
    const c = lineCounts(r, cards);
    const report = reports.get(r.id);
    const score = report?.adopted ? Math.round(((report.wins + report.draws / 2) / report.adopted) * 100) : null;
    const next = r.lines.findIndex((l) => !cards?.get(l.id));
    return (
      <li key={r.id} className="op-row">
        <div className="op-main">
          <p className="kicker">
            <span className={`player-dot ${r.side}`} aria-hidden />
            {r.side === 'white' ? copy.rep.asWhite : copy.rep.asBlack}
          </p>
          <h3><Link to={`/openings/${r.id}`}>{r.title}</Link></h3>
          <p className="muted">{r.tagline}</p>
          <LineMeter known={c.known} inProgress={c.learning + c.due} total={c.total} label={copy.rep.progress(c.known, c.started, c.total)} />
          <p className="op-stats muted">
            <span>{copy.rep.progress(c.known, c.started, c.total)}</span>
            <span>
              {report?.reached ? copy.rep.adoption(report.adopted, report.reached) : copy.rep.adoptionNone}
              {score !== null && ` · ${copy.rep.score(score)}`}
            </span>
          </p>
        </div>
        <div className="op-actions">
          {c.due > 0 && <Link to={`/drill?rep=${r.id}`} className="btn primary small">{copy.rep.drill(c.due)}</Link>}
          <Link to={next >= 0 ? `/learn/${r.id}/${next}` : `/openings/${r.id}`} className="btn ghost small"><BookIcon />{copy.rep.learn}</Link>
          <Link to={`/openings/${r.id}/map?mode=spar`} className="btn ghost small"><SwordsIcon />{copy.rep.spar}</Link>
          <Link to={`/openings/${r.id}/map`} className="btn ghost small"><CompassIcon />{copy.rep.explore}</Link>
          <button className="btn quiet small" onClick={() => toggleFocus(r.id, focus)}>
            {isFocus ? copy.map.removeFocus : copy.map.addFocus}
          </button>
        </div>
      </li>
    );
  };

  return (
    <div className="op">
      <PageHeader
        title={copy.nav.openings}
        lead={copy.rep.focusLead}
        actions={
          due > 0 ? (
            <Link to="/drill" className="btn primary">{copy.rep.drill(due)}<ArrowRightIcon /></Link>
          ) : nextNew ? (
            <Link to={`/learn/${nextNew.r.id}/${nextNew.i}`} className="btn primary">{copy.rep.learnNext}<ArrowRightIcon /></Link>
          ) : null
        }
      />

      <Section title={copy.rep.focusTitle}>
        {focused.length ? <ul className="op-list">{focused.map((r) => row(r, true))}</ul> : <p className="muted">{copy.rep.othersLead}</p>}
      </Section>

      {others.length > 0 && (
        <Section title={copy.rep.others} note={copy.rep.othersLead}>
          <ul className="op-list">{others.map((r) => row(r, false))}</ul>
        </Section>
      )}

      <Section title={copy.rep.families} note={families.length ? copy.rep.familiesLead : undefined}>
        {families.length ? (
          <div className="op-families">
            {(['white', 'black'] as const).map((side) => (
              <div key={side}>
                <h4>{side === 'white' ? copy.rep.asWhite : copy.rep.asBlack}</h4>
                <ul className="op-fam">
                  {families
                    .filter((f) => f.side === side)
                    .slice(0, 8)
                    .map((f) => (
                      <li key={f.name}>
                        <span className="truncate" title={f.name}>{f.name}</span>
                        <ScoreBar value={f.score} tone={f.score >= 55 ? 'good' : f.score < 45 ? 'bad' : 'neutral'} />
                        <span className="num">{f.score}% · {f.games}</span>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={<GamesIcon />} title={copy.rep.familiesNoneTitle} actions={<Link to="/games" className="btn ghost">{copy.nav.games}<ArrowRightIcon /></Link>}>
            {copy.rep.familiesNone}
          </EmptyState>
        )}
      </Section>
    </div>
  );
}
