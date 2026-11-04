import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { copy } from '../copy';
import { db, getSetting } from '../srs/db';
import { analyzeStoredGame, importChessCom } from '../games/store';
import { useToast } from '../components/Toast';
import type { GameRow } from '../srs/types';

const moveNo = (ply: number) => Math.floor(ply / 2) + 1;
const FILTERS = ['all', 'loss', 'win', 'draw', 'pending'] as const;
type Filter = (typeof FILTERS)[number];

export function BookChip({ game }: { game: GameRow }) {
  const b = game.book;
  if (!b) return null;
  const tone = b.status === 'you-deviated' ? 'due' : b.status === 'they-deviated' ? 'learning' : 'known';
  return <span className={`badge ${tone}`}>{copy.book.short[b.status](moveNo(b.ply))}</span>;
}

export function Games() {
  const toast = useToast();
  const username = useLiveQuery(() => getSetting<string>('username'), []);
  const games = useLiveQuery(() => db.games.orderBy('endTime').reverse().toArray(), []);
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>();
  // Leaving the page stops a batch after the current game.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => void (alive.current = false);
  }, []);

  const doImport = async () => {
    if (!username) return;
    setBusy('import');
    setProgress(copy.games.importing);
    try {
      const { added, requeued } = await importChessCom(username);
      toast(copy.games.imported(added, requeued), added ? 'good' : 'neutral');
    } catch {
      toast(copy.games.importFailed, 'bad');
    } finally {
      setBusy(null);
      setProgress(undefined);
    }
  };

  const analyze = async (ids: string[]) => {
    let made = 0;
    try {
      for (const [i, id] of ids.entries()) {
        if (!alive.current) break;
        setBusy(id);
        made += await analyzeStoredGame(id, (p) => setProgress(copy.games.analyzing(Math.round(((i + p) / ids.length) * 100))));
      }
      if (alive.current) toast(copy.games.madePuzzles(made), made ? 'neutral' : 'good');
    } catch {
      if (alive.current) toast(copy.engine.failed, 'bad');
    } finally {
      if (alive.current) {
        setBusy(null);
        setProgress(undefined);
      }
    }
  };

  const pending = games?.filter((g) => !g.analysis).map((g) => g.id) ?? [];
  const record = useMemo(() => {
    const r = { win: 0, loss: 0, draw: 0 };
    for (const g of games ?? []) r[g.result]++;
    return r;
  }, [games]);
  const shown = (games ?? []).filter((g) => (filter === 'all' ? true : filter === 'pending' ? !g.analysis : g.result === filter));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{copy.games.title}</h1>
          <p className="lead">{copy.games.lead}</p>
        </div>
        <div className="row">
          {username ? (
            <button className="btn primary" onClick={doImport} disabled={!!busy}>{copy.games.import}</button>
          ) : (
            <Link to="/settings" className="btn primary">Settings</Link>
          )}
          {pending.length > 0 && (
            <button className="btn ghost" onClick={() => analyze(pending.slice(0, 10))} disabled={!!busy}>
              {copy.games.analyzeAll(Math.min(10, pending.length))}
            </button>
          )}
        </div>
      </div>

      {!username && <div className="feedback info">{copy.games.noUser}</div>}
      {progress && <div className="feedback info" role="status">{progress}</div>}

      {games && games.length > 0 && (
        <div className="filters" role="tablist">
          {FILTERS.map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className={`chip ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>
              {copy.games.filters[f]}
              {f === 'pending' && pending.length > 0 && ` (${pending.length})`}
            </button>
          ))}
          <span className="muted small" style={{ marginLeft: 'auto', alignSelf: 'center' }}>
            {copy.games.record(record.win, record.loss, record.draw)}
          </span>
        </div>
      )}

      {games && games.length === 0 && <p className="empty">{copy.games.empty}</p>}

      <ul className="games">
        {shown.map((g) => {
          const opp = g.userColor === 'white' ? g.black : g.white;
          const oppElo = g.userColor === 'white' ? g.blackElo : g.whiteElo;
          return (
            <li key={g.id} className="card game-row">
              <span className={`result ${g.result}`}>{g.result[0].toUpperCase()}</span>
              <Link to={`/games/${encodeURIComponent(g.id)}`} className="game-main">
                <strong>
                  vs {opp} {oppElo ? <span className="muted">({oppElo})</span> : null}
                </strong>
                <span className="muted small">
                  {g.userColor === 'white' ? '♔' : '♚'} · {g.timeClass} · {g.endTime.toLocaleDateString()}
                </span>
              </Link>
              <BookChip game={g} />
              {g.analysis ? (
                <span className="muted small">
                  {g.analysis.blunders}×?? · {g.analysis.mistakes}×? · {g.analysis.accuracy}%
                </span>
              ) : (
                <button className="btn ghost small" onClick={() => analyze([g.id])} disabled={!!busy}>
                  {busy === g.id ? '…' : copy.games.analyze}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
