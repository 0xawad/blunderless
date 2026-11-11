// Progress: are your real games getting better, and at what. Everything comes from the coach.
import { Link, useNavigate } from 'react-router-dom';
import { copy } from '../copy';
import { Callout, EmptyState, PageHeader, Section, Stat } from '../components/ui';
import { ScoreBar, TrendChart, type TrendDatum } from '../components/charts';
import { TrendIcon } from '../components/icons';
import { exampleUrl, puzzlesUrl, useCoach, type BreakdownRow, type Signal, type TrendDelta } from '../coach';
import '../styles/pages/progress.css';

const STATUS_BADGE: Record<Signal['status'], string> = { weak: 'bad', ok: '', strong: 'good', insufficient: '' };

function deltaOf(d: TrendDelta | undefined, unit: string) {
  if (!d || d.trend === 'flat') return undefined;
  const sign = d.delta > 0 ? '+' : '';
  const n = Math.abs(d.delta) >= 10 || unit === '%' ? Math.round(d.delta) : d.delta.toFixed(1);
  return { text: `${sign}${n}${unit} · ${d.trendLabel}`, dir: d.trend === 'better' ? ('up' as const) : ('down' as const) };
}

function Breakdown({ caption, rows, withSide }: { caption: string; rows: BreakdownRow[]; withSide?: boolean }) {
  if (!rows.length) return null;
  return (
    <table className="pg-table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col"><span className="sr-only">{caption}</span></th>
          <th scope="col">{copy.progress.colGames}</th>
          <th scope="col">{copy.progress.colScore}</th>
          <th scope="col" className="bar"><span className="sr-only">{copy.progress.colScore}</span></th>
          <th scope="col">{copy.progress.colAccuracy}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td>
              {r.label}
              {withSide && r.side && <span className="side">{copy.coach.trends.colours[r.side]}</span>}
            </td>
            <td>{r.games}</td>
            <td>{Math.round(r.score)}%</td>
            <td className="bar"><ScoreBar value={r.score} tone={r.score >= 55 ? 'good' : r.score < 45 ? 'bad' : 'neutral'} /></td>
            <td>{r.accuracy === null ? '–' : `${Math.round(r.accuracy)}%`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Stats() {
  const { loading, profile, trends, motifs, counts, streak } = useCoach();
  const navigate = useNavigate();

  if (loading || !profile || !trends || !motifs) {
    return (
      <div className="skeleton" aria-busy="true" aria-label="Loading">
        <span style={{ height: 44, width: '32%' }} />
        <span style={{ height: 70, marginTop: 12 }} />
        <span style={{ height: 220 }} />
      </div>
    );
  }

  const delta = (m: TrendDelta['metric']) => trends.deltas?.items.find((d) => d.metric === m);
  const series = trends.series.slice(-40);
  const data: TrendDatum[] = series.map((p) => ({
    bar: p.blunders,
    line: p.accuracyAvg,
    tone: p.result === 'win' ? 'good' : p.result === 'loss' ? 'bad' : 'neutral',
    tip: copy.progress.trendTip(Math.round(p.accuracy), p.blunders, copy.progress.result[p.result]),
    href: `/games/${encodeURIComponent(p.gameId)}`,
  }));
  const lo = series.length ? Math.max(0, Math.floor((Math.min(...series.map((p) => p.accuracyAvg)) - 8) / 10) * 10) : 40;
  const practised = motifs.themes.filter((t) => t.attempts > 0).length > 0;

  return (
    <div className="pg">
      <PageHeader title={copy.progress.title} lead={copy.progress.lead} />

      {counts.toAnalyse > 0 && (
        <div style={{ marginBottom: 'var(--s-5)' }}>
          <Callout actions={<Link to="/games" className="btn small ghost">{copy.progress.reviewCta}</Link>}>
            {copy.progress.needReview(counts.toAnalyse)} {profile.staleText}
          </Callout>
        </div>
      )}

      <div className="stats-row">
        <Stat value={counts.analysed} label={copy.progress.games} />
        <Stat value={trends.summary ? Math.round(trends.summary.accuracy) : '–'} unit={trends.summary ? '%' : undefined} label={copy.progress.accuracy} delta={deltaOf(delta('accuracy'), '%')} />
        <Stat value={trends.summary ? trends.summary.blunders.toFixed(1) : '–'} label={copy.progress.blunders} delta={deltaOf(delta('blunders'), '')} />
        <Stat value={motifs.overall.solvedPct === null ? '–' : Math.round(motifs.overall.solvedPct)} unit={motifs.overall.solvedPct === null ? undefined : '%'} label={copy.progress.puzzles} />
        <Stat value={counts.linesKnown} unit={` ${copy.progress.of(counts.linesTotal)}`} label={copy.progress.lines} />
        <Stat value={streak} label={copy.progress.streak} />
      </div>

      {series.length === 0 ? (
        <EmptyState icon={<TrendIcon />} title={copy.progress.emptyTitle} actions={<Link to="/games" className="btn primary">{copy.progress.emptyCta}</Link>}>
          {copy.progress.empty}
        </EmptyState>
      ) : (
        <>
          <Section title={copy.progress.trendTitle} note={trends.deltasText}>
            <div className="chart-legend">
              <span><i />{copy.progress.trendAccuracy}</span>
              <span><i className="bar" />{copy.progress.trendBlunders}</span>
            </div>
            <TrendChart
              data={data}
              lo={lo}
              hi={100}
              alt={copy.progress.trendAlt(series.length, Math.round(series[0].accuracyAvg), Math.round(series[series.length - 1].accuracyAvg))}
              onOpen={(href) => navigate(href)}
            />
          </Section>

          <div className="pg-two">
            <Section title={copy.progress.profileTitle} note={profile.basisText}>
              <ul className="pg-signals">
                {profile.signals.map((s) => (
                  <li key={s.id} className={s.status}>
                    <div className="pg-sig-title">
                      <strong>{s.title}</strong>
                      <span className={`badge ${STATUS_BADGE[s.status]}`}>{copy.coach.status[s.status]}</span>
                    </div>
                    <span className="pg-sig-value">{s.status === 'insufficient' ? '' : s.valueText}</span>
                    <p>{s.evidence}</p>
                    {s.baselineText && s.status !== 'insufficient' && <p className="pg-base">{s.baselineText}</p>}
                    {s.status === 'weak' && (
                      <div className="cluster">
                        <Link to={s.action.to} className="btn small ghost">{s.action.label}</Link>
                        {s.examples[0] && <Link to={exampleUrl(s.examples[0])} className="linklike small">{copy.progress.example}</Link>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Section>

            <div>
              <Section title={copy.progress.resultsTitle}>
                <Breakdown caption={copy.progress.byColour} rows={trends.byColour} />
                <Breakdown caption={copy.progress.byTime} rows={trends.byTimeClass} />
                <Breakdown caption={copy.progress.byOpening} rows={trends.byOpening.slice(0, 8)} withSide />
              </Section>
            </div>
          </div>
        </>
      )}

      <Section title={copy.progress.motifsTitle} note={practised ? copy.progress.motifsNote : undefined}>
        <div className="pg-rec">
          <Callout tone="brand" actions={<Link to={motifs.recommended.to} className="btn small primary">{copy.progress.practise}</Link>}>
            <strong>{copy.progress.recommended}: {motifs.recommended.label}.</strong> {motifs.recommended.reason}
          </Callout>
        </div>
        <ul className="pg-motifs">
          {motifs.themes.map((t) => (
            <li key={t.theme}>
              <Link to={puzzlesUrl(t.theme)}>{t.label}</Link>
              <ScoreBar value={t.recentPct ?? 0} tone={t.recentPct === null ? 'neutral' : t.recentPct >= 75 ? 'good' : t.recentPct < 50 ? 'bad' : 'neutral'} />
              {t.recentPct === null ? <span className="val none">{copy.progress.untried}</span> : <span className="val">{Math.round(t.recentPct)}%</span>}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
