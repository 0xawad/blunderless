import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import { copy } from '../copy';
import { Board } from '../chess/Board';
import { parseGamePgn, uciToSan } from '../chess/game';
import { START_FEN, formatPly, getLine, getRepertoire } from '../repertoire';
import { db } from '../srs/db';
import { analyzeStoredGame } from '../games/store';
import { BookChip } from './Games';
import { useToast } from '../components/Toast';

const MARK: Record<string, string> = { blunder: '??', mistake: '?', inaccuracy: '?!' };

export function GameReview() {
  const { id = '' } = useParams();
  const game = useLiveQuery(() => db.games.get(id), [id]);
  const toast = useToast();
  const plies = useMemo(() => {
    try {
      return game ? parseGamePgn(game.pgn) : [];
    } catch {
      return null; // chess.js rejected the PGN; show the game header, not a white screen
    }
  }, [game?.pgn]);
  const [ply, setPly] = useState(0);
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setPly((p) => Math.min(plies?.length ?? 0, p + 1));
      if (e.key === 'ArrowLeft') setPly((p) => Math.max(0, p - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [plies?.length]);

  if (game === undefined) return null;
  if (!game) return <p className="empty">{copy.notFound}</p>;
  if (!plies) return <p className="empty">{copy.games.badPgn}</p>;

  const a = game.analysis;
  const mine = game.userColor === 'white' ? 'w' : 'b';
  const last = plies[ply - 1];
  const fen = last?.fenAfter ?? plies[0]?.fenBefore ?? START_FEN;
  const review = ply > 0 ? a?.moves[ply - 1] : undefined;
  const nextReview = a?.moves[ply];
  const shapes: DrawShape[] = [];
  if (nextReview?.best && plies[ply]?.color === mine && nextReview.kind) {
    shapes.push({ orig: nextReview.best.slice(0, 2) as Key, dest: nextReview.best.slice(2, 4) as Key, brush: 'green' });
  }

  const evalCp = a ? a.evals[ply] : undefined;
  const evalText =
    evalCp === undefined ? '' : Math.abs(evalCp) >= 9000 ? (evalCp > 0 ? '+M' : '-M') : (evalCp / 100).toFixed(1);
  const bookLine = game.book?.lineId ? getLine(game.book.lineId) : undefined;
  const bookRep = bookLine ? getRepertoire(bookLine.repertoireId) : undefined;
  const mistakes = a ? plies.map((p, i) => ({ p, i, r: a.moves[i] })).filter((x) => x.r.kind) : [];
  const b = game.book;

  const run = async () => {
    setProgress(0);
    try {
      const made = await analyzeStoredGame(game.id, setProgress);
      toast(copy.games.madePuzzles(made), made ? 'neutral' : 'good');
    } catch {
      toast(copy.engine.failed, 'bad');
    } finally {
      setProgress(null);
    }
  };
  const evalHeight = `${50 + Math.max(-48, Math.min(48, (evalCp ?? 0) / 20))}%`;

  return (
    <>
      <Link to="/games" className="back">← Games</Link>
      <div className="play">
        <div className="board-col">
          {a && (
            <div className="evalbar-v" aria-label={`Evaluation ${evalText}`} style={game.userColor === 'black' ? { transform: 'scaleY(-1)' } : undefined}>
              <span style={{ height: evalHeight }} />
              <b className={evalCp !== undefined && evalCp >= 0 ? 'bottom' : 'top'} style={game.userColor === 'black' ? { transform: 'scaleY(-1)' } : undefined}>
                {evalText.replace('-', '')}
              </b>
            </div>
          )}
          <Board fen={fen} orientation={game.userColor} lastMove={last && [last.from, last.to]} shapes={shapes} />
        </div>
        <aside className="card side">
          <p className="eyebrow">
            {game.white} vs {game.black} · {game.result}
          </p>
          {b && (
            <div className="comment">
              <BookChip game={game} />{' '}
              {b.status === 'you-deviated'
                ? copy.book['you-deviated'](Math.floor(b.ply / 2) + 1, b.played!, b.expected!)
                : b.status === 'they-deviated'
                  ? copy.book['they-deviated'](Math.floor(b.ply / 2) + 1, b.played!)
                  : copy.book['end-of-prep'](Math.floor(b.ply / 2) + 1)}
              {bookLine && bookRep && (
                <>
                  {' '}
                  <Link to={`/learn/${bookRep.id}/${bookRep.lines.indexOf(bookLine)}`}>Review the line →</Link>
                </>
              )}
            </div>
          )}

          {!a && (
            <div className="row">
              <button className="btn primary" onClick={run} disabled={progress !== null}>
                {progress === null ? copy.games.analyze : copy.games.analyzing(Math.round(progress * 100))}
              </button>
            </div>
          )}

          {review?.kind && (
            <div className="feedback bad">
              {copy.kinds[review.kind].label}. {copy.kinds[review.kind].roast} Best was{' '}
              {uciToSan(plies[ply - 1].fenBefore, review.best)}.
            </div>
          )}

          {mistakes.length > 0 && (
            <ul className="mistakes">
              {mistakes.map(({ p, i, r }) => (
                <li key={i}>
                  <button className="mv" onClick={() => setPly(i)}>
                    <strong>{formatPly(i, p.san)}{MARK[r.cls]}</strong> {copy.kinds[r.kind!].label}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <ol className="movelist">
            {plies.map((p, i) => {
              const cls = a?.moves[i]?.cls;
              return (
                <li key={i}>
                  <button className={`mv ${i === ply - 1 ? 'on' : ''} ${p.color === mine && cls ? cls : ''}`} onClick={() => setPly(i + 1)}>
                    {i % 2 === 0 ? formatPly(i, p.san) : p.san}
                    {p.color === mine && cls && MARK[cls]}
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="row stepper">
            <button className="btn ghost" onClick={() => setPly(0)} aria-label="Start">⏮</button>
            <button className="btn ghost" onClick={() => setPly((x) => Math.max(0, x - 1))} aria-label="Back">◀</button>
            <button className="btn ghost" onClick={() => setPly((x) => Math.min(plies.length, x + 1))} aria-label="Forward">▶</button>
            <button className="btn ghost" onClick={() => setPly(plies.length)} aria-label="End">⏭</button>
          </div>
          {a && <p className="hint">Accuracy {a.accuracy}% · depth {a.depth} · green arrow = what you should've played</p>}
          {game.url && (
            <p className="hint">
              <a href={game.url} target="_blank" rel="noopener noreferrer">Open on Chess.com ↗</a>
            </p>
          )}
        </aside>
      </div>
    </>
  );
}
