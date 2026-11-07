import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Chess } from 'chess.js';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import { copy, pick } from '../copy';
import { Board, BoardOverlay } from '../chess/Board';
import { playUci, uciToSan } from '../chess/game';
import { guardCheck, type GuardWarning } from '../chess/guard';
import { getEngine, scoreToCp, winPct, type SearchOptions } from '../engine/engine';
import { db } from '../srs/db';
import { withBook } from '../games/store';
import { useToast } from '../components/Toast';
import { setPrefs, usePrefs } from '../prefs';
import { play as sfx } from '../sound';

// The bottom three use Skill Level (Stockfish can't limit itself below 1320
// Elo), so their ratings are rough. The rest use UCI_Elo, which is calibrated.
const LEVELS: SearchOptions[] = [
  { skill: 0, depth: 1 },
  { skill: 3, depth: 3 },
  { skill: 6, depth: 5 },
  { elo: 1400, movetime: 500 },
  { elo: 1700, movetime: 600 },
  { elo: 2000, movetime: 700 },
];
const SETUP_KEY = 'play-setup';
const readSetup = (): Partial<Setup> => {
  try {
    return JSON.parse(localStorage.getItem(SETUP_KEY) ?? '{}');
  } catch {
    return {};
  }
};
const COACH_DEPTH = 10;

interface Setup {
  level: number;
  color: 'white' | 'black' | 'random';
  guard: boolean;
  cct: boolean;
}

type Verdict = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';
const VERDICT_MARK: Record<Verdict, string> = { best: '!', good: '', inaccuracy: '?!', mistake: '?', blunder: '??' };

export function Play() {
  const [params] = useSearchParams();
  const startFen = params.get('fen') ?? undefined;
  const [setup, setSetupState] = useState<Setup>(() => {
    const saved = readSetup();
    return {
      level: typeof saved.level === 'number' && saved.level >= 0 && saved.level < LEVELS.length ? saved.level : 1,
      color: params.get('color') === 'black' ? 'black' : params.get('color') === 'white' ? 'white' : (saved.color ?? 'white'),
      guard: saved.guard ?? true,
      cct: saved.cct ?? false,
    };
  });
  const setSetup = (s: Setup) => {
    setSetupState(s);
    try {
      localStorage.setItem(SETUP_KEY, JSON.stringify(s));
    } catch {
      /* private mode */
    }
  };
  const [game, setGame] = useState<{ color: 'white' | 'black'; n: number } | null>(null);

  if (game) {
    return <PlayGame key={game.n} setup={setup} color={game.color} startFen={startFen} onNew={() => setGame(null)} />;
  }

  const valid = (() => {
    if (!startFen) return true;
    try {
      new Chess(startFen);
      return true;
    } catch {
      return false;
    }
  })();

  return (
    <>
      <h1>{copy.play.title}</h1>
      <p className="lead">{startFen && valid ? copy.play.fromLine : copy.play.lead}</p>
      <section className="card setup">
        <label>{copy.play.level}</label>
        <div className="segmented level-grid">
          {copy.play.levels.map((name, i) => (
            <button key={name} className={`level ${setup.level === i ? 'on' : ''}`} aria-pressed={setup.level === i} onClick={() => setSetup({ ...setup, level: i })}>
              <span>{name}</span>
              <small>{copy.play.levelElo[i]}</small>
            </button>
          ))}
        </div>

        <label>{copy.play.color}</label>
        <div className="segmented">
          {(['white', 'black', 'random'] as const).map((c) => (
            <button key={c} className={setup.color === c ? 'on' : ''} onClick={() => setSetup({ ...setup, color: c })}>
              {c === 'white' ? '♔ White' : c === 'black' ? '♚ Black' : 'Random'}
            </button>
          ))}
        </div>

        <label className="check">
          <input type="checkbox" checked={setup.guard} onChange={(e) => setSetup({ ...setup, guard: e.target.checked })} />
          <span>
            <strong>{copy.play.guard}</strong> <span className="muted">{copy.play.guardHint}</span>
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={setup.cct} onChange={(e) => setSetup({ ...setup, cct: e.target.checked })} />
          <span>
            <strong>{copy.play.cct}</strong> <span className="muted">{copy.play.cctHint}</span>
          </span>
        </label>
        <CoachToggle />

        <button
          className="btn primary lg"
          disabled={!valid}
          onClick={() =>
            setGame({
              color: setup.color === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : setup.color,
              n: Date.now(),
            })
          }
        >
          {copy.play.start}
        </button>
      </section>
    </>
  );
}

function CoachToggle() {
  const prefs = usePrefs();
  return (
    <label className="check">
      <input type="checkbox" checked={prefs.coach} onChange={(e) => setPrefs({ coach: e.target.checked })} />
      <span>
        <strong>{copy.play.coach}</strong> <span className="muted">{copy.play.coachHint}</span>
      </span>
    </label>
  );
}

type Pending = { uci: string; fen: string; warning: GuardWarning };
interface Logged { san: string; color: 'w' | 'b'; verdict?: Verdict; better?: string }

function PlayGame({
  setup,
  color,
  startFen,
  onNew,
}: {
  setup: Setup;
  color: 'white' | 'black';
  startFen?: string;
  onNew: () => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const prefs = usePrefs();
  const [chess] = useState(() => new Chess(startFen));
  const [fen, setFen] = useState(chess.fen());
  const [last, setLast] = useState<[string, string]>();
  const [pending, setPending] = useState<Pending | null>(null);
  const [cct, setCct] = useState([false, false, false]);
  const [saves, setSaves] = useState(0);
  const [hints, setHints] = useState(0);
  const [hint, setHint] = useState<{ level: 1 | 2; uci: string } | null>(null);
  const [thinking, setThinking] = useState(false);
  const [result, setResult] = useState<'win' | 'loss' | 'draw' | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [log, setLog] = useState<Logged[]>([]);
  const [verdict, setVerdict] = useState<{ v: Verdict; san: string; better?: string } | null>(null);
  const pre = useRef<{ fen: string; best: string; win: number } | null>(null); // eval before your move
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => void (alive.current = false);
  }, []);

  const mine = color[0];
  const sign = mine === 'w' ? 1 : -1;
  const sync = () => setFen(chess.fen());
  const myWin = (score: { cp?: number; mate?: number }, turn: 'w' | 'b') =>
    winPct(sign * (turn === 'w' ? 1 : -1) * scoreToCp(score as never));

  const finish = useCallback(
    (r: 'win' | 'loss' | 'draw') => {
      setResult(r);
      sfx(r === 'loss' ? 'lose' : r);
    },
    [],
  );

  const checkOver = useCallback(() => {
    if (!chess.isGameOver()) return false;
    if (chess.isCheckmate()) finish(chess.turn() === mine ? 'loss' : 'win');
    else finish('draw');
    return true;
  }, [chess, mine, finish]);

  /** Quietly evaluate your position so hints and the coach have a reference. */
  const prepare = useCallback(async () => {
    const at = chess.fen();
    try {
      const r = await getEngine().search(at, { depth: COACH_DEPTH });
      if (alive.current && chess.fen() === at) pre.current = { fen: at, best: r.bestmove, win: myWin(r.score, chess.turn()) };
    } catch {
      /* hints just won't be available */
    }
  }, [chess]);

  const engineMove = useCallback(async () => {
    setThinking(true);
    try {
      const r = await getEngine().search(chess.fen(), LEVELS[setup.level]);
      if (!alive.current) return;
      const m = r.bestmove ? playUci(chess, r.bestmove) : null;
      if (m) {
        setLast([m.from, m.to]);
        setLog((l) => [...l, { san: m.san, color: m.color }]);
      }
      sync();
      if (!checkOver()) prepare();
    } catch {
      if (alive.current) toast(copy.engine.failed, 'bad');
    } finally {
      if (alive.current) setThinking(false);
    }
  }, [chess, setup.level, checkOver, toast, prepare]);

  // Engine opens when you're Black. The ref stops StrictMode's double mount
  // from asking it twice.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    if (chess.turn() !== mine && !chess.isGameOver()) engineMove();
    else prepare();
  }, [chess, mine, engineMove, prepare]);

  const commit = async (uci: string) => {
    const before = pre.current?.fen === chess.fen() ? pre.current : null;
    const m = playUci(chess, uci);
    if (!m) return;
    setLast([m.from, m.to]);
    setPending(null);
    setHint(null);
    setCct([false, false, false]);
    sync();
    const entry: Logged = { san: m.san, color: m.color };
    setLog((l) => [...l, entry]);
    if (checkOver()) return;

    // Coach: grade the move you just played against the pre-move evaluation.
    if (prefs.coach && before) {
      try {
        const after = await getEngine().search(chess.fen(), { depth: COACH_DEPTH });
        if (!alive.current) return;
        const drop = before.win - myWin(after.score, chess.turn());
        const v: Verdict =
          uci === before.best ? 'best' : drop < 5 ? 'good' : drop < 12 ? 'inaccuracy' : drop < 25 ? 'mistake' : 'blunder';
        const better = v === 'best' || v === 'good' ? undefined : uciToSan(before.fen, before.best);
        setVerdict({ v, san: m.san, better });
        setLog((l) => l.map((x) => (x === entry ? { ...x, verdict: v, better } : x)));
        if (v === 'blunder') sfx('wrong');
        else if (v === 'best') sfx('correct');
      } catch {
        /* no verdict this time */
      }
    }
    engineMove();
  };

  const onMove = (from: string, to: string, promotion?: string) => {
    const probe = new Chess(chess.fen());
    const m = playUci(probe, from + to + (promotion ?? ''));
    if (!m) return sync();
    const uci = from + to + (m.promotion ?? '');
    if (setup.guard) {
      const [w] = guardCheck(probe.fen(), { to: m.to, captured: m.captured });
      if (w) {
        setPending({ uci, fen: probe.fen(), warning: w });
        setLast([from, to]);
        sfx('tick');
        return;
      }
    }
    commit(uci);
  };

  const takeBack = () => {
    setPending(null);
    setSaves((s) => s + 1);
    setLast(undefined);
    sync();
  };

  /** Undo your last move (and the engine's reply if it already came). */
  const undo = () => {
    if (thinking || result) return;
    const n = chess.turn() === mine ? 2 : 1;
    for (let i = 0; i < n; i++) chess.undo();
    setLog((l) => l.slice(0, -n));
    setVerdict(null);
    setHint(null);
    setLast(undefined);
    sync();
    prepare();
  };

  const askHint = async () => {
    if (!myTurn) return;
    let best = pre.current?.fen === chess.fen() ? pre.current.best : '';
    if (!best) {
      try {
        best = (await getEngine().search(chess.fen(), { depth: COACH_DEPTH })).bestmove;
      } catch {
        return;
      }
    }
    if (!best || !alive.current) return;
    setHints((h) => h + 1);
    setHint((h) => ({ level: h?.uci === best && h.level === 1 ? 2 : 1, uci: best }));
  };

  const review = async () => {
    chess.setHeader('White', color === 'white' ? 'You' : 'Stockfish');
    chess.setHeader('Black', color === 'black' ? 'You' : 'Stockfish');
    const row = withBook({
      id: `local:${Date.now()}`,
      source: 'local',
      pgn: chess.pgn(),
      white: color === 'white' ? 'You' : `Stockfish (${copy.play.levels[setup.level]})`,
      black: color === 'black' ? 'You' : `Stockfish (${copy.play.levels[setup.level]})`,
      userColor: color,
      result: result ?? 'loss',
      timeClass: 'training',
      endTime: new Date(),
    });
    await db.games.add(row);
    navigate(`/games/${encodeURIComponent(row.id)}`);
  };

  const cctReady = !setup.cct || cct.every(Boolean);
  const myTurn = chess.turn() === mine && !result && !pending && !thinking;
  const shapes: DrawShape[] = [];
  if (pending) shapes.push({ orig: pending.warning.square as Key, brush: 'red' });
  if (hint && myTurn) {
    shapes.push(
      hint.level === 1
        ? { orig: hint.uci.slice(0, 2) as Key, brush: 'yellow' }
        : { orig: hint.uci.slice(0, 2) as Key, dest: hint.uci.slice(2, 4) as Key, brush: 'green' },
    );
  }
  const w = pending?.warning;
  const pairs: Logged[][] = [];
  log.forEach((m, i) => {
    if (i % 2 === 0 || !pairs.length) pairs.push([m]);
    else pairs[pairs.length - 1].push(m);
  });
  const startsBlack = chess.history().length > 0 && log[0]?.color === 'b';
  const myVerdicts = log.filter((l) => l.verdict);
  const summary = myVerdicts.length
    ? (['best', 'good', 'inaccuracy', 'mistake', 'blunder'] as Verdict[])
        .map((v) => ({ v, n: myVerdicts.filter((l) => l.verdict === v).length }))
        .filter((x) => x.n)
    : [];

  return (
    <div className="play">
      <Board
        fen={pending ? pending.fen : fen}
        orientation={color}
        interactive={myTurn && cctReady}
        premovable={!result && !pending && !setup.cct}
        lastMove={last}
        shapes={shapes}
        onMove={onMove}
        overlay={
          result && !dismissed ? (
            <BoardOverlay>
              <div className="big" aria-hidden>{result === 'win' ? '♔' : result === 'loss' ? '♟' : '½'}</div>
              <h2>{copy.play.overTitle[result]}</h2>
              <p className="muted">{pick(copy.play.over[result])}</p>
              {summary.length > 0 && (
                <p className="muted">{summary.map((s) => `${s.n} ${copy.play.verdicts[s.v].toLowerCase()}`).join(' · ')}</p>
              )}
              <div className="row">
                {chess.history().length > 0 && <button className="btn primary" onClick={review}>{copy.play.review}</button>}
                <button className="btn ghost" onClick={onNew}>{copy.play.newGame}</button>
                <button className="btn small" onClick={() => setDismissed(true)}>{copy.play.lookAtBoard}</button>
              </div>
            </BoardOverlay>
          ) : null
        }
      />
      <aside className="card side playside">
        <div className="opp-row">
          <span className="opp-avatar" aria-hidden>🤖</span>
          <div>
            <strong>Stockfish · {copy.play.levels[setup.level]}</strong>
            <div className="muted small">
              {copy.play.youPlay(color)} · {setup.guard ? copy.play.guardOn : copy.play.guardOff}
              {prefs.coach ? ` · ${copy.play.coachOn}` : ''}
            </div>
          </div>
        </div>

        {result ? (
          <div className={`feedback ${result === 'win' ? 'good' : result === 'loss' ? 'bad' : 'info'}`}>
            <div>
              {pick(copy.play.over[result])}
              {summary.length > 0 && (
                <div className="muted small" style={{ marginTop: '0.3rem' }}>
                  {summary.map((s) => `${s.n} ${copy.play.verdicts[s.v].toLowerCase()}`).join(' · ')}
                  {hints ? ` · ${copy.play.hintsUsed(hints)}` : ''}
                </div>
              )}
            </div>
          </div>
        ) : w ? (
          <div className="feedback bad" role="alert">
            <div>
              <strong>{copy.play.warnTitle}</strong>{' '}
              {w.kind === 'mate'
                ? copy.play.warn.mate
                : w.kind === 'hanging'
                  ? copy.play.warn.hanging(w.piece)
                  : copy.play.warn['cheap-capture'](w.piece, w.by ?? 'piece')}
              <div className="row">
                <button className="btn primary small" onClick={takeBack} autoFocus>{copy.play.takeBack}</button>
                <button className="btn ghost small" onClick={() => commit(pending!.uci)}>{copy.play.playAnyway}</button>
              </div>
            </div>
          </div>
        ) : (
          <div className="feedback info" role="status">
            {thinking ? pick(copy.play.thinking) : hint ? copy.play.hintShown(hint.level) : copy.play.yourTurn}
          </div>
        )}

        {verdict && !result && !w && (
          <div className={`verdict ${verdict.v}`} role="status">
            <strong>{verdict.san}{VERDICT_MARK[verdict.v]}</strong> {copy.play.verdicts[verdict.v]}
            {verdict.better ? ` · ${copy.play.betterWas(verdict.better)}` : ''}
          </div>
        )}

        {setup.cct && myTurn && (
          <div className="chips">
            {copy.play.cctChips.map((c, i) => (
              <button key={c} className={`chip ${cct[i] ? 'on' : ''}`} aria-pressed={cct[i]} onClick={() => setCct(cct.map((v, j) => (j === i ? !v : v)))}>
                {cct[i] ? '✓ ' : ''}{c}
              </button>
            ))}
          </div>
        )}

        <ol className="moves-grid" start={1}>
          {pairs.map((pair, i) => (
            <li key={i}>
              <span className="num">{i + 1}.</span>
              {startsBlack && i === 0 && <span className="mvcell muted">…</span>}
              {pair.map((m, j) => (
                <span key={j} className={`mvcell ${m.verdict ?? ''}`} title={m.better ? copy.play.betterWas(m.better) : undefined}>
                  {m.san}
                  {m.verdict && VERDICT_MARK[m.verdict]}
                </span>
              ))}
            </li>
          ))}
        </ol>

        <div className="row play-actions">
          {!result && (
            <>
              <button className="btn ghost" onClick={askHint} disabled={!myTurn}>{copy.play.hint}</button>
              <button className="btn ghost" onClick={undo} disabled={thinking || log.length === 0}>{copy.play.undo}</button>
              <button className="btn danger" onClick={() => finish('loss')}>{copy.play.resign}</button>
            </>
          )}
          {result && chess.history().length > 0 && (
            <button className="btn primary" onClick={review}>{copy.play.review}</button>
          )}
          <button className="btn ghost" onClick={onNew}>{copy.play.newGame}</button>
        </div>
        <p className="hint">
          {copy.play.saves(saves)}{hints ? ` · ${copy.play.hintsUsed(hints)}` : ''}
        </p>
      </aside>
    </div>
  );
}
