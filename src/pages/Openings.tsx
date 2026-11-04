import { repertoires } from '../repertoire';
import { RepertoireTile, useCards } from '../components/ui';

export function Openings() {
  const cards = useCards();
  return (
    <>
      <h1>Your repertoire</h1>
      <p className="lead">
        Four openings, about 8 moves deep, with the plans explained. Learn a line, then drill it until your hands
        play it without asking your brain.
      </p>
      <section className="grid">
        {repertoires.map((r) => (
          <RepertoireTile key={r.id} rep={r} cards={cards} />
        ))}
      </section>
    </>
  );
}
