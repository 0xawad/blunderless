import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Chess } from 'chess.js';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import { copy, pick } from '../copy';
import { Board } from '../chess/Board';
import { playUci } from '../chess/game';
import { guardCheck, type GuardWarning } from '../chess/guard';
import { getEngine, type SearchOptions } from '../engine/engine';
import { db } from '../srs/db';
import { withBook } from '../games/store';

const LEVELS: SearchOptions[] = [
  { skill: 0, depth: 1 },
  { skill: 3, depth: 3 },
  { skill: 6, depth: 5 },
  { skill: 10, depth: 8 },
  { skill: 15, movetime: 600 },
];

interface Setup {
  level: number;
  color: 'white' | 'black' | 'random';
  guard: boolean;
  cct: boolean;
}

export function Play() {
  const [params] = useSearchParams();
  const startFen = params.get('fen') ?? undefined;
  const [setup, setSetup] = useState<Setup>({
    level: 1,
    color: (params.get('color') as Setup['color']) ?? 'white',
    guard: true,
    cct: false,
  });
  const [game, setGame] = useState<{ color: 'white' | 'black'; n: number } | null>(null);

  if (game) {
    return (
      <PlayGame
        key={game.n}
        setup={setup}
        color={game.color}
        startFen={startFen}
        onNew={() => setGame(null)}
      />
    );
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
        <div className="segmented">
          {copy.play.levels.map((name, i) => (
            <button key={name} className={setup.level === i ? 'on' : ''} onClick={() => setSetup({ ...setup, level: i })}>
              {name}
            </button>
          ))}
        </div>

        <label>{copy.play.color}</label>
        <div className="segmented">
          {(['white', 'black', 'random'] as const).map((c) => (
            <button key={c} className={setup.color === c ? 'on' : ''} onClick={() => setSetup({ ...setup, color: c })}>
              {c === 'white' ? '♔ White' : c === 'black' ? '♚ Black' : '🎲 Random'}
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

        <button
          className="btn primary"
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

type Pending = { uci: string; fen: string; warning: GuardWarning };

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
  const chess = useRef(new Chess(startFen)).current;
  const [fen, setFen] = useState(chess.fen());
  const [last, setLast] = useState<[string, string]>();
  const [pending, setPending] = useState<Pending | null>(null);
  const [cct, setCct] = useState([false, false, false]);
  const [saves, setSaves] = useState(0);
  const [thinking, setThinking] = useState(false);
  const [result, setResult] = useState<'win' | 'loss' | 'draw' | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => void (alive.current = false);
  }, []);

  const mine = color[0];
  const sync = () => setFen(chess.fen());

  const checkOver = useCallback(() => {
    if (!chess.isGameOver()) return false;
    if (chess.isCheckmate()) setResult(chess.turn() === mine ? 'loss' : 'win');
    else setResult('draw');
    return true;
  }, [chess, mine]);

  const engineMove = useCallback(async () => {
    setThinking(true);
    const r = await getEngine().search(chess.fen(), LEVELS[setup.level]);
    if (!alive.current) return;
    const m = r.bestmove ? playUci(chess, r.bestmove) : null;
    if (m) setLast([m.from, m.to]);
    setThinking(false);
    sync();
    checkOver();
  }, [chess, setup.level, checkOver]);

  // Engine opens when you're Black. The ref stops StrictMode's double mount
  // from asking it twice.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    if (chess.turn() !== mine && !chess.isGameOver()) engineMove();
  }, [chess, mine, engineMove]);

  const commit = (uci: string) => {
    const m = playUci(chess, uci);
    if (!m) return;
    setLast([m.from, m.to]);
    setPending(null);
    setCct([false, false, false]);
    sync();
    if (!checkOver()) engineMove();
  };

  const onMove = (from: string, to: string) => {
    const probe = new Chess(chess.fen());
    const m = playUci(probe, from + to);
    if (!m) return sync();
    const uci = from + to + (m.promotion ?? '');
    if (setup.guard) {
      const [w] = guardCheck(probe.fen(), { to: m.to, captured: m.captured });
      if (w) {
        setPending({ uci, fen: probe.fen(), warning: w });
        setLast([from, to]);
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
  const shapes: DrawShape[] = pending ? [{ orig: pending.warning.square as Key, brush: 'red' }] : [];
  const w = pending?.warning;

  return (
    <div className="play">
      <Board
        fen={pending ? pending.fen : fen}
        orientation={color}
        interactive={myTurn && cctReady}
        lastMove={last}
        shapes={shapes}
        onMove={onMove}
      />
      <aside className="card side">
        <p className="eyebrow">
          vs {copy.play.levels[setup.level]} · {copy.play.saves(saves)}
        </p>

        {result ? (
          <div className={`feedback ${result === 'win' ? 'good' : result === 'loss' ? 'bad' : 'info'}`}>
            {pick(copy.play.over[result])}
          </div>
        ) : w ? (
          <div className="feedback bad" role="alert">
            <strong>{copy.play.warnTitle}</strong>{' '}
            {w.kind === 'mate'
              ? copy.play.warn.mate
              : w.kind === 'hanging'
                ? copy.play.warn.hanging(w.piece)
                : copy.play.warn['cheap-capture'](w.piece, w.by ?? 'piece')}
            <div className="row" style={{ marginTop: '0.6rem' }}>
              <button className="btn primary" onClick={takeBack} autoFocus>{copy.play.takeBack}</button>
              <button className="btn ghost" onClick={() => commit(pending!.uci)}>{copy.play.playAnyway}</button>
            </div>
          </div>
        ) : (
          <div className="feedback info" role="status">
            {thinking ? pick(copy.play.thinking) : copy.play.yourTurn}
          </div>
        )}

        {setup.cct && myTurn && (
          <div className="chips">
            {copy.play.cctChips.map((c, i) => (
              <button
                key={c}
                className={`chip ${cct[i] ? 'on' : ''}`}
                aria-pressed={cct[i]}
                onClick={() => setCct(cct.map((v, j) => (j === i ? !v : v)))}
              >
                {cct[i] ? '✓ ' : ''}{c}
              </button>
            ))}
          </div>
        )}

        <p className="muted small">{chess.history().slice(-12).join(' ')}</p>

        <div className="row">
          {!result && (
            <button className="btn danger" onClick={() => setResult('loss')}>{copy.play.resign}</button>
          )}
          {result && chess.history().length > 0 && (
            <button className="btn primary" onClick={review}>{copy.play.review}</button>
          )}
          <button className="btn ghost" onClick={onNew}>{copy.play.newGame}</button>
        </div>
      </aside>
    </div>
  );
}
