import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { copy } from '../copy';
import { db, getSetting, setSetting } from '../srs/db';
import { ensureOpenings, importChessCom } from '../games/store';
import { enqueue, onQueueFinish, useQueue } from '../games/queue';
import { QueueStatus } from '../components/QueueStatus';
import { ANALYSIS_VERSION } from '../games/analyze';
import { useToast } from '../components/Toast';
import type { GameRow } from '../srs/types';

const moveNo = (ply: number) => Math.floor(ply / 2) + 1;
const FILTERS = ['all', 'loss', 'win', 'draw', 'pending'] as const;
const SPEEDS = ['all', 'bullet', 'blitz', 'rapid', 'daily'] as const;
const MONTHS = [1, 3, 6, 12];
type Filter = (typeof FILTERS)[number];

export const needsAnalysis = (g: GameRow) => !g.analysis || (g.analysis.version ?? 1) < ANALYSIS_VERSION;

export function BookChip({ game }: { game: GameRow }) {
  const b = game.book;
  if (!b) return null;
  const tone = b.status === 'you-deviated' ? 'due' : b.status === 'they-deviated' ? 'learning' : 'known';
  return <span className={`badge ${tone}`}>{copy.book.short[b.status](moveNo(b.ply))}</span>;
}

export function Games() {
  const toast = useToast();
  const q = useQueue();
  const username = useLiveQuery(() => getSetting<string>('username'), []);
  const months = useLiveQuery(async () => (await getSetting<number>('importMonths')) ?? 3, []);
  const games = useLiveQuery(() => db.games.orderBy('endTime').reverse().toArray(), []);
  const [filter, setFilter] = useState<Filter>('all');
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>('all');
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    void ensureOpenings();
    onQueueFinish((s) => {
      if (s.failed) toast(copy.engine.failed, 'bad');
      else if (s.done) toast(copy.games.madePuzzles(s.puzzles), s.puzzles ? 'neutral' : 'good');
    });
  }, [toast]);

  const doImport = async () => {
    if (!username) return;
    setImporting(true);
    try {
      const { added, requeued } = await importChessCom(username, months ?? 3);
      toast(copy.games.imported(added, requeued), added ? 'good' : 'neutral');
    } catch {
      toast(copy.games.importFailed, 'bad');
    } finally {
      setImporting(false);
    }
  };

  const pending = useMemo(() => games?.filter(needsAnalysis).map((g) => g.id) ?? [], [games]);
  const speeds = useMemo(() => new Set(games?.map((g) => g.timeClass)), [games]);
  const inSpeed = (games ?? []).filter((g) => speed === 'all' || g.timeClass === speed);
  const record = { win: 0, loss: 0, draw: 0 };
  for (const g of inSpeed) record[g.result]++;
  const shown = inSpeed.filter((g) => (filter === 'all' ? true : filter === 'pending' ? needsAnalysis(g) : g.result === filter));
  const queued = new Set([q.current, ...q.pending]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{copy.games.title}</h1>
          <p className="lead">{copy.games.lead}</p>
        </div>
        <div className="row">
          {username ? (
            <>
              <select
                aria-label={copy.games.monthsLabel}
                value={months ?? 3}
                onChange={(e) => setSetting('importMonths', Number(e.target.value))}
                disabled={importing}
              >
                {MONTHS.map((m) => (
                  <option key={m} value={m}>{copy.games.months(m)}</option>
                ))}
              </select>
              <button className="btn primary" onClick={doImport} disabled={importing}>
                {importing ? copy.games.importing : games?.length ? copy.games.importNew : copy.games.import}
              </button>
            </>
          ) : (
            <Link to="/settings" className="btn primary">Add your username</Link>
          )}
          {pending.length > 0 && !q.running && (
            <button className="btn ghost" onClick={() => enqueue(pending)}>
              {copy.games.analyzeAll(pending.length)}
            </button>
          )}
        </div>
      </div>

      {!username && <div className="feedback info">{copy.games.noUser}</div>}
      <QueueStatus />

      {games && games.length > 0 && (
        <div className="filter-bar">
          <div className="filters" role="group" aria-label="Result">
            {FILTERS.map((f) => (
              <button key={f} aria-pressed={filter === f} className={`chip ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>
                {copy.games.filters[f]}
                {f === 'pending' && pending.length > 0 && ` (${pending.length})`}
              </button>
            ))}
          </div>
          {speeds.size > 1 && (
            <div className="filters" role="group" aria-label="Speed">
              {SPEEDS.filter((s) => s === 'all' || speeds.has(s)).map((s) => (
                <button key={s} aria-pressed={speed === s} className={`chip ${speed === s ? 'on' : ''}`} onClick={() => setSpeed(s)}>
                  {copy.games.timeFilters[s]}
                </button>
              ))}
            </div>
          )}
          <span className="muted small filters-end">{copy.games.record(record.win, record.loss, record.draw)}</span>
        </div>
      )}

      {games && games.length === 0 && <p className="empty">{copy.games.empty}</p>}

      <ul className="games">
        {shown.map((g, i) => {
          const opp = g.userColor === 'white' ? g.black : g.white;
          const oppElo = g.userColor === 'white' ? g.blackElo : g.whiteElo;
          const myElo = g.userColor === 'white' ? g.whiteElo : g.blackElo;
          const a = g.analysis;
          return (
            <li key={g.id} className="card game-row" style={{ '--i': i } as CSSProperties}>
              <span className={`result ${g.result}`} aria-label={g.result}>{g.result[0].toUpperCase()}</span>
              <Link to={`/games/${encodeURIComponent(g.id)}`} className="game-main">
                <strong>
                  vs {opp} {oppElo ? <span className="muted">({oppElo})</span> : null}
                </strong>
                <span className="muted small game-sub">
                  {g.userColor === 'white' ? '♔' : '♚'} {g.opening?.name ?? (g.userColor === 'white' ? 'as White' : 'as Black')}
                </span>
                <span className="muted small">
                  {g.timeClass}{myElo ? ` · you ${myElo}` : ''} · {g.endTime.toLocaleDateString()}
                </span>
              </Link>
              <div className="game-meta">
                <BookChip game={g} />
                {a && !needsAnalysis(g) ? (
                  <span className="game-acc" title={`${a.blunders} blunders, ${a.mistakes} mistakes`}>
                    <strong>{a.accuracy}%</strong>
                    <span className="small">
                      {a.blunders ? <span className="bad-text">{a.blunders}?? </span> : null}
                      {a.mistakes ? <span className="warn-text">{a.mistakes}?</span> : null}
                    </span>
                  </span>
                ) : queued.has(g.id) ? (
                  <span className="muted small">{q.current === g.id ? `${Math.round(q.progress * 100)}%` : copy.games.queued}</span>
                ) : (
                  <button className="btn ghost small" onClick={() => enqueue([g.id])}>
                    {a ? copy.review.reanalyze : copy.games.analyze}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
