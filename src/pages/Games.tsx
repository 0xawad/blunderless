import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { copy } from '../copy';
import { db, getSetting, setSetting } from '../srs/db';
import {
  ImportError,
  cancelImport,
  ensureOpenings,
  getAccounts,
  importFrom,
  monthLabel,
  needsAnalysis,
  useImportStatus,
  type GameSource,
} from '../games/store';
import { enqueue, useQueue } from '../games/queue';
import { QueueStatus } from '../components/QueueStatus';
import { AccountForm } from '../components/AccountForm';
import { Callout, EmptyState, PageHeader } from '../components/ui';
import { ArrowRightIcon, GamesIcon } from '../components/icons';
import { useToast } from '../components/Toast';
import type { BookReport, GameRow } from '../srs/types';
import '../styles/pages/games.css';

export { needsAnalysis };

const moveNo = (ply: number) => Math.floor(ply / 2) + 1;
const RESULTS = ['all', 'loss', 'win', 'draw', 'pending'] as const;
const SPEEDS = ['all', 'bullet', 'blitz', 'rapid', 'daily'] as const;
const MONTHS = [1, 3, 6, 12];
const PAGE = 60;
type ResultFilter = (typeof RESULTS)[number];

export function BookChip({ game }: { game: { book?: BookReport } }) {
  const b = game.book;
  if (!b) return null;
  const tone = b.status === 'you-deviated' ? 'due' : b.status === 'they-deviated' ? 'learning' : 'known';
  return <span className={`badge ${tone}`}>{copy.book.short[b.status](moveNo(b.ply))}</span>;
}

/** What a list row needs. The live query maps to this so the page never holds PGNs or evals. */
interface Row {
  id: string;
  source: GameRow['source'];
  opp: string;
  oppElo?: number;
  color: 'white' | 'black';
  result: GameRow['result'];
  timeClass: string;
  date: string;
  opening?: string;
  book?: BookReport;
  pending: boolean;
  reviewable: boolean;
  stale: boolean;
  accuracy?: number;
  blunders?: number;
  mistakes?: number;
}

function toRow(g: GameRow): Row {
  const white = g.userColor === 'white';
  const pending = needsAnalysis(g);
  const a = g.analysis;
  return {
    id: g.id,
    source: g.source,
    opp: white ? g.black : g.white,
    oppElo: white ? g.blackElo : g.whiteElo,
    color: g.userColor,
    result: g.result,
    timeClass: g.timeClass,
    date: g.endTime.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
    opening: g.opening?.name,
    book: g.book,
    pending,
    reviewable: pending || !!a,
    stale: pending && !!a,
    accuracy: a && !pending ? a.accuracy : undefined,
    blunders: a && !pending ? a.blunders : undefined,
    mistakes: a && !pending ? a.mistakes : undefined,
  };
}

/** Subscribes to the queue by itself, so engine progress ticks re-render one cell and not the list. */
function AnalyseCell({ id, stale }: { id: string; stale: boolean }) {
  const q = useQueue();
  if (q.current === id) return <span className="gm-queued num">{Math.round(q.progress * 100)}%</span>;
  if (q.pending.includes(id)) return <span className="gm-queued">{copy.games.queued}</span>;
  return (
    <button className="btn ghost small" onClick={() => enqueue([id])}>
      {stale ? copy.review.reanalyze : copy.games.review}
    </button>
  );
}

const GameItem = memo(function GameItem({ g }: { g: Row }) {
  return (
    <li className="gm-row">
      <Link to={`/games/${encodeURIComponent(g.id)}`} className="gm-link">
        <span className={`gm-result ${g.result}`} title={copy.games.resultWord[g.result]}>
          <span aria-hidden>{copy.games.resultWord[g.result][0]}</span>
          <span className="sr-only">{copy.games.resultWord[g.result]}</span>
        </span>
        <span className="row-main">
          <strong className="truncate">
            {copy.games.vs(g.opp)}
            {g.oppElo ? <span className="gm-elo"> {g.oppElo}</span> : null}
          </strong>
          <span className="muted truncate">{g.opening ?? copy.games.asColor[g.color]}</span>
        </span>
        <span className="gm-meta muted">
          <span className={`player-dot ${g.color}`} aria-label={copy.games.asColor[g.color]} />
          <span>{copy.games.timeFilters[g.timeClass] ?? g.timeClass}</span>
          <span className="gm-date">{g.date}</span>
        </span>
      </Link>
      <span className="gm-end">
        <BookChip game={g} />
        {g.accuracy !== undefined ? (
          <span className="gm-acc" title={copy.games.counts(g.blunders ?? 0, g.mistakes ?? 0)}>
            <strong className="num">{g.accuracy}%</strong>
            <span className="num">
              {g.blunders ? <span className="q-blunder">{g.blunders}?? </span> : null}
              {g.mistakes ? <span className="q-mistake">{g.mistakes}?</span> : null}
              {!g.blunders && !g.mistakes ? <span className="q-best">clean</span> : null}
            </span>
          </span>
        ) : g.reviewable ? (
          <AnalyseCell id={g.id} stale={g.stale} />
        ) : (
          <span className="gm-queued">{copy.games.notReviewable}</span>
        )}
      </span>
    </li>
  );
});

export function Games() {
  const toast = useToast();
  const running = useQueue().running;
  const status = useImportStatus();
  const accounts = useLiveQuery(getAccounts, []);
  const months = useLiveQuery(async () => (await getSetting<number>('importMonths')) ?? 3, []);
  const rows = useLiveQuery(async () => (await db.games.orderBy('endTime').reverse().toArray()).map(toRow), []);
  const [result, setResult] = useState<ResultFilter>('all');
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>('all');
  const [site, setSite] = useState<'all' | GameRow['source']>('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [syncing, setSyncing] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    void ensureOpenings();
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => setLimit(PAGE), [result, speed, site, query]);

  const connected = (['chesscom', 'lichess'] as GameSource[]).filter((s) => accounts?.[s]);

  const sync = async () => {
    if (!accounts || syncing) return;
    setSyncing(true);
    setProblems([]);
    let added = 0;
    let requeued = 0;
    const issues: string[] = [];
    for (const s of connected) {
      const name = copy.importer.sites[s];
      try {
        const r = await importFrom(s, accounts[s]!, { months: months ?? 3 });
        added += r.added;
        requeued += r.requeued;
        if (r.failed.length) issues.push(copy.games.partial(name, r.failed.map(monthLabel).join(', ')));
      } catch (e) {
        const kind = e instanceof ImportError ? e.kind : 'unreachable';
        issues.push((copy.games.failure[kind] ?? copy.games.failure.unreachable)(name));
      }
    }
    if (!alive.current) return;
    setSyncing(false);
    setProblems(issues);
    if (added || !issues.length) toast(copy.games.synced(added, requeued), added ? 'good' : 'neutral');
  };

  const pendingIds = useMemo(() => rows?.filter((g) => g.pending).map((g) => g.id) ?? [], [rows]);
  const speeds = useMemo(() => new Set(rows?.map((g) => g.timeClass)), [rows]);
  const sites = useMemo(() => new Set(rows?.map((g) => g.source)), [rows]);
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (rows ?? []).filter(
      (g) =>
        (speed === 'all' || g.timeClass === speed) &&
        (site === 'all' || g.source === site) &&
        (result === 'all' ? true : result === 'pending' ? g.pending : g.result === result) &&
        (!needle || g.opp.toLowerCase().includes(needle) || (g.opening ?? '').toLowerCase().includes(needle)),
    );
  }, [rows, speed, site, result, query]);
  const record = useMemo(() => {
    const r = { win: 0, loss: 0, draw: 0 };
    for (const g of shown) r[g.result]++;
    return r;
  }, [shown]);

  if (!rows || !accounts) {
    return (
      <div className="skeleton" aria-busy="true" aria-label="Loading">
        <span style={{ height: 44, width: '34%' }} />
        <span style={{ height: 52, marginTop: 16 }} />
        <span style={{ height: 52 }} />
        <span style={{ height: 52 }} />
      </div>
    );
  }

  const active = (['chesscom', 'lichess'] as GameSource[]).map((s) => status[s]).filter((p) => !!p);
  const filtered = result !== 'all' || speed !== 'all' || site !== 'all' || query.trim() !== '';

  return (
    <div className="gm">
      <PageHeader
        title={copy.games.title}
        lead={copy.games.lead}
        actions={
          connected.length > 0 && (
            <>
              <select aria-label={copy.games.monthsLabel} value={months ?? 3} onChange={(e) => setSetting('importMonths', Number(e.target.value))} disabled={syncing}>
                {MONTHS.map((m) => (
                  <option key={m} value={m}>{copy.games.months(m)}</option>
                ))}
              </select>
              {pendingIds.length > 0 && !running && (
                <button className="btn ghost" onClick={() => enqueue(pendingIds)}>{copy.games.analyzeAll(pendingIds.length)}</button>
              )}
              <button className="btn primary" onClick={sync} disabled={syncing}>
                {syncing && <span className="spinner" aria-hidden />}
                {syncing ? copy.games.syncing : copy.games.sync}
              </button>
            </>
          )
        }
      />

      <div className="gm-notices">
        {active.map((p) => (
          <Callout key={p.source} actions={<button className="btn quiet small" onClick={() => cancelImport(p.source)}>{copy.games.cancel}</button>}>
            <strong>{copy.importer.sites[p.source]}.</strong> {p.label ?? copy.games.importing}
            {p.total ? <div className="progress" style={{ marginTop: 8 }}><span style={{ width: `${Math.min(100, (p.done / p.total) * 100)}%` }} /></div> : null}
          </Callout>
        ))}
        {problems.map((m) => (
          <Callout key={m} tone="bad" role="alert" actions={<button className="btn small ghost" onClick={sync}>{copy.games.retry}</button>}>
            {m}
          </Callout>
        ))}
        <QueueStatus />
      </div>

      {connected.length === 0 && (
        <section className="panel gm-connect">
          <h2>{copy.games.connectTitle}</h2>
          <p className="muted">{copy.games.noUser}</p>
          <AccountForm />
        </section>
      )}

      {rows.length === 0 ? (
        <EmptyState icon={<GamesIcon />} title={copy.games.emptyTitle} actions={<Link to="/play" className="btn ghost">{copy.nav.play}<ArrowRightIcon /></Link>}>
          {copy.games.empty}
        </EmptyState>
      ) : (
        <>
          <div className="gm-filters">
            <div className="chips" role="group" aria-label="Result">
              {RESULTS.map((f) => (
                <button key={f} aria-pressed={result === f} className="chip" onClick={() => setResult(f)}>
                  {copy.games.filters[f]}
                  {f === 'pending' && pendingIds.length > 0 && ` ${pendingIds.length}`}
                </button>
              ))}
            </div>
            {speeds.size > 1 && (
              <div className="chips" role="group" aria-label="Speed">
                {SPEEDS.filter((s) => s === 'all' || speeds.has(s)).map((s) => (
                  <button key={s} aria-pressed={speed === s} className="chip" onClick={() => setSpeed(s)}>{copy.games.timeFilters[s]}</button>
                ))}
              </div>
            )}
            {sites.size > 1 && (
              <div className="chips" role="group" aria-label="Site">
                {(['all', 'chesscom', 'lichess', 'local'] as const).filter((s) => s === 'all' || sites.has(s)).map((s) => (
                  <button key={s} aria-pressed={site === s} className="chip" onClick={() => setSite(s)}>{copy.games.sourceFilters[s]}</button>
                ))}
              </div>
            )}
            <input type="search" className="gm-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={copy.games.search} aria-label={copy.games.search} />
          </div>
          <p className="gm-count muted small">
            {copy.games.count(shown.length, rows.length)} · {copy.games.record(record.win, record.loss, record.draw)}
          </p>

          {shown.length === 0 ? (
            <EmptyState title={copy.games.noMatch} actions={filtered && (
              <button className="btn ghost" onClick={() => { setResult('all'); setSpeed('all'); setSite('all'); setQuery(''); }}>{copy.games.clearFilters}</button>
            )} />
          ) : (
            <ul className="gm-list">
              {shown.slice(0, limit).map((g) => (
                <GameItem key={g.id} g={g} />
              ))}
            </ul>
          )}
          {shown.length > limit && (
            <button className="btn ghost block gm-more" onClick={() => setLimit((l) => l + PAGE)}>
              {copy.games.showMore(Math.min(PAGE, shown.length - limit))}
            </button>
          )}
        </>
      )}
    </div>
  );
}
