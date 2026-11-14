import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader, Section } from '../components/ui';
import { CheckIcon, CrownIcon } from '../components/icons';
import { useLiveQuery } from 'dexie-react-hooks';
import { Chess } from 'chess.js';
import { getSetting, setSetting } from '../srs/db';
import { dayKey } from '../streak';
import { pick } from '../copy';
import { Board, BoardOverlay } from '../chess/Board';
import { playUci } from '../chess/game';
import { getEngine } from '../engine/engine';
import { ENDGAMES, ENDGAME_GROUPS, goalReached, myMoveCount, type Endgame } from '../endgames/positions';
import { endgameCopy as copy } from '../endgames/copy';

/** Endgame id -> local day you last won it. Persisted so wins survive a reload and count for the daily plan. */
export const useEndgameWins = () => useLiveQuery(async () => (await getSetting<Record<string, string>>('endgameWins')) ?? {}, []);

async function recordWin(id: string) {
  const wins = (await getSetting<Record<string, string>>('endgameWins')) ?? {};
  await setSetting('endgameWins', { ...wins, [id]: dayKey(new Date()) });
}

export function Endgames() {
  // /endgames?eg=<id> opens that position directly (the Today plan links here).
  const [params] = useSearchParams();
  const [active, setActive] = useState<{ id: string; n: number } | null>(() => {
    const eg = params.get('eg');
    return eg && ENDGAMES.some((e) => e.id === eg) ? { id: eg, n: 0 } : null;
  });
  const wins = useEndgameWins();
  const solved = new Set(Object.keys(wins ?? {}));
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
        onWin={() => void recordWin(eg.id)}
        onRetry={() => setActive({ id: eg.id, n: Date.now() })}
        onNext={() => setActive({ id: next.id, n: Date.now() })}
        onBack={() => setActive(null)}
      />
    );
  }

  return (
    <div className="eg">
      <PageHeader
        title={copy.title}
        lead={copy.lead}
        actions={<span className="muted small">{copy.solved(ENDGAMES.filter((e) => solved.has(e.id)).length, ENDGAMES.length)}</span>}
      />
      {ENDGAME_GROUPS.map((g) => {
        const list = ENDGAMES.filter((e) => e.group === g);
        return (
          <Section key={g} title={copy.groups[g]} note={`${list.filter((e) => solved.has(e.id)).length} / ${list.length}`}>
            <ul className="rows">
              {list.map((e) => {
                const done = solved.has(e.id);
                return (
                  <li key={e.id}>
                    <button className="row-link eg-row" onClick={() => setActive({ id: e.id, n: Date.now() })}>
                      <span className={`eg-mark${done ? ' done' : ''}`} aria-hidden>{done ? <CheckIcon /> : <CrownIcon />}</span>
                      <span className="row-main">
                        <strong>{e.title}</strong>
                        <span className="muted">{e.tip}</span>
                      </span>
                      <span className="row-end">
                        <span className="eg-goal muted">{copy.goal[e.goal](e.maxMoves)}</span>
                        <span className={`btn small ${done ? 'ghost' : 'primary'}`}>{done ? copy.again : copy.play}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Section>
        );
      })}
    </div>
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
  const [chess] = useState(() => new Chess(eg.fen));
  const [, setFen] = useState(chess.fen());
  const [last, setLast] = useState<[string, string]>();
  const [thinking, setThinking] = useState(false);
  // The engine did not reply: it is still its move, so offer to ask again instead of leaving the board dead.
  const [stuck, setStuck] = useState(false);
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
    setStuck(false);
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
      if (alive.current) setStuck(true);
    } finally {
      if (alive.current) setThinking(false);
    }
  }, [chess, judge]);

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
                <div className="big" aria-hidden>{result === 'win' ? '♔' : '♟'}</div>
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
            <div className="feedback good" role="status">{lines.win}</div>
          ) : result === 'fail' ? (
            <div className="feedback bad" role="alert">{lines.fail} {eg.tip}</div>
          ) : (
            <>
              {stuck ? (
                <div className="feedback bad" role="alert">
                  <div>
                    {copy.engineStuck}
                    <div className="row">
                      <button className="btn small" onClick={() => void engineMove()}>{copy.engineRetry}</button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="feedback info" role="status">
                  {thinking ? pick(copy.thinking) : copy.yourTurn}
                </div>
              )}
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
