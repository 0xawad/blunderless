import { useLiveQuery } from 'dexie-react-hooks';
import { copy } from '../copy';
import { db, statusOf } from '../srs/db';
import { repertoires } from '../repertoire';
import { RepertoireTile, useCards } from '../components/ui';

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** Consecutive days (ending today or yesterday) with at least one review. */
function streak(dates: Date[]): number {
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

  return (
    <>
      <h1>{copy.stats.title}</h1>
      <p className="lead">{copy.stats.lead}</p>

      <section className="tiles">
        <Tile label={copy.stats.linesKnown} value={`${known}/${total}`} />
        <Tile label={copy.stats.streak} value={copy.stats.days(streak(reviews.map((r) => r.at)))} />
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
