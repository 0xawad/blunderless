import { useLiveQuery } from 'dexie-react-hooks';
import { copy } from '../copy';
import { db, statusOf } from '../srs/db';
import { repertoires } from '../repertoire';
import { RepertoireTile, useCards } from '../components/ui';

import { streakOf } from '../streak';

export function Stats() {
  const cards = useCards();
  const data = useLiveQuery(async () => {
    const [reviews, attempts, games] = await Promise.all([
      db.reviews.toArray(),
      db.attempts.toArray(),
      db.games.orderBy('endTime').toArray(),
    ]);
    return { reviews, attempts, analyzed: games.filter((g) => g.analysis).slice(-20) };
  }, []);
  if (!data || !cards) return null;

  const { reviews, attempts, analyzed } = data;
  const total = repertoires.reduce((n, r) => n + r.lines.length, 0);
  const known = [...cards.values()].filter((c) => statusOf(c) === 'known').length;
  const solved = attempts.filter((a) => a.solved).length;
  const avgBlunders = analyzed.length
    ? (analyzed.reduce((n, g) => n + g.analysis!.blunders, 0) / analyzed.length).toFixed(1)
    : '–';
  const avgAcc = analyzed.length
    ? `${Math.round(analyzed.reduce((n, g) => n + g.analysis!.accuracy, 0) / analyzed.length)}%`
    : '–';

  const kinds = new Map<string, number>();
  for (const g of analyzed) for (const m of g.analysis!.moves) if (m.kind) kinds.set(m.kind, (kinds.get(m.kind) ?? 0) + 1);
  const kindRows = [...kinds.entries()].sort((a, b) => b[1] - a[1]);
  const maxKind = kindRows[0]?.[1] ?? 1;
  const maxBlunders = Math.max(1, ...analyzed.map((g) => g.analysis!.blunders));

  // Clock: how many of your errors came in time trouble vs. in a rush with time left.
  const timed = analyzed.filter((g) => g.analysis!.time);
  const errors = timed.reduce((n, g) => n + g.analysis!.blunders + g.analysis!.mistakes, 0);
  const lowTime = timed.reduce((n, g) => n + g.analysis!.time!.lowTimeErrors, 0);
  const hasty = timed.reduce((n, g) => n + g.analysis!.time!.hastyErrors, 0);
  const endedLow = timed.filter((g) => g.analysis!.time!.endedLow).length;

  // Accuracy by phase, averaged over games that had that phase.
  const phase = (ph: 'opening' | 'middlegame' | 'endgame') => {
    const xs = analyzed.map((g) => g.analysis!.phases?.[ph]).filter((p) => p && p.moves > 0).map((p) => p!.accuracy);
    return xs.length ? `${Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)}%` : '–';
  };

  return (
    <>
      <h1>{copy.stats.title}</h1>
      <p className="lead">{copy.stats.lead}</p>

      <section className="tiles">
        <Tile label={copy.stats.linesKnown} value={`${known}/${total}`} />
        <Tile label={copy.stats.streak} value={copy.stats.days(streakOf([...reviews.map((r) => r.at), ...attempts.map((a) => a.at)]))} />
        <Tile
          label={copy.stats.puzzleRate}
          value={attempts.length ? `${Math.round((solved / attempts.length) * 100)}%` : '–'}
          sub={attempts.length ? `${solved}/${attempts.length}` : undefined}
        />
        <Tile label={copy.stats.blundersPerGame} value={avgBlunders} sub={analyzed.length ? `last ${analyzed.length}` : undefined} />
        <Tile label={copy.stats.accuracy} value={avgAcc} />
      </section>

      {analyzed.length === 0 ? (
        <p className="empty">{copy.stats.none}</p>
      ) : (
        <>
          {kindRows[0] && <div className="feedback info">{copy.stats.verdict(copy.kinds[kindRows[0][0]].label.toLowerCase())}</div>}

          <section className="card">
            <h2>{copy.stats.blunderChart}</h2>
            <div className="colchart" role="img" aria-label={`Blunders per game, oldest to newest: ${analyzed.map((g) => g.analysis!.blunders).join(', ')}`}>
              {analyzed.map((g) => {
                const n = g.analysis!.blunders;
                const opp = g.userColor === 'white' ? g.black : g.white;
                return (
                  <div key={g.id} className="col" tabIndex={0}>
                    <span className="bar" style={{ height: `${Math.max(2, (n / maxBlunders) * 100)}%` }} />
                    <span className="tip">
                      {n} blunder{n === 1 ? '' : 's'} · vs {opp} · {g.endTime.toLocaleDateString()}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="axis muted small">
              <span>older</span>
              <span>newer</span>
            </div>
          </section>

          <section className="tiles">
            <Tile label={copy.review.phases.opening} value={phase('opening')} sub={copy.stats.phaseAcc} />
            <Tile label={copy.review.phases.middlegame} value={phase('middlegame')} sub={copy.stats.phaseAcc} />
            <Tile label={copy.review.phases.endgame} value={phase('endgame')} sub={copy.stats.phaseAcc} />
          </section>

          {timed.length > 0 && (
            <section className="card">
              <h2>{copy.stats.clockTitle}</h2>
              <ul className="lessons">
                <li>{copy.stats.clockLow(lowTime, errors)}</li>
                <li>{copy.stats.clockHasty(hasty)}</li>
                <li>{copy.stats.clockEndedLow(endedLow, timed.length)}</li>
              </ul>
              {errors > 0 && (lowTime + hasty) / errors >= 0.4 && <div className="feedback info">{copy.stats.clockVerdict}</div>}
            </section>
          )}

          <section className="card">
            <h2>{copy.stats.kindsChart}</h2>
            <ul className="hbars">
              {kindRows.map(([k, n]) => (
                <li key={k}>
                  <span className="hlabel">{copy.kinds[k].label}</span>
                  <span className="htrack">
                    <span className="bar" style={{ width: `${(n / maxKind) * 100}%` }} />
                  </span>
                  <span className="hval">{n}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <h2>{copy.stats.mastery}</h2>
      <section className="grid">
        {repertoires.map((r) => (
          <RepertoireTile key={r.id} rep={r} cards={cards} />
        ))}
      </section>
    </>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card tile-stat">
      <span className="muted small">{label}</span>
      <strong>{value}</strong>
      {sub && <span className="muted small">{sub}</span>}
    </div>
  );
}
