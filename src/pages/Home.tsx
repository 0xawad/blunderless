// Today: an ordered plan built by the coach, not a dashboard.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { copy } from '../copy';
import { getSetting } from '../srs/db';
import { repertoires } from '../repertoire';
import { Callout, EmptyState, LineMeter, Section, lineCounts, useCards } from '../components/ui';
import { ArrowRightIcon, BookIcon, CheckIcon, CrownIcon, FlameIcon, GamesIcon, PlayIcon, PuzzleIcon, SwordsIcon, TargetIcon } from '../components/icons';
import { useFocus } from '../focus';
import { backupDue, download, markBackedUp, snoozeBackup } from '../storage';
import { exportBackup } from '../srs/backup';
import { QueueStatus } from '../components/QueueStatus';
import { useSavedGame } from '../play/saved';
import { exampleUrl, useCoach, type PlanKind } from '../coach';
import '../styles/pages/home.css';

const STEP_ICON: Record<PlanKind, ReactNode> = {
  drill: <BookIcon />,
  learn: <BookIcon />,
  spar: <SwordsIcon />,
  mistakes: <TargetIcon />,
  puzzles: <PuzzleIcon />,
  review: <GamesIcon />,
  endgame: <CrownIcon />,
  import: <GamesIcon />,
  play: <PlayIcon />,
};

function BackupNudge() {
  const [due, setDue] = useState(false);
  useEffect(() => {
    let alive = true;
    backupDue().then((d) => alive && setDue(d));
    return () => {
      alive = false;
    };
  }, []);
  if (!due) return null;
  const save = async () => {
    download(await exportBackup(), `blunderless-${new Date().toISOString().slice(0, 10)}.json`);
    await markBackedUp();
    setDue(false);
  };
  return (
    <Callout
      actions={
        <>
          <button className="btn small primary" onClick={save}>{copy.settings.backupNow}</button>
          <button className="btn small quiet" onClick={() => snoozeBackup().then(() => setDue(false))}>{copy.settings.backupLater}</button>
        </>
      }
    >
      {copy.settings.backupNudge}
    </Callout>
  );
}

function PlanSkeleton() {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading">
      <span style={{ height: 44, width: '46%' }} />
      <span style={{ height: 18, width: '70%' }} />
      <span style={{ height: 64, marginTop: 16 }} />
      <span style={{ height: 64 }} />
      <span style={{ height: 64 }} />
    </div>
  );
}

export function Home() {
  const coach = useCoach();
  const cards = useCards();
  const focus = useFocus();
  // null = loaded and not set; undefined = still loading.
  const username = useLiveQuery(async () => (await getSetting<string>('username')) ?? (await getSetting<string>('lichessUsername')) ?? null, []);
  const savedGame = useSavedGame();

  const plan = coach.plan;
  if (coach.loading || !plan || !focus || username === undefined) return <PlanSkeleton />;

  const { profile, counts, streak } = coach;
  const total = plan.steps.length;
  const next = plan.next;
  const started = plan.doneCount > 0;
  const focused = repertoires.filter((r) => focus.includes(r.id));
  const weak = profile?.top ?? [];
  const enoughGames = (profile?.sample.window ?? 0) >= 8;

  return (
    <div className="td">
      <header className="td-head">
        <p className="kicker">
          {copy.today.hello(username)}
          <span className="td-streak">
            <FlameIcon />
            {copy.today.streak(streak)}
          </span>
        </p>
        <h1>{copy.today.title}</h1>
        <p className="lead">{plan.headline}</p>
      </header>

      <div className="td-notices">
        <QueueStatus />
        {savedGame && (
          <Callout tone="brand" actions={<Link to="/play" className="btn small primary">{copy.today.resume}</Link>}>
            <strong>{copy.play.resumeHome}.</strong>{' '}
            {copy.play.resumeSub(savedGame.moves.length, copy.play.levels[savedGame.setup.level] ?? '', savedGame.color)}
          </Callout>
        )}
        <BackupNudge />
      </div>

      <section className="td-plan" aria-label={copy.today.planLabel}>
        <div className="td-plan-bar">
          <div className="td-plan-meta">
            <strong>{copy.today.progress(plan.doneCount, total)}</strong>
            <span className="muted">{copy.today.minutesLeft(plan.minutes)}</span>
          </div>
          {next ? (
            <Link to={next.to} className="btn primary lg">
              {started ? copy.today.continue : copy.today.start}
              <ArrowRightIcon />
            </Link>
          ) : plan.bonus ? (
            <Link to={plan.bonus.to} className="btn ghost">
              {plan.bonus.title}
              <ArrowRightIcon />
            </Link>
          ) : null}
        </div>
        <div className="progress" role="img" aria-label={copy.today.progress(plan.doneCount, total)}>
          <span style={{ width: `${total ? (plan.doneCount / total) * 100 : 0}%` }} />
        </div>

        <ol className="td-steps stagger">
          {plan.steps.map((s, i) => {
            const current = next?.id === s.id;
            return (
              <li key={s.id} className={`${s.done ? 'done' : ''}${current ? ' current' : ''}`} style={{ '--i': i } as CSSProperties}>
                <Link to={s.to} className="td-step" aria-current={current ? 'step' : undefined}>
                  <span className="td-num" aria-hidden>{s.done ? <CheckIcon /> : i + 1}</span>
                  <span className="td-step-main">
                    <strong>{s.title}</strong>
                    <span className="td-reason">{s.reason}</span>
                  </span>
                  <span className="td-step-end">
                    <span className="td-kind" aria-hidden>{STEP_ICON[s.kind]}</span>
                    <span className="td-min">{s.done ? copy.today.doneLabel : copy.today.minutes(s.minutes)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="td-below">
        <Section
          title={copy.today.saysTitle}
          note={enoughGames ? profile?.basisText : undefined}
          action={enoughGames ? <Link to="/stats">{copy.today.allSignals}</Link> : undefined}
        >
          {!enoughGames ? (
            <EmptyState
              icon={<GamesIcon />}
              title={copy.today.saysEmptyTitle}
              actions={<Link to="/games" className="btn ghost">{copy.today.saysCta}</Link>}
            >
              {counts.toAnalyse > 0 && counts.games > 0 ? copy.today.saysEmptyNeedAnalysis(counts.toAnalyse) : copy.today.saysEmptyNoGames}
            </EmptyState>
          ) : weak.length === 0 ? (
            <p className="muted">{copy.today.saysClean}</p>
          ) : (
            <ul className="td-says">
              {weak.map((w) => (
                <li key={w.id}>
                  <div className="td-say-head">
                    <span className="dot blunder" aria-hidden />
                    <strong>{w.title}</strong>
                    <span className="td-say-value num">{w.valueText}</span>
                  </div>
                  <p>{w.evidence}</p>
                  <div className="cluster">
                    <Link to={w.action.to} className="btn small ghost">{w.action.label}</Link>
                    {w.examples[0] && <Link to={exampleUrl(w.examples[0])} className="linklike small">{copy.today.example}</Link>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {focused.length > 0 && (
          <Section title={copy.today.focusTitle} action={<Link to="/openings">{copy.today.focusAll}</Link>}>
            <ul className="rows">
              {focused.map((r) => {
                const c = lineCounts(r, cards);
                return (
                  <li key={r.id}>
                    <Link to={`/openings/${r.id}`} className="row-link td-open">
                      <span className="row-main">
                        <strong>{r.title}</strong>
                        <span className="muted">{r.side === 'white' ? copy.rep.asWhite : copy.rep.asBlack} · {copy.today.focusProgress(c.known, c.total)}</span>
                        <LineMeter known={c.known} inProgress={c.learning + c.due} total={c.total} label={copy.today.focusProgress(c.known, c.total)} />
                      </span>
                      <span className="row-end">
                        {c.due > 0 && <span className="badge due">{copy.today.focusDue(c.due)}</span>}
                        <ArrowRightIcon className="chev" />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}
