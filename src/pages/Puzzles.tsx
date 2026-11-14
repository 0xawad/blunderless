import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BoardRow, Stage, StageBoard, StagePanel } from '../components/Stage';
import { Segmented } from '../components/ui';
import { Link, useSearchParams } from 'react-router-dom';
import { Callout, EmptyState } from '../components/ui';
import { PuzzleIcon } from '../components/icons';
import { useLiveQuery } from 'dexie-react-hooks';
import { Chess } from 'chess.js';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import { copy, pick } from '../copy';
import { Board } from '../chess/Board';
import { playUci, uciToSan } from '../chess/game';
import { getEngine, scoreToCp, winPct } from '../engine/engine';
import { db, getSetting, recordPuzzle, savePuzzle, setSetting } from '../srs/db';
import type { PuzzleRow } from '../srs/types';
import { play as sfx } from '../sound';

type Puzzle = Pick<PuzzleRow, 'id' | 'source' | 'fen' | 'moves' | 'theme' | 'rating' | 'gameId' | 'ply'>;

/** A different move than the engine's still solves one of your own puzzles if it's this close (win%). */
const ALT_TOLERANCE = 5;

const THEMES = Object.keys(copy.puzzles.themeNames);
const OPP_DELAY = 500;
const themeCache = new Map<string, Puzzle[]>();

async function loadTheme(theme: string): Promise<Puzzle[]> {
  if (theme === 'mixed') {
    // One missing pack must not blank the whole mix: use what loaded, fail only if nothing did.
    const packs = await Promise.allSettled(THEMES.map(loadTheme));
    const ok = packs.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    if (!ok.length) throw new Error('no puzzle packs could be loaded');
    return ok;
  }
  const hit = themeCache.get(theme);
  if (hit) return hit;
  const res = await fetch(`/puzzles/${theme}.json`);
  if (!res.ok) throw new Error(`puzzle pack ${theme}: HTTP ${res.status}`);
  const raw: unknown = await res.json();
  const list = (Array.isArray(raw) ? raw : [])
    .filter((p): p is [string, string, string, number] => Array.isArray(p) && p.length === 4)
    .map(([id, fen, moves, rating]) => ({
      id: `lichess:${id}`,
      source: 'lichess' as const,
      fen,
      moves: moves.split(' '),
      theme,
      rating,
    }));
  themeCache.set(theme, list);
  return list;
}

/** Elo-style update against the puzzle's rating. */
const nextRating = (mine: number, puzzle: number, solved: boolean) =>
  Math.round(mine + 32 * ((solved ? 1 : 0) - 1 / (1 + 10 ** ((puzzle - mine) / 400))));

export function Puzzles() {
  // /puzzles?theme=<id> opens the themed trainer on that theme (the coach and the Today plan link here).
  const [params] = useSearchParams();
  const asked = params.get('theme');
  const [tab, setTab] = useState<string>(asked && (asked === 'mixed' || THEMES.includes(asked)) ? asked : 'mine');
  const due = useLiveQuery(
    () => db.puzzles.where('card.due').belowOrEqual(new Date()).sortBy('card.due'),
    [],
  );
  const rating = useLiveQuery(async () => (await getSetting<number>('puzzleRating')) ?? 800, []);

  return (
    <>
      <div className="map-head pz-head">
        <h1>{copy.puzzles.title}</h1>
        <div className="cluster">
          {tab !== 'mine' && (
            <select aria-label={copy.puzzles.themeLabel} value={tab} onChange={(e) => setTab(e.target.value)}>
              <option value="mixed">{copy.puzzles.mixed}</option>
              {THEMES.map((t) => (
                <option key={t} value={t}>{copy.puzzles.themeNames[t]}</option>
              ))}
            </select>
          )}
          <Segmented
            label={copy.puzzles.title}
            value={tab === 'mine' ? 'mine' : 'themed'}
            onChange={(v) => setTab(v === 'mine' ? 'mine' : tab === 'mine' ? 'mixed' : tab)}
            options={[
              { value: 'mine', label: <>{copy.puzzles.mine}{due?.length ? <span className="count">{due.length > 99 ? '99+' : due.length}</span> : null}</> },
              { value: 'themed', label: copy.puzzles.themed },
            ]}
          />
        </div>
      </div>
      {tab === 'mine' ? (
        <ReviewQueue due={due} />
      ) : rating !== undefined ? (
        <ThemeTrainer key={tab} theme={tab} rating={rating} />
      ) : null}
    </>
  );
}

function ReviewQueue({ due }: { due?: PuzzleRow[] }) {
  // Freeze the queue at the start so solved puzzles don't reshuffle under you.
  const [queue, setQueue] = useState<PuzzleRow[] | null>(null);
  const [pos, setPos] = useState(0);
  useEffect(() => {
    if (due && queue === null) setQueue(due);
  }, [due, queue]);

  if (!queue) return null;
  if (pos >= queue.length) {
    return (
      <section className="card empty-state">
        <p className="lead">{copy.puzzles.mineNone}</p>
        {queue.length > 0 && <button className="btn ghost" onClick={() => { setQueue(null); setPos(0); }}>Refresh</button>}
      </section>
    );
  }
  const p = queue[pos];
  return (
    <PuzzleRun
      key={p.id}
      puzzle={p}
      label={`${pos + 1} / ${queue.length} · ${copy.kinds[p.theme]?.label ?? copy.puzzles.themeNames[p.theme] ?? p.theme}`}
      onDone={(solved) => recordPuzzle(p, solved, true)}
      onNext={() => setPos((x) => x + 1)}
      onSkip={() => setPos((x) => x + 1)}
    />
  );
}

function ThemeTrainer({ theme, rating }: { theme: string; rating: number }) {
  const [list, setList] = useState<Puzzle[] | null>(null);
  const [current, setCurrent] = useState<Puzzle | null>(null);
  const seen = useRef(new Set<string>());

  const next = useCallback(
    (all: Puzzle[], r: number) => {
      const fresh = all.filter((p) => !seen.current.has(p.id));
      const pool = fresh.length ? fresh : all;
      const near = pool.filter((p) => Math.abs((p.rating ?? 0) - r) <= 150);
      // Thin rating band (e.g. very easy trapped-piece puzzles): take the closest ones, never a random 2000.
      const closest = near.length >= 5 ? near : [...pool].sort((a, b) => Math.abs((a.rating ?? 0) - r) - Math.abs((b.rating ?? 0) - r)).slice(0, 10);
      const choice = pick(closest);
      seen.current.add(choice.id);
      setCurrent(choice);
    },
    [],
  );

  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    setList(null);
    setCurrent(null);
    loadTheme(theme)
      .then((l) => {
        if (!alive) return;
        setList(l);
        if (l.length) next(l, rating);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
    // rating is read once per load on purpose: a rating change must not reload the pack
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, next, attempt]);

  if (failed) {
    return (
      <Callout tone="bad" role="alert" actions={<button className="btn small ghost" onClick={() => setAttempt((n) => n + 1)}>{copy.puzzles.retryLoad}</button>}>
        {copy.puzzles.loadFailed}
      </Callout>
    );
  }
  if (list && list.length === 0) return <EmptyState icon={<PuzzleIcon />} title={copy.puzzles.emptyPackTitle}>{copy.puzzles.emptyPack}</EmptyState>;
  if (!list || !current) {
    return (
      <div className="skeleton" aria-busy="true" aria-label="Loading">
        <span style={{ height: 320 }} />
      </div>
    );
  }

  return (
    <PuzzleRun
      key={current.id}
      puzzle={current}
      label={`${theme === 'mixed' ? copy.puzzles.themeNames[current.theme] : copy.puzzles.themeNames[theme]} · ${copy.puzzles.rating(rating)}`}
      onDone={async (solved) => {
        await setSetting('puzzleRating', nextRating(rating, current.rating ?? rating, solved));
        if (!solved) await savePuzzle(current); // missed ones join your review queue
        await recordPuzzle(current, solved, false);
      }}
      onNext={() => next(list, rating)}
      onSkip={() => next(list, rating)}
    />
  );
}

function PuzzleRun({
  puzzle,
  label,
  onDone,
  onNext,
  onSkip,
}: {
  puzzle: Puzzle;
  label: string;
  onDone: (solved: boolean) => void;
  onNext: () => void;
  /** Move on without recording an attempt. */
  onSkip: () => void;
}) {
  // Lichess puzzles start with the opponent's move; your own start on your move.
  const offset = puzzle.source === 'lichess' ? 1 : 0;
  const chess = useMemo(() => new Chess(puzzle.fen), [puzzle.fen]);
  const userColor = useMemo(() => {
    const turn = new Chess(puzzle.fen).turn();
    return (offset ? (turn === 'w' ? 'b' : 'w') : turn) === 'w' ? 'white' : 'black';
  }, [puzzle.fen, offset]);
  const [idx, setIdx] = useState(0);
  const [fen, setFen] = useState(puzzle.fen);
  const [last, setLast] = useState<[string, string]>();
  const [state, setState] = useState<'playing' | 'solved' | 'failed'>('playing');
  const [shapes, setShapes] = useState<DrawShape[]>([]);
  const [checking, setChecking] = useState(false);
  const [hint, setHint] = useState(0); // 0 none, 1 piece, 2 move
  const [msg, setMsg] = useState<string>(
    puzzle.source === 'mine' ? copy.puzzles.yourBlunder : copy.puzzles.findMove(userColor === 'white' ? 'White' : 'Black'),
  );
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const apply = useCallback(
    (uci: string) => {
      const m = playUci(chess, uci);
      if (!m) return false;
      setFen(chess.fen());
      setLast([m.from, m.to]);
      return true;
    },
    [chess],
  );

  const opponent = useCallback(
    (i: number) => {
      timer.current = window.setTimeout(() => {
        apply(puzzle.moves[i]);
        setIdx(i + 1);
      }, OPP_DELAY);
    },
    [apply, puzzle.moves],
  );

  useEffect(() => {
    if (offset) opponent(0);
  }, [offset, opponent]);

  const finish = (solved: boolean, text?: string) => {
    setState(solved ? 'solved' : 'failed');
    sfx(solved ? 'correct' : 'wrong');
    setMsg(text ?? (solved && hint ? copy.puzzles.solvedWithHint : pick(solved ? copy.puzzles.solved : copy.puzzles.failed)));
    // Solving with a hint counts as not quite known yet.
    onDone(solved && !hint);
  };

  const askHint = () => {
    const want = puzzle.moves[idx];
    if (!want || state !== 'playing') return;
    const level = Math.min(2, hint + 1);
    setHint(level);
    setShapes(
      level === 1
        ? [{ orig: want.slice(0, 2) as Key, brush: 'yellow' }]
        : [{ orig: want.slice(0, 2) as Key, dest: want.slice(2, 4) as Key, brush: 'green' }],
    );
  };

  const fail = (want: string) => {
    setFen(chess.fen()); // snap back
    setShapes([{ orig: want.slice(0, 2) as Key, dest: want.slice(2, 4) as Key, brush: 'green' }]);
    finish(false);
  };

  /** Your own puzzles have one stored answer, but any move about as good as it solves them. */
  const closeEnough = async (fenBefore: string, uci: string): Promise<boolean> => {
    const probe = new Chess(fenBefore);
    if (!playUci(probe, uci)) return false;
    const engine = getEngine();
    const [best, mine] = await Promise.all([
      engine.search(fenBefore, { depth: 12 }),
      engine.search(probe.fen(), { depth: 12 }),
    ]);
    return winPct(scoreToCp(best.score)) - winPct(-scoreToCp(mine.score)) < ALT_TOLERANCE;
  };

  const onMove = async (from: string, to: string, promotion?: string) => {
    if (state !== 'playing' || checking) return;
    const want = puzzle.moves[idx];
    if (!want) return;
    const promo = promotion ?? (want.slice(0, 4) === from + to ? want.slice(4) : '');
    const probe = new Chess(chess.fen());
    playUci(probe, from + to + promo);
    // Any other mate counts too; Lichess does the same.
    let right = from + to + promo === want || probe.isCheckmate();
    if (!right && puzzle.source === 'mine' && puzzle.moves.length === 1) {
      // Leave the piece where you put it while the engine judges it.
      setFen(probe.fen());
      setLast([from, to]);
      setChecking(true);
      setMsg(copy.puzzles.checking);
      try {
        right = await closeEnough(chess.fen(), from + to + promo);
      } catch {
        right = false;
      } finally {
        setChecking(false);
      }
      if (right) {
        apply(from + to + promo); // updates the game; the board already shows it
        setShapes([{ orig: want.slice(0, 2) as Key, dest: want.slice(2, 4) as Key, brush: 'blue' }]);
        finish(true, copy.puzzles.altSolved(uciToSan(puzzle.fen, want)));
        return;
      }
    }
    if (!right) {
      fail(want);
      return;
    }
    apply(from + to + promo);
    setShapes([]);
    if (chess.isCheckmate() || idx + 1 >= puzzle.moves.length) {
      finish(true);
      return;
    }
    setIdx(idx + 2);
    opponent(idx + 1);
  };

  const toMove = chess.turn() === 'w' ? 'White' : 'Black';
  const yourTurn = state === 'playing' && !checking && idx >= offset && chess.turn() === userColor[0];

  return (
    <Stage>
      <StageBoard>
        <BoardRow>
          <Board
            fen={fen}
            orientation={userColor}
            interactive={state === 'playing' && !checking && idx >= offset && chess.turn() === userColor[0]}
            lastMove={last}
            shapes={shapes}
            onMove={onMove}
          />
        </BoardRow>
      </StageBoard>
      <StagePanel
        label={copy.puzzles.title}
        head={
          <>
            <p className="kicker">
              {label}
              {puzzle.rating ? ` · ${copy.puzzles.puzzleRating(puzzle.rating)}` : ''}
            </p>
            <h2 className="pz-turn">
              <span className={`player-dot ${chess.turn() === 'w' ? 'white' : 'black'}`} aria-hidden />
              {state === 'playing' ? copy.puzzles.toMove(toMove, yourTurn) : copy.puzzles.over}
            </h2>
          </>
        }
        foot={
          state === 'playing' ? (
            <>
              <button className="btn ghost" onClick={askHint} disabled={!yourTurn || hint >= 2}>
                {hint === 1 ? copy.puzzles.hintMore : copy.puzzles.hint}
              </button>
              <button className="btn quiet" onClick={onSkip} disabled={checking}>{copy.puzzles.skip}</button>
            </>
          ) : (
            <button className="btn primary" onClick={onNext} autoFocus>{copy.puzzles.next}</button>
          )
        }
      >
        <div className={`feedback ${state === 'solved' ? 'good' : state === 'failed' ? 'bad' : 'info'}`} role="status">
          {msg}
        </div>
        {puzzle.source === 'mine' && copy.kinds[puzzle.theme] && <p className="muted small">{copy.kinds[puzzle.theme].roast}</p>}
        {puzzle.source === 'mine' && puzzle.gameId && (
          <p className="hint">
            <Link className="linklike" to={`/games/${encodeURIComponent(puzzle.gameId)}${puzzle.ply !== undefined ? `?ply=${puzzle.ply}` : ''}`}>{copy.puzzles.seeGame}</Link>
          </p>
        )}
        {puzzle.source === 'lichess' && <p className="hint">{copy.puzzles.credit}</p>}
      </StagePanel>
    </Stage>
  );
}
