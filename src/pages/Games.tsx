import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { copy } from '../copy';
import { db, getSetting } from '../srs/db';
import { analyzeStoredGame, importChessCom } from '../games/store';
import type { GameRow } from '../srs/types';

const moveNo = (ply: number) => Math.floor(ply / 2) + 1;

export function BookChip({ game }: { game: GameRow }) {
  const b = game.book;
  if (!b) return null;
  const tone = b.status === 'you-deviated' ? 'due' : b.status === 'they-deviated' ? 'learning' : 'known';
  return <span className={`badge ${tone}`}>{copy.book.short[b.status](moveNo(b.ply))}</span>;
}

export function Games() {
  const username = useLiveQuery(() => getSetting<string>('username'), []);
  const games = useLiveQuery(() => db.games.orderBy('endTime').reverse().toArray(), []);
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState<string | null>(null);

  const doImport = async () => {
    if (!username) return;
    setBusy('import');
    setMsg(copy.games.importing);
    try {
      const { added, requeued } = await importChessCom(username);
      setMsg(copy.games.imported(added, requeued));
    } catch {
      setMsg(copy.games.importFailed);
    }
    setBusy(null);
  };

  const analyze = async (ids: string[]) => {
    let made = 0;
    for (const [i, id] of ids.entries()) {
      setBusy(id);
      made += await analyzeStoredGame(id, (p) =>
        setMsg(copy.games.analyzing(Math.round(((i + p) / ids.length) * 100))),
      );
    }
    setBusy(null);
    setMsg(copy.games.madePuzzles(made));
  };

  const pending = games?.filter((g) => !g.analysis).map((g) => g.id) ?? [];

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
      {msg && <div className="feedback info" role="status">{msg}</div>}

      {games && games.length === 0 && <p className="empty">{copy.games.empty}</p>}

      <ul className="games">
        {games?.map((g) => {
          const opp = g.userColor === 'white' ? g.black : g.white;
          const oppElo = g.userColor === 'white' ? g.blackElo : g.whiteElo;
          return (
            <li key={g.id} className="card game-row">
              <span className={`result ${g.result}`}>{g.result[0].toUpperCase()}</span>
              <Link to={`/games/${encodeURIComponent(g.id)}`} className="game-main">
                <strong>vs {opp}</strong> {oppElo ? <span className="muted">({oppElo})</span> : null}
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
