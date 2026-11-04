import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { copy, pick } from '../copy';
import { getSetting, statusOf } from '../srs/db';
import { repertoires } from '../repertoire';
import { RepertoireTile, useCards } from '../components/ui';

export function Home() {
  const cards = useCards();
  const username = useLiveQuery(() => getSetting<string>('username'), []);
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
          <Link to="/openings" className={`btn ${due ? 'ghost' : 'primary'}`}>{copy.home.learnCta}</Link>
        </div>
      </section>

      <section className="grid">
        {repertoires.map((r) => (
          <RepertoireTile key={r.id} rep={r} cards={cards} />
        ))}
      </section>

      <section className="card soon">
        <span className="badge learning">Soon</span> {copy.home.gamesSoon}
      </section>
    </>
  );
}
