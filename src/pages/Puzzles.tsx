import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Chess } from 'chess.js';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import { copy, pick } from '../copy';
import { Board } from '../chess/Board';
import { playUci } from '../chess/game';
import { db, getSetting, recordPuzzle, savePuzzle, setSetting } from '../srs/db';
import type { PuzzleRow } from '../srs/types';

type Puzzle = Pick<PuzzleRow, 'id' | 'source' | 'fen' | 'moves' | 'theme' | 'rating'>;

const THEMES = Object.keys(copy.puzzles.themeNames);
const OPP_DELAY = 500;
const themeCache = new Map<string, Puzzle[]>();

async function loadTheme(theme: string): Promise<Puzzle[]> {
  const hit = themeCache.get(theme);
  if (hit) return hit;
  const res = await fetch(`/puzzles/${theme}.json`);
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
  const [tab, setTab] = useState<string>('mine');
  const due = useLiveQuery(
    () => db.puzzles.where('card.due').belowOrEqual(new Date()).sortBy('card.due'),
    [],
  );
  const rating = useLiveQuery(async () => (await getSetting<number>('puzzleRating')) ?? 800, []);

  return (
    <>
      <h1>{copy.puzzles.title}</h1>
      <p className="lead">{copy.puzzles.lead}</p>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'mine'} className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>
          {copy.puzzles.mine} {due?.length ? <span className="badge due">{due.length}</span> : null}
        </button>
        {THEMES.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {copy.puzzles.themeNames[t]}
          </button>
        ))}
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
      const choice = pick(near.length ? near : pool);
      seen.current.add(choice.id);
      setCurrent(choice);
    },
    [],
  );

  useEffect(() => {
    loadTheme(theme).then((l) => {
      setList(l);
      if (l.length) next(l, rating);
    });
  }, [theme, next]);

  if (!list || !current) return null;

  return (
    <PuzzleRun
      key={current.id}
      puzzle={current}
      label={`${copy.puzzles.themeNames[theme]} · ${copy.puzzles.rating(rating)}`}
      onDone={async (solved) => {
        await setSetting('puzzleRating', nextRating(rating, current.rating ?? rating, solved));
        if (!solved) await savePuzzle(current); // missed ones join your review queue
        await recordPuzzle(current, solved, false);
      }}
      onNext={() => next(list, rating)}
    />
  );
}

function PuzzleRun({
  puzzle,
  label,
  onDone,
  onNext,
}: {
  puzzle: Puzzle;
  label: string;
  onDone: (solved: boolean) => void;
  onNext: () => void;
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

  const finish = (solved: boolean) => {
    setState(solved ? 'solved' : 'failed');
    setMsg(pick(solved ? copy.puzzles.solved : copy.puzzles.failed));
    onDone(solved);
  };

  const onMove = (from: string, to: string) => {
    if (state !== 'playing') return;
    const want = puzzle.moves[idx];
    if (!want) return;
    const promo = want.slice(0, 4) === from + to ? want.slice(4) : '';
    const probe = new Chess(chess.fen());
    playUci(probe, from + to + promo);
    // Any other mate counts too; Lichess does the same.
    const right = from + to === want.slice(0, 4) || probe.isCheckmate();
    if (!right) {
      setFen(chess.fen()); // snap back
      setShapes([{ orig: want.slice(0, 2) as Key, dest: want.slice(2, 4) as Key, brush: 'green' }]);
      finish(false);
      return;
    }
    apply(from + to + promo);
    if (chess.isCheckmate() || idx + 1 >= puzzle.moves.length) {
      finish(true);
      return;
    }
    setIdx(idx + 2);
    opponent(idx + 1);
  };

  return (
    <div className="play">
      <Board
        fen={fen}
        orientation={userColor}
        interactive={state === 'playing' && idx >= offset && chess.turn() === userColor[0]}
        lastMove={last}
        shapes={shapes}
        onMove={onMove}
      />
      <aside className="card side">
        <p className="eyebrow">{label}</p>
        <div className={`feedback ${state === 'solved' ? 'good' : state === 'failed' ? 'bad' : 'info'}`} role="status">
          {msg}
        </div>
        {puzzle.source === 'mine' && copy.kinds[puzzle.theme] && (
          <p className="muted">{copy.kinds[puzzle.theme].roast}</p>
        )}
        {state !== 'playing' && (
          <button className="btn primary" onClick={onNext} autoFocus>
            {copy.puzzles.next}
          </button>
        )}
      </aside>
    </div>
  );
}
