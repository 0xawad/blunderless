import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { copy, pick } from '../copy';
import { db, getSetting, statusOf } from '../srs/db';
import { repertoires } from '../repertoire';
import { RepertoireTile, useCards } from '../components/ui';

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Consecutive days (ending today or yesterday) with any training activity. */
function streakOf(dates: Date[]): number {
  const days = new Set(dates.map(dayKey));
  const d = new Date();
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(dayKey(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export function Home() {
  const cards = useCards();
  const username = useLiveQuery(() => getSetting<string>('username'), []);
  const greeting = useMemo(() => pick(copy.home.greetings), []);
  const today = useLiveQuery(async () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const [puzzlesDue, reviews, attempts, lastGame, analyzedToday] = await Promise.all([
      db.puzzles.where('card.due').belowOrEqual(new Date()).count(),
      db.reviews.toArray(),
      db.attempts.toArray(),
      db.games.orderBy('endTime').last(),
      db.games.filter((g) => !!g.analysis && g.analysis.analyzedAt >= start).count(),
    ]);
    const todayReviews = reviews.filter((r) => r.at >= start).length;
    const todayAttempts = attempts.filter((a) => a.at >= start).length;
    const streak = streakOf([...reviews.map((r) => r.at), ...attempts.map((a) => a.at)]);
    return { puzzlesDue, todayReviews, todayAttempts, lastGame, analyzedToday, streak };
  }, []);

  const due = cards ? [...cards.values()].filter((c) => statusOf(c) === 'due').length : 0;
  const started = cards?.size ?? 0;
  const t = today;
  // "Done" means there is nothing left to do today, not that you did a lot.
  const drillDone = !!t && started > 0 && due === 0;
  const puzzlesDone = !!t && (t.todayAttempts >= 10 || (t.puzzlesDue === 0 && t.todayAttempts > 0));
  const lastUnreviewed = t?.lastGame && !t.lastGame.analysis ? t.lastGame : null;

  const tasks = t
    ? [
        { to: '/drill', label: copy.today.drill(due), done: drillDone, icon: '♘', tone: 'accent' },
        { to: '/puzzles', label: copy.today.puzzles(t.puzzlesDue), done: puzzlesDone, icon: '✦', tone: 'bad' },
        {
          to: lastUnreviewed ? `/games/${encodeURIComponent(lastUnreviewed.id)}` : '/games',
          label: lastUnreviewed ? copy.today.review : t.lastGame ? copy.today.reviewDone : copy.today.reviewNone,
          done: !lastUnreviewed && !!t.lastGame,
          icon: '♖',
          tone: 'brand',
        },
        { to: '/endgames', label: copy.today.endgame, done: false, icon: '♔', tone: 'good' },
      ]
    : [];
  const allDone = tasks.length > 0 && tasks.every((x) => x.done);

  return (
    <>
      <section className="hero card">
        <p className="eyebrow">{username ? `hey ${username}` : 'hey you'}{t ? ` · ${copy.today.streak(t.streak)}` : ''}</p>
        <h1>{greeting}</h1>
        <p className="lead">{due ? copy.home.dueSome(due) : copy.home.dueNone}</p>
        <span className="hero-art" aria-hidden>♛</span>
      </section>

      <section className="card today">
        <div className="page-head" style={{ marginBottom: '0.6rem' }}>
          <div>
            <h2>{copy.today.title}</h2>
            <p className="muted small" style={{ margin: 0 }}>{allDone ? copy.today.allDone : copy.today.lead}</p>
          </div>
        </div>
        <ul className="tasks">
          {tasks.map((x) => (
            <li key={x.to} className={x.done ? 'done' : ''}>
              <Link to={x.to}>
                <span className={`action-icon ${x.tone}`} aria-hidden>{x.done ? '✓' : x.icon}</span>
                <span>{x.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <div className="actions">
        <Link to="/openings" className="action">
          <span className="action-icon brand" aria-hidden>♗</span>
          <span>
            <strong>{copy.home.learnCta}</strong>
            <span className="muted">{copy.home.learnSub(started)}</span>
          </span>
        </Link>
        <Link to="/play" className="action">
          <span className="action-icon good" aria-hidden>▶</span>
          <span>
            <strong>{copy.home.playCta}</strong>
            <span className="muted">{copy.home.playSub}</span>
          </span>
        </Link>
        <Link to="/games" className="action">
          <span className="action-icon accent" aria-hidden>♖</span>
          <span>
            <strong>Your games</strong>
            <span className="muted">
              {t?.lastGame
                ? copy.home.lastGame(t.lastGame.userColor === 'white' ? t.lastGame.black : t.lastGame.white, t.lastGame.result)
                : copy.home.noGames}
            </span>
          </span>
        </Link>
      </div>

      <section className="grid">
        {repertoires.map((r) => (
          <RepertoireTile key={r.id} rep={r} cards={cards} />
        ))}
      </section>
    </>
  );
}
