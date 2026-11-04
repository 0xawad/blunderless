import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { copy, pick } from '../copy';
import { db, getSetting, statusOf } from '../srs/db';
import { repertoires } from '../repertoire';
import { RepertoireTile, useCards } from '../components/ui';

export function Home() {
  const cards = useCards();
  const username = useLiveQuery(() => getSetting<string>('username'), []);
  const puzzlesDue = useLiveQuery(() => db.puzzles.where('card.due').belowOrEqual(new Date()).count(), []) ?? 0;
  const lastGame = useLiveQuery(() => db.games.orderBy('endTime').last(), []);
  const greeting = useMemo(() => pick(copy.home.greetings), []);
  const due = cards ? [...cards.values()].filter((c) => statusOf(c) === 'due').length : 0;
  const started = cards?.size ?? 0;

  return (
    <>
      <section className="hero card">
        <p className="eyebrow">{username ? `hey ${username}` : 'hey you'}</p>
        <h1>{greeting}</h1>
        <p className="lead">{due ? copy.home.dueSome(due) : copy.home.dueNone}</p>
        <span className="hero-art" aria-hidden>♛</span>
      </section>

      <div className="actions">
        <Link to="/drill" className="action">
          <span className="action-icon accent" aria-hidden>♘</span>
          <span>
            <strong>{copy.home.drillCta}</strong>
            <span className="muted">{due ? copy.home.drillSub(due) : started ? copy.home.drillClear : copy.home.drillNone}</span>
          </span>
          {due > 0 && <span className="count">{due}</span>}
        </Link>
        <Link to="/puzzles" className="action">
          <span className="action-icon bad" aria-hidden>✦</span>
          <span>
            <strong>{copy.home.puzzlesCta}</strong>
            <span className="muted">{puzzlesDue ? copy.home.puzzlesSub(puzzlesDue) : copy.home.puzzlesNone}</span>
          </span>
          {puzzlesDue > 0 && <span className="count">{puzzlesDue}</span>}
        </Link>
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
      </div>

      <section className="grid">
        {repertoires.map((r) => (
          <RepertoireTile key={r.id} rep={r} cards={cards} />
        ))}
      </section>

      <section className="card soon">
        {lastGame ? (
          <>
            {copy.home.lastGame(lastGame.userColor === 'white' ? lastGame.black : lastGame.white, lastGame.result)}{' '}
            <Link to={`/games/${encodeURIComponent(lastGame.id)}`}>Review →</Link>
          </>
        ) : (
          <>
            {copy.home.noGames} <Link to="/games">Import →</Link>
          </>
        )}
      </section>
    </>
  );
}
