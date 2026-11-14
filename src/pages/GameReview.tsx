import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { San } from '../components/San';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Chess } from 'chess.js';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import { copy, pick } from '../copy';
import { Board } from '../chess/Board';
import { parseGamePgn, playUci, uciToSan, type GamePly } from '../chess/game';
import { START_FEN, formatPly, getLine, getRepertoire } from '../repertoire';
import { db } from '../srs/db';
import type { GameAnalysis, MoveReview } from '../srs/types';
import { enqueue, useQueue } from '../games/queue';
import { fmtClock } from '../games/clock';
import { ANALYSIS_VERSION } from '../games/analyze';
import { explainMove, mateFor, playLine } from '../games/explain';
import { gameStory, type GameStory } from '../games/story';
import '../styles/pages/review.css';
import { getEngine, scoreToCp, winPct, type PvLine } from '../engine/engine';
import { EvalGraph } from '../components/EvalGraph';
import { BookChip } from './Games';
import { useToast } from '../components/Toast';
import { PlayerBar } from '../components/PlayerBar';
import { EvalBar, SquareBadge } from '../components/Stage';
import { BackLink, EmptyState } from '../components/ui';
import { GamesIcon } from '../components/icons';

// In chess notation "!" means a strong move, not "the engine agrees", so best moves carry colour and no mark.
const MARK: Record<string, string> = { blunder: '??', 'missed-win': '??', mistake: '?', inaccuracy: '?!', best: '', book: '' };
const MERIT_MARK: Record<string, string> = { great: '!', brilliant: '!!' };
type Tab = 'summary' | 'moves' | 'engine';
type Retry = { result?: 'best' | 'good' | 'bad'; text?: string; pv?: string[] } | null;

const moveNo = (ply: number) => Math.floor(ply / 2) + 1;
const fmtCp = (cp: number) => {
  if (Math.abs(cp) >= 9000) return cp > 0 ? '+M' : '-M';
  const v = Math.round(cp / 10) / 10; // one decimal, and -0.04 becomes 0 rather than -0.0
  return `${v > 0 ? '+' : ''}${(v || 0).toFixed(1)}`;
};

export function GameReview() {
  const { id = '' } = useParams();
  // undefined = still loading; null = no such game.
  const game = useLiveQuery(async () => (await db.games.get(id)) ?? null, [id]);
  const [params] = useSearchParams();
  const toast = useToast();
  const plies = useMemo(() => {
    try {
      return game ? parseGamePgn(game.pgn) : [];
    } catch {
      return null; // chess.js rejected the PGN; show the game header, not a white screen
    }
  }, [game?.pgn]);

  const [ply, setPly] = useState(0);
  const [variation, setVariation] = useState<GamePly[]>([]);
  const [tab, setTab] = useState<Tab>('summary');
  const [retry, setRetry] = useState<Retry>(null);
  const [lines, setLines] = useState<PvLine[]>([]);
  const [showBest, setShowBest] = useState(false);
  // In a retry: point at the piece that should move, without giving the move away.
  const [hintOn, setHintOn] = useState(false);
  const [flipped, setFlipped] = useState(false);
  // Your retry move stays on the board while the engine judges it (and after).
  const [retryMove, setRetryMove] = useState<{ fen: string; from: string; to: string } | null>(null);
  const q = useQueue();
  // Bumped whenever the position or the retry changes, so a late engine verdict for an old attempt is dropped.
  const retrySeq = useRef(0);
  const [engineDown, setEngineDown] = useState(false);

  // Deep link: /games/<id>?ply=N opens on that position with the move list showing.
  const linked = useRef(false);
  useEffect(() => {
    // Wait for the game itself: before it loads `plies` is an empty list and every ply would clamp to 0.
    if (linked.current || !game || !plies) return;
    linked.current = true;
    const n = Number(params.get('ply'));
    if (params.has('ply') && Number.isFinite(n)) {
      setPly(Math.max(0, Math.min(plies.length, Math.floor(n))));
      setTab('moves');
    }
  }, [game, plies, params]);
  const progress = q.current === id ? q.progress : q.pending.includes(id) ? 0 : null;

  const go = useCallback((p: number) => {
    retrySeq.current++;
    setVariation([]);
    setRetry(null);
    setRetryMove(null);
    setShowBest(false);
    setHintOn(false);
    setPly(p);
  }, []);

  useEffect(() => {
    const n = plies?.length ?? 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, select, textarea')) return;
      if (e.key === 'f') setFlipped((x) => !x);
      if (retry) return; // stepping away mid-retry would land the verdict on another move
      if (e.key === 'ArrowRight' && !variation.length) go(Math.min(n, ply + 1));
      if (e.key === 'ArrowLeft') variation.length ? setVariation((v) => v.slice(0, -1)) : go(Math.max(0, ply - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [plies?.length, ply, variation.length, go, retry]);

  const a = game?.analysis;
  const mine = game?.userColor === 'white' ? 'w' : 'b';
  const last = plies?.[ply - 1];
  const mainFen = last?.fenAfter ?? plies?.[0]?.fenBefore ?? START_FEN;
  const varLast = variation[variation.length - 1];
  const fen = varLast?.fenAfter ?? mainFen;
  const exploring = variation.length > 0;

  // Live engine lines for whatever is on the board, when the Engine tab is open or you're exploring.
  const wantEngine = (tab === 'engine' || exploring) && !!plies && !retry;
  useEffect(() => {
    if (!wantEngine) {
      setLines([]);
      return;
    }
    if (new Chess(fen).isGameOver()) {
      setLines([]);
      return;
    }
    let alive = true;
    setLines([]); // never show the previous position's lines against this one
    setEngineDown(false);
    const h = getEngine().analyse(fen, { multipv: 3, depth: 18, onError: () => alive && setEngineDown(true) }, (ls) => alive && setLines([...ls]));
    return () => {
      alive = false;
      h.stop();
    };
  }, [fen, wantEngine]);

  if (game === undefined) return null;
  if (!game) {
    return (
      <EmptyState center icon={<GamesIcon />} title={copy.review.missingTitle} actions={<Link to="/games" className="btn primary">{copy.review.missingCta}</Link>}>
        {copy.review.missing}
      </EmptyState>
    );
  }
  if (!plies) {
    return (
      <>
        <BackLink to="/games">{copy.nav.games}</BackLink>
        <p className="muted">{copy.games.badPgn}</p>
      </>
    );
  }

  const review = ply > 0 && !exploring ? a?.moves[ply - 1] : undefined;
  const nextReview = a?.moves[ply];
  const retryable = !exploring && !!nextReview?.kind && plies[ply]?.color === mine;

  const shapes: DrawShape[] = [];
  if (!exploring && !retry && showBest && nextReview?.best && plies[ply]?.color === mine && nextReview.kind) {
    shapes.push({ orig: nextReview.best.slice(0, 2) as Key, dest: nextReview.best.slice(2, 4) as Key, brush: 'green' });
  }
  if (retry && !retry.result && hintOn && nextReview?.best) shapes.push({ orig: nextReview.best.slice(0, 2) as Key, brush: 'yellow' });
  if (retry?.pv?.[0]) shapes.push({ orig: retry.pv[0].slice(0, 2) as Key, dest: retry.pv[0].slice(2, 4) as Key, brush: 'green' });
  if ((tab === 'engine' || exploring) && lines[0]?.pv[0] && !retry) {
    shapes.push({ orig: lines[0].pv[0].slice(0, 2) as Key, dest: lines[0].pv[0].slice(2, 4) as Key, brush: 'blue' });
  }

  const evalCp = exploring
    ? lines[0]
      ? (new Chess(fen).turn() === 'w' ? 1 : -1) * scoreToCp(lines[0].score)
      : undefined
    : a?.evals[ply];
  const evalText = evalCp === undefined ? '' : fmtCp(evalCp);
  const lastMove: [string, string] | undefined = varLast ? [varLast.from, varLast.to] : last ? [last.from, last.to] : undefined;

  const run = () => enqueue([game.id]);

  // Player bars: names, ratings, material at this position, and the clock after each side's last move.
  const orientation: 'white' | 'black' = flipped ? (game.userColor === 'white' ? 'black' : 'white') : game.userColor;
  const clockAt = (side: 'w' | 'b'): number | undefined => {
    if (!a?.time) return undefined;
    for (let i = Math.min(ply, plies.length) - 1; i >= 0; i--) {
      if (plies[i].color !== side) continue;
      const m = a.moves[i];
      if (m.left === undefined || m.spent === undefined) return undefined;
      return m.left - m.spent + a.time.inc;
    }
    return a.time.base;
  };
  const bar = (side: 'white' | 'black') => {
    const s = side === 'white' ? 'w' : 'b';
    const elo = side === 'white' ? game.whiteElo : game.blackElo;
    return (
      <PlayerBar
        name={side === 'white' ? game.white : game.black}
        sub={elo ? String(elo) : undefined}
        side={side}
        fen={fen}
        clock={exploring ? undefined : clockAt(s)}
        active={!exploring && new Chess(fen).turn() === s && ply < plies.length}
      />
    );
  };

  // Your mistakes, as the ply index of the position before each one (where Retry works).
  const myMistakes = a ? a.moves.flatMap((m, i) => (m.kind && plies[i]?.color === mine ? [i] : [])) : [];
  const nextMistake = myMistakes.find((i) => i > ply);
  const prevMistake = [...myMistakes].reverse().find((i) => i < ply);

  /** Any move on the board: a retry attempt, or an exploration branch. */
  const onMove = async (from: string, to: string, promotion?: string) => {
    const c = new Chess(fen);
    const m = playUci(c, from + to + (promotion ?? ''));
    if (!m) return;
    const uci = from + to + (m.promotion ?? '');
    if (retry && !retry.result) {
      setRetryMove({ fen: c.fen(), from: m.from, to: m.to });
      const r = nextReview!;
      const before = winPct((mine === 'w' ? 1 : -1) * a!.evals[ply]);
      if (uci === r.best) {
        setRetry({ result: 'best', text: pick(copy.review.retryBest), pv: r.pv });
        return;
      }
      if (c.isCheckmate()) {
        setRetry({ result: 'best', text: pick(copy.review.retryBest), pv: [uci] });
        return;
      }
      const seq = ++retrySeq.current;
      setRetry({ text: copy.review.engineWaiting });
      try {
        const res = await getEngine().search(c.fen(), { depth: 10 });
        if (seq !== retrySeq.current) return; // you moved on while the engine was thinking
        const after = winPct((mine === 'w' ? 1 : -1) * (c.turn() === 'w' ? 1 : -1) * scoreToCp(res.score));
        const drop = before - after;
        const bestSan = uciToSan(plies[ply].fenBefore, r.best);
        setRetry(drop < 8 ? { result: 'good', text: copy.review.retryGood, pv: r.pv } : { result: 'bad', text: copy.review.retryBad(bestSan), pv: r.pv });
      } catch {
        if (seq !== retrySeq.current) return;
        setRetry(null);
        setRetryMove(null);
        toast(copy.engine.failed, 'bad');
      }
      return;
    }
    setVariation((v) => [
      ...v,
      { san: m.san, uci, from: m.from, to: m.to, color: m.color, captured: m.captured, fenBefore: m.before, fenAfter: m.after },
    ]);
  };

  const bookLine = game.book?.lineId ? getLine(game.book.lineId) : undefined;
  const bookRep = bookLine ? getRepertoire(bookLine.repertoireId) : undefined;
  const b = game.book;
  const lastMine = last?.color === mine;
  const mateBefore = a && last && !exploring ? mateFor(a.evals[ply - 1], last.color) : undefined;
  const explanation =
    review && last && a
      ? explainMove(last, review, a.moves[ply]?.pv ?? (ply === plies.length ? a.finalPv : undefined) ?? [], review.best ? uciToSan(last.fenBefore, review.best) : '', { mine: lastMine, mateBefore, prev: plies[ply - 2] })
      : '';
  // A quicker mate was there and the move still wins: say so, without calling it a mistake.
  const missedMate = !!review && !!last && !!mateBefore && mateBefore <= 5 && review.best !== last.uci && review.cls === 'good';
  const shownCls = missedMate ? 'inaccuracy' : (review?.merit ?? review?.cls);
  const story = a ? gameStory(a, plies, game.userColor, game.result) : null;
  const chanceOf = (i: number) => Math.round(story?.chances[i] ?? 50);
  const stale = a && (a.version ?? 1) < ANALYSIS_VERSION;

  return (
    <>
      <BackLink to="/games">{copy.nav.games}</BackLink>
      <div className="play review">
        <div className="board-col-wrap">
          <div className="pinned">
          <div className="board-stack">
            {bar(orientation === 'white' ? 'black' : 'white')}
            <div className="board-col">
              {a && evalCp !== undefined && <EvalBar whitePct={winPct(evalCp)} text={evalText} orientation={orientation} />}
              <div className="board-holder">
                <Board fen={retry && retryMove ? retryMove.fen : fen} orientation={orientation} lastMove={retry && retryMove ? [retryMove.from, retryMove.to] : lastMove} shapes={shapes} interactive={retry ? !retry.result && !retryMove : true} onMove={onMove} resizable />
                {review && last && !retry && <SquareBadge cls={review.cls} merit={review.merit} square={last.to} orientation={orientation} />}
              </div>
            </div>
            {bar(orientation)}
          </div>
          <div className="row stepper under-board">
            <button className="btn ghost" onClick={() => go(0)} aria-label="Start" disabled={!!retry}>⏮</button>
            <button className="btn ghost" onClick={() => (exploring ? setVariation((v) => v.slice(0, -1)) : go(Math.max(0, ply - 1)))} aria-label="Back" disabled={!!retry}>◀</button>
            <button className="btn ghost" onClick={() => go(Math.min(plies.length, ply + 1))} aria-label="Forward" disabled={exploring || !!retry}>▶</button>
            <button className="btn ghost" onClick={() => go(plies.length)} aria-label="End" disabled={!!retry}>⏭</button>
            <button className="btn ghost" onClick={() => setFlipped((x) => !x)} aria-label={copy.play.flip} title={`${copy.play.flip} (F)`}>⇅</button>
            {exploring && (
              <button className="btn small" onClick={() => setVariation([])}>{copy.review.backToGame}</button>
            )}
            <span className="hint" style={{ margin: 0 }}>{exploring ? '' : copy.review.exploreHint}</span>
          </div>
          </div>
          {a && <EvalGraph evals={a.evals} moves={a.moves} userColor={game.userColor} ply={ply} onSelect={retry ? () => undefined : go} />}
        </div>

        <aside className="card side">
          <p className="eyebrow">
            {game.white} vs {game.black} · {game.result}
            {a?.opening && <> · {a.opening.eco}</>}
          </p>
          {a?.opening && <h2 className="opening-name">{a.opening.name}</h2>}

          {!a && (
            <div className="row" style={{ marginBottom: '0.8rem' }}>
              <button className="btn primary" onClick={run} disabled={progress !== null}>
                {progress === null ? copy.games.analyze : copy.games.analyzing(Math.round(progress * 100))}
              </button>
            </div>
          )}
          {stale && (
            <div className="feedback info">
              {copy.review.oldAnalysis}
              <div className="row">
                <button className="btn small" onClick={run} disabled={progress !== null}>
                  {progress === null ? copy.review.reanalyze : copy.games.analyzing(Math.round(progress * 100))}
                </button>
              </div>
            </div>
          )}

          {exploring && (
            <div className="feedback info">
              <strong>{copy.review.variation}:</strong> {variation.map((v, i) => (v.color === 'w' || i === 0 ? formatPly(ply + i, v.san) : v.san)).join(' ')}
            </div>
          )}

          {retry && (
            <div className={`feedback ${retry.result === 'best' ? 'good' : retry.result === 'bad' ? 'bad' : 'info'}`} role="status">
              <div>
                {retry.text ?? (hintOn ? copy.review.hinted : copy.review.retrying)}
                {retry.result && retry.pv?.length ? (
                  <div className="muted small" style={{ marginTop: '0.3rem' }}>{playLine(plies[ply]?.fenBefore ?? fen, retry.pv).sans.join(' ')}</div>
                ) : null}
                <div className="row">
                  {!retry.result && !retryMove && !hintOn && (
                    <button className="btn small" onClick={() => setHintOn(true)}>{copy.review.hint}</button>
                  )}
                  {retry.result && retry.result !== 'best' && (
                    <button className="btn small" onClick={() => { setHintOn(false); setRetry({}); setRetryMove(null); }}>{copy.review.again}</button>
                  )}
                  <button className="btn small ghost" onClick={() => { retrySeq.current++; setRetry(null); setRetryMove(null); }}>{copy.review.retryCancel}</button>
                </div>
              </div>
            </div>
          )}

          {retryable && !retry && (
            <button className="btn primary" style={{ marginBottom: '0.7rem' }} onClick={() => { setRetry({}); setRetryMove(null); }}>
              {copy.review.retry}
            </button>
          )}

          {retryable && !retry && !showBest && <p className="muted small">{copy.review.retryFirst}</p>}
          {retryable && !retry && !showBest && (
            <button className="btn ghost small" style={{ marginBottom: '0.7rem' }} onClick={() => setShowBest(true)}>
              {copy.review.showBest}
            </button>
          )}

          {a && !retry && !exploring && myMistakes.length > 0 && (
            <div className="row mistake-nav">
              <button className="btn ghost small" disabled={prevMistake === undefined} onClick={() => prevMistake !== undefined && go(prevMistake)} aria-label={copy.review.prevMistake}>
                ←
              </button>
              <span className="muted small mistake-count">
                {copy.review.mistakeCount(myMistakes.filter((i) => i < ply).length, myMistakes.length)}
              </span>
              <button className="btn small" disabled={nextMistake === undefined} onClick={() => nextMistake !== undefined && go(nextMistake)}>
                {copy.review.nextMistake} →
              </button>
            </div>
          )}

          {a && story && !retry && !exploring && (
            <div className={`rv-coach ${review && last ? shownCls : 'start'}`} aria-live="polite">
              {review && last ? (
                <>
                  <div className="rv-coach-head">
                    <span className={`dot ${shownCls}`} aria-hidden />
                    <strong>{formatPly(ply - 1, last.san)}{missedMate ? '' : review.merit ? MERIT_MARK[review.merit] : MARK[review.cls]}</strong>
                    <span className={`q-${shownCls}`}>{missedMate ? copy.review.missedMate : review.merit ? copy.review.merit[review.merit] : copy.review.classes[review.cls]}</span>
                    <span className="muted small">{lastMine ? copy.review.you : copy.review.opp}</span>
                  </div>
                  {review.merit && <p>{lastMine ? copy.review.meritWhy[review.merit] : copy.review.meritWhyOpp[review.merit]}</p>}
                  {explanation ? <p>{explanation}</p> : review.merit ? null : <p className="muted">{copy.review.quiet[review.cls] ?? copy.review.quiet.good}</p>}
                  {review.kind && lastMine && <p className="muted small">{copy.kinds[review.kind].roast}</p>}
                  <p className="muted small num">
                    {copy.review.chances(chanceOf(ply - 1), chanceOf(ply))}
                    {review.spent !== undefined && <> · {copy.review.spent(fmtClock(review.spent))}, {fmtClock(review.left ?? 0)} left</>}
                  </p>
                  {lastMine && review.kind && (
                    <button className="btn small" onClick={() => { go(ply - 1); setRetry({}); }}>{copy.review.tryAgain}</button>
                  )}
                </>
              ) : (
                <>
                  <p><strong>{story.verdict}</strong></p>
                  {story.cause && <p className="muted">{story.cause}</p>}
                </>
              )}
            </div>
          )}

          {a && !retry && !exploring && (
            <div className="tabs compact" role="group">
              {(['summary', 'moves', 'engine'] as Tab[]).map((t) => (
                <button key={t} aria-pressed={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                  {copy.review.tabs[t]}
                </button>
              ))}
            </div>
          )}

          {a && tab === 'summary' && !exploring && !retry && (
            <Summary a={a} plies={plies} userColor={game.userColor} onJump={(k) => go(k + 1)} story={story!} />
          )}

          {(tab === 'moves' || !a || exploring || retry) && (
            <>
              {b && !exploring && (
                <div className="comment">
                  <BookChip game={game} />{' '}
                  {b.status === 'you-deviated'
                    ? copy.book['you-deviated'](moveNo(b.ply), b.played!, b.expected!)
                    : b.status === 'they-deviated'
                      ? copy.book['they-deviated'](moveNo(b.ply), b.played!)
                      : copy.book['end-of-prep'](moveNo(b.ply))}
                  {b.status === 'they-deviated' && a?.moves[b.ply + 1]?.best && plies[b.ply + 1]?.color === mine && (
                    <>
                      {' '}
                      <button className="linklike" onClick={() => go(b.ply + 1)}>
                        {copy.review.theyLeftBest(uciToSan(plies[b.ply + 1].fenBefore, a.moves[b.ply + 1].best))}
                      </button>
                    </>
                  )}
                  {bookLine && bookRep && (
                    <>
                      {' '}
                      <Link to={`/learn/${bookRep.id}/${bookRep.lines.indexOf(bookLine)}`}>Review the line →</Link>
                    </>
                  )}
                </div>
              )}

              {!exploring && (
                <ol className="movelist">
                  {plies.map((p, i) => {
                    const cls = a?.moves[i]?.cls;
                    const merit = a?.moves[i]?.merit;
                    return (
                      <li key={i}>
                        <button className={`mv ${i === ply - 1 ? 'on' : ''} ${merit ?? cls ?? ''}`} onClick={() => go(i + 1)} disabled={!!retry}>
                          {i % 2 === 0 && <span className="mvnum">{Math.floor(i / 2) + 1}.</span>}<San san={p.san} color={p.color} />
                          {merit ? MERIT_MARK[merit] : cls && MARK[cls]}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
            </>
          )}

          {a && (tab === 'engine' || exploring) && !retry && (
            engineDown ? (
              <p className="field-error" role="alert">{copy.review.engineDown}</p>
            ) : (
              <EngineLines fen={fen} lines={lines} onPlay={(uci) => onMove(uci.slice(0, 2), uci.slice(2, 4))} />
            )
          )}

          {game.url && (
            <p className="hint">
              <a href={game.url} target="_blank" rel="noopener noreferrer">{copy.review.openOn(game.source === 'lichess' ? 'Lichess' : 'Chess.com')}</a>
            </p>
          )}
        </aside>
      </div>
    </>
  );
}

function Summary({
  a,
  plies,
  userColor,
  onJump,
  story,
}: {
  a: GameAnalysis;
  plies: GamePly[];
  userColor: 'white' | 'black';
  onJump: (ply: number) => void;
  story: GameStory;
}) {
  const mine = userColor === 'white' ? 'w' : 'b';
  const kinds = new Map<string, number>();
  for (const m of a.moves) if (m.kind) kinds.set(m.kind, (kinds.get(m.kind) ?? 0) + 1);
  const lessons = [...kinds.entries()].sort((x, y) => y[1] - x[1]).slice(0, 2);
  const counts = (cls: MoveReview['cls'], who: 'w' | 'b') => a.moves.filter((m, i) => m.cls === cls && plies[i].color === who).length;
  const rows: MoveReview['cls'][] = ['best', 'good', 'inaccuracy', 'mistake', 'blunder', 'missed-win'];

  return (
    <div className="summary">
      <div className="acc-compare">
        <div>
          <span className="muted small">{copy.review.you}</span>
          <strong>{a.accuracy}%</strong>
        </div>
        <div className="acc-track"><span style={{ width: `${a.accuracy}%` }} /></div>
        <div>
          <span className="muted small">{copy.review.opp}</span>
          <strong>{a.oppAccuracy ?? '–'}%</strong>
        </div>
        <div className="acc-track opp"><span style={{ width: `${a.oppAccuracy ?? 0}%` }} /></div>
      </div>

      <table className="cls-table">
        <tbody>
          {rows.map((cls) => (
            <tr key={cls}>
              <td>{counts(cls, mine)}</td>
              <td className={`cls-${cls}`}>{copy.review.classes[cls]}</td>
              <td>{counts(cls, mine === 'w' ? 'b' : 'w')}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {a.phases && (
        <div className="phases">
          {(['opening', 'middlegame', 'endgame'] as const).map((ph) => (
            <div key={ph} className="phase">
              <span className="muted small">{copy.review.phases[ph]}</span>
              <strong>{a.phases![ph].moves ? `${a.phases![ph].accuracy}%` : '–'}</strong>
            </div>
          ))}
        </div>
      )}

      <h3>{copy.review.keyMoments}</h3>
      {a.keyMoments?.length ? (
        <ul className="moments">
          {story.moments.map((k) => (
            <li key={k.ply}>
              <button className="mv rv-moment" onClick={() => onJump(k.ply)}>
                <span className={`dot ${k.cls}`} aria-hidden />
                <strong>{k.move}</strong>
                <span className={`q-${k.cls}`}>{copy.review.classes[k.cls]}</span>
                <span className="muted small">{k.mine ? copy.review.you : copy.review.opp}</span>
                <span className={`rv-swing num ${k.swing < 0 ? 'q-blunder' : 'q-best'}`}>{k.swing > 0 ? '+' : ''}{Math.round(k.swing)}%</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">{copy.review.noMoments}</p>
      )}
      {a.decidedAt !== undefined && <p className="muted small">{copy.review.decided(moveNo(a.decidedAt))}</p>}

      {a.time && (
        <>
          <h3>{copy.review.time}</h3>
          <ul className="lessons">
            <li>{copy.review.timeLine(fmtClock(a.time.openingSecs), fmtClock(a.time.totalSecs))}</li>
            {a.time.lowTimeErrors > 0 && <li>{copy.review.lowTimeErrors(a.time.lowTimeErrors)}</li>}
            {a.time.hastyErrors > 0 && <li>{copy.review.hastyErrors(a.time.hastyErrors)}</li>}
            {a.time.endedLow && <li>{copy.review.endedLow}</li>}
            {!a.time.lowTimeErrors && !a.time.hastyErrors && !a.time.endedLow && <li>{copy.review.noTimeIssues}</li>}
          </ul>
        </>
      )}

      <h3>{copy.review.lessons}</h3>
      {lessons.length ? (
        <ul className="lessons">
          {lessons.map(([k, n]) => (
            <li key={k}>
              <strong>{copy.kinds[k].label}</strong> ×{n}. {copy.kinds[k].roast}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">{copy.review.lessonNone}</p>
      )}
    </div>
  );
}

function EngineLines({ fen, lines, onPlay }: { fen: string; lines: PvLine[]; onPlay: (uci: string) => void }) {
  const turn = new Chess(fen).turn();
  const ref = useRef<HTMLDivElement>(null);
  if (!lines.length) return <p className="muted small">{copy.review.engineWaiting}</p>;
  return (
    <div className="engine-lines" ref={ref}>
      {lines.map((l) => {
        const cp = (turn === 'w' ? 1 : -1) * scoreToCp(l.score);
        const { sans } = playLine(fen, l.pv.slice(0, 8));
        return (
          <button key={l.multipv} className="engine-line" onClick={() => onPlay(l.pv[0])}>
            <b className={cp >= 0 ? 'w' : 'b'}>{l.score.mate !== undefined ? `M${Math.abs(l.score.mate)}` : fmtCp(cp)}</b>
            <span>{sans.join(' ')}</span>
            <span className="muted small">d{l.depth}</span>
          </button>
        );
      })}
    </div>
  );
}
