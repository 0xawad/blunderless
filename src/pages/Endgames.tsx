import { useCallback, useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { pick } from '../copy';
import { Board, BoardOverlay } from '../chess/Board';
import { playUci } from '../chess/game';
import { getEngine } from '../engine/engine';
import { useToast } from '../components/Toast';
import { ENDGAMES, ENDGAME_GROUPS, goalReached, myMoveCount, type Endgame } from '../endgames/positions';
import { endgameCopy as copy } from '../endgames/copy';

// Wins for this session only: survives route changes, forgotten on reload.
const solved = new Set<string>();

export function Endgames() {
  const [active, setActive] = useState<{ id: string; n: number } | null>(null);
  const [, bump] = useState(0);
  const eg = active && ENDGAMES.find((e) => e.id === active.id);

  if (eg && active) {
    const next = (() => {
      const i = ENDGAMES.indexOf(eg);
      const rest = [...ENDGAMES.slice(i + 1), ...ENDGAMES.slice(0, i)];
      return rest.find((e) => !solved.has(e.id)) ?? rest[0];
    })();
    return (
      <EndgameGame
        key={active.n}
        eg={eg}
        onWin={() => {
          solved.add(eg.id);
          bump((x) => x + 1);
        }}
        onRetry={() => setActive({ id: eg.id, n: Date.now() })}
        onNext={() => setActive({ id: next.id, n: Date.now() })}
        onBack={() => setActive(null)}
      />
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{copy.title}</h1>
          <p className="lead">{copy.lead}</p>
        </div>
        <p className="eyebrow">{copy.solved(ENDGAMES.filter((e) => solved.has(e.id)).length, ENDGAMES.length)}</p>
      </div>
      {ENDGAME_GROUPS.map((g) => (
        <section key={g}>
          <h2>{copy.groups[g]}</h2>
          <div className="grid">
            {ENDGAMES.filter((e) => e.group === g).map((e) => (
              <div key={e.id} className="card">
                <p className="eyebrow">
                  {solved.has(e.id) && `${copy.done} `}
                  {copy.goal[e.goal](e.maxMoves)}
                </p>
                <h3>{e.title}</h3>
                <p className="muted small">{e.tip}</p>
                <button
                  className={`btn ${solved.has(e.id) ? 'ghost' : 'primary'} small`}
                  onClick={() => setActive({ id: e.id, n: Date.now() })}
                >
                  {solved.has(e.id) ? copy.again : copy.play}
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function EndgameGame({
  eg,
  onWin,
  onRetry,
  onNext,
  onBack,
}: {
  eg: Endgame;
  onWin: () => void;
  onRetry: () => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const toast = useToast();
  const [chess] = useState(() => new Chess(eg.fen));
  const [, setFen] = useState(chess.fen());
  const [last, setLast] = useState<[string, string]>();
  const [thinking, setThinking] = useState(false);
  const [result, setResult] = useState<'win' | 'fail' | null>(null);
  const [lines] = useState(() => ({ win: pick(copy.win[eg.goal]), fail: pick(copy.fail) }));
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => void (alive.current = false);
  }, []);

  const mine = eg.side[0];
  const sync = () => setFen(chess.fen());

  const judge = useCallback(() => {
    const r = goalReached(chess, eg);
    if (r) {
      setResult(r);
      if (r === 'win') onWin();
    }
    return r;
  }, [chess, eg, onWin]);

  const engineMove = useCallback(async () => {
    setThinking(true);
    try {
      // Full strength: endgame defence should be stubborn.
      const r = await getEngine().search(chess.fen(), { depth: 10 });
      if (!alive.current) return;
      const m = r.bestmove ? playUci(chess, r.bestmove) : null;
      if (m) setLast([m.from, m.to]);
      sync();
      judge();
    } catch {
      if (alive.current) toast(copy.engineFailed, 'bad');
    } finally {
      if (alive.current) setThinking(false);
    }
  }, [chess, judge, toast]);

  // Every position starts with you to move, but guard anyway. The ref stops
  // StrictMode's double mount from asking twice.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    if (chess.turn() !== mine && !chess.isGameOver()) engineMove();
  }, [chess, mine, engineMove]);

  const onMove = (from: string, to: string, promotion?: string) => {
    const m = playUci(chess, from + to + (promotion ?? ''));
    if (!m) return sync();
    setLast([m.from, m.to]);
    sync();
    if (!judge()) engineMove();
  };

  const myTurn = chess.turn() === mine && !result && !thinking;
  const moves = myMoveCount(chess, eg);

  return (
    <>
      <button className="btn ghost small" onClick={onBack} style={{ marginBottom: '0.8rem' }}>
        {copy.back}
      </button>
      <div className="play">
        <Board
          fen={chess.fen()}
          orientation={eg.side}
          interactive={myTurn}
          lastMove={last}
          onMove={onMove}
          overlay={
            result ? (
              <BoardOverlay>
                <div className="big" aria-hidden>{result === 'win' ? '🏆' : '♟'}</div>
                <h2>{result === 'win' ? lines.win : lines.fail}</h2>
                {result === 'fail' && <p className="muted">{eg.tip}</p>}
                <div className="row">
                  {result === 'win' ? (
                    <button className="btn primary" onClick={onNext} autoFocus>{copy.next}</button>
                  ) : (
                    <button className="btn primary" onClick={onRetry} autoFocus>{copy.retry}</button>
                  )}
                  <button className="btn ghost" onClick={onBack}>{copy.another}</button>
                </div>
              </BoardOverlay>
            ) : null
          }
        />
        <aside className="card side">
          <p className="eyebrow">
            {copy.side(eg.side)} · {copy.goal[eg.goal](eg.maxMoves)}
          </p>
          <h2>{eg.title}</h2>

          <p className="muted small">{copy.moves(Math.min(moves, eg.maxMoves), eg.maxMoves)}</p>
          <div className="progress">
            <span style={{ width: `${Math.min(100, (moves / eg.maxMoves) * 100)}%` }} />
          </div>

          {result === 'win' ? (
            <div className="feedback good" role="status">
              {lines.win}
              <div className="row">
                <button className="btn primary" onClick={onNext} autoFocus>{copy.next}</button>
                <button className="btn ghost" onClick={onBack}>{copy.another}</button>
              </div>
            </div>
          ) : result === 'fail' ? (
            <div className="feedback bad" role="alert">
              {lines.fail} {eg.tip}
              <div className="row">
                <button className="btn primary" onClick={onRetry} autoFocus>{copy.retry}</button>
                <button className="btn ghost" onClick={onBack}>{copy.another}</button>
              </div>
            </div>
          ) : (
            <>
              <div className="feedback info" role="status">
                {thinking ? pick(copy.thinking) : copy.yourTurn}
              </div>
              <p className="hint">
                <strong>{copy.tipLabel}:</strong> {eg.tip}
              </p>
            </>
          )}

          <p className="muted small">{chess.history().slice(-12).join(' ')}</p>

          {!result && (
            <div className="row">
              <button className="btn ghost" onClick={onRetry}>{copy.restart}</button>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
