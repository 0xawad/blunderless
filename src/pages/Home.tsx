import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { copy, pick } from '../copy';
import { db, getSetting, statusOf } from '../srs/db';
import { repertoires } from '../repertoire';
import { useCards } from '../components/ui';
import { useFocus } from '../focus';
import { dayKey, streakOf } from '../streak';
import { backupDue, download, markBackedUp, snoozeBackup } from '../storage';
import { exportBackup } from '../srs/backup';
import { QueueStatus } from '../components/QueueStatus';
import { FocusCard, useGamesNewestFirst, useRepReports } from './Openings';

function BackupNudge() {
  const [due, setDue] = useState(false);
  useEffect(() => {
    backupDue().then(setDue);
  }, []);
  if (!due) return null;
  const save = async () => {
    download(await exportBackup(), `blunderless-${new Date().toISOString().slice(0, 10)}.json`);
    await markBackedUp();
    setDue(false);
  };
  return (
    <div className="feedback info nudge" role="status">
      <span>{copy.settings.backupNudge}</span>
      <span className="row">
        <button className="btn small primary" onClick={save}>{copy.settings.backupNow}</button>
        <button className="btn small ghost" onClick={() => snoozeBackup().then(() => setDue(false))}>{copy.settings.backupLater}</button>
      </span>
    </div>
  );
}

export function Home() {
  const cards = useCards();
  const focus = useFocus();
  const games = useGamesNewestFirst();
  const reports = useRepReports(games);
  const username = useLiveQuery(() => getSetting<string>('username'), []);
  const greeting = useMemo(() => pick(copy.home.greetings), []);
  const today = useLiveQuery(async () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const [puzzlesDue, reviews, attempts, lastSpar, endgameWins] = await Promise.all([
      db.puzzles.where('card.due').belowOrEqual(new Date()).count(),
      db.reviews.toArray(),
      db.attempts.toArray(),
      getSetting<string>('lastSpar'),
      getSetting<Record<string, string>>('endgameWins'),
    ]);
    const todayKey = dayKey(new Date());
    return {
      puzzlesDue,
      todayAttempts: attempts.filter((a) => a.at >= start).length,
      streak: streakOf([...reviews.map((r) => r.at), ...attempts.map((a) => a.at)]),
      sparredToday: lastSpar === todayKey,
      endgameToday: Object.values(endgameWins ?? {}).includes(todayKey),
    };
  }, []);

  // Render once the data is in, so nothing flashes "no games yet" for a frame.
  if (!focus || !today || !games || !cards || username === undefined) return null;
  const t = today;
  const due = cards ? [...cards.values()].filter((c) => statusOf(c) === 'due').length : 0;
  const started = cards?.size ?? 0;
  const lastGame = games?.[0];
  const lastUnreviewed = lastGame && !lastGame.analysis ? lastGame : null;

  // Rotate the daily spar through your focus openings.
  const focused = repertoires.filter((r) => focus.includes(r.id));
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86_400_000);
  const sparRep = focused.length ? focused[dayOfYear % focused.length] : undefined;
  const firstNew = focused.flatMap((r) => r.lines.map((l, i) => ({ r, l, i }))).find((x) => !cards?.has(x.l.id));

  const tasks = t
    ? [
        started === 0 && firstNew
          ? { to: `/learn/${firstNew.r.id}/${firstNew.i}`, label: copy.today.learnFirst(firstNew.r.title), done: false, icon: '♗', tone: 'brand' }
          : { to: '/drill', label: copy.today.drill(due), done: started > 0 && due === 0, icon: '♘', tone: 'accent' },
        sparRep && {
          to: `/openings/${sparRep.id}/map?mode=spar`,
          label: copy.today.spar(sparRep.title),
          done: t.sparredToday,
          icon: '⚔',
          tone: 'good',
        },
        {
          to: '/puzzles',
          label: copy.today.puzzles(t.puzzlesDue),
          done: t.todayAttempts >= 10 || (t.puzzlesDue === 0 && t.todayAttempts > 0),
          icon: '✦',
          tone: 'bad',
        },
        {
          to: lastUnreviewed ? `/games/${encodeURIComponent(lastUnreviewed.id)}` : '/games',
          label: lastUnreviewed ? copy.today.review : lastGame ? copy.today.reviewDone : copy.today.reviewNone,
          done: !lastUnreviewed && !!lastGame,
          icon: '♖',
          tone: 'brand',
        },
        { to: '/endgames', label: copy.today.endgame, done: t.endgameToday, icon: '♔', tone: 'good' },
      ].filter((x): x is NonNullable<typeof x> => !!x)
    : [];
  const doneCount = tasks.filter((x) => x.done).length;
  const allDone = tasks.length > 0 && doneCount === tasks.length;

  return (
    <>
      <section className="hero card">
        <p className="eyebrow">{username ? `hey ${username}` : 'hey you'}{t ? ` · ${copy.today.streak(t.streak)}` : ''}</p>
        <h1>{greeting}</h1>
        {due > 0 && <p className="lead">{copy.home.dueSome(due)}</p>}
        <span className="hero-art" aria-hidden>♛</span>
      </section>

      <BackupNudge />
      <QueueStatus />

      <section className="card today">
        <div className="page-head" style={{ marginBottom: '0.6rem' }}>
          <div>
            <h2>{copy.today.title}</h2>
            <p className="muted small" style={{ margin: 0 }}>{allDone ? copy.today.allDone : copy.today.lead}</p>
          </div>
          {tasks.length > 0 && (
            <span className="today-count" aria-label={`${doneCount} of ${tasks.length} done`}>
              {doneCount}/{tasks.length}
            </span>
          )}
        </div>
        <ul className="tasks">
          {tasks.map((x) => (
            <li key={x.to + x.label} className={x.done ? 'done' : ''}>
              <Link to={x.to}>
                <span className={`action-icon ${x.tone}`} aria-hidden>{x.done ? '✓' : x.icon}</span>
                <span>{x.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {focused.length > 0 && (
        <>
          <h2 className="section-title">{copy.rep.focusTitle}</h2>
          <div className="focus-grid">
            {focused.map((r) => (
              <FocusCard key={r.id} rep={r} cards={cards} report={reports.get(r.id)} />
            ))}
          </div>
        </>
      )}

      <div className="actions">
        <Link to="/games" className="action">
          <span className="action-icon accent" aria-hidden>♖</span>
          <span>
            <strong>Your games</strong>
            <span className="muted">
              {lastGame
                ? copy.home.lastGame(lastGame.userColor === 'white' ? lastGame.black : lastGame.white, lastGame.result)
                : copy.home.noGames}
            </span>
          </span>
        </Link>
        <Link to="/play" className="action">
          <span className="action-icon good" aria-hidden>▶</span>
          <span>
            <strong>{copy.home.playCta}</strong>
            <span className="muted">{copy.home.playSub}</span>
          </span>
        </Link>
        <Link to="/openings" className="action">
          <span className="action-icon brand" aria-hidden>♗</span>
          <span>
            <strong>{copy.home.allOpenings}</strong>
            <span className="muted">{copy.home.learnSub(started)}</span>
          </span>
        </Link>
      </div>
    </>
  );
}
