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

  return (
    <>
      <section className="hero card">
        <p className="eyebrow">{username ? `hey ${username}` : 'hey you'}</p>
        <h1>{greeting}</h1>
        <p className="lead">{due ? copy.home.dueSome(due) : copy.home.dueNone}</p>
        <div className="row">
          {due > 0 && <Link to="/drill" className="btn primary">{copy.home.drillCta} ({due})</Link>}
          {puzzlesDue > 0 && (
            <Link to="/puzzles" className={`btn ${due ? 'ghost' : 'primary'}`}>
              {copy.home.puzzlesCta} ({puzzlesDue})
            </Link>
          )}
          <Link to="/openings" className={`btn ${due || puzzlesDue ? 'ghost' : 'primary'}`}>{copy.home.learnCta}</Link>
          <Link to="/play" className="btn ghost">{copy.home.playCta}</Link>
        </div>
      </section>

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
