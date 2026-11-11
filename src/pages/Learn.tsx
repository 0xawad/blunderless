import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import { copy, pick } from '../copy';
import { Board } from '../chess/Board';
import { formatPly, getRepertoire } from '../repertoire';
import { addLine, db } from '../srs/db';
import { useToast } from '../components/Toast';
import { play as sfx } from '../sound';

const THINK_KEY = 'learn-think-first';
const readThink = () => {
  try {
    return localStorage.getItem(THINK_KEY) !== 'off';
  } catch {
    return true;
  }
};

export function Learn() {
  const { repId = '', index = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const rep = getRepertoire(repId);
  const line = rep?.lines[Number(index)];
  const [ply, setPly] = useState(-1); // number of plies played; -1 until the line's start is set
  const [think, setThink] = useState(readThink);
  const [misses, setMisses] = useState(0);
  const [quizMsg, setQuizMsg] = useState<{ tone: 'good' | 'bad' | 'info'; text: string } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const inQueue = useLiveQuery(async () => !!(line && (await db.cards.get(line.id))), [line?.id]);

  const mine = (color: 'w' | 'b') => (color === 'w') === (rep?.side === 'white');

  // Lines in a chapter share their opening moves. Start where this one branches
  // off the earlier lines instead of replaying moves you just learned.
  const branchAt = (() => {
    if (!rep || !line) return 0;
    let best = 0;
    for (const other of rep.lines.slice(0, Number(index))) {
      let i = 0;
      while (i < line.plies.length - 1 && other.plies[i]?.san === line.plies[i].san) i++;
      best = Math.max(best, i);
    }
    return best >= 4 ? best : 0;
  })();
  const pending = line?.plies[ply]; // the move that comes next
  const yourTurn = think && !!pending && mine(pending.color);

  useEffect(() => {
    setPly(branchAt);
    setMisses(0);
    setQuizMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line?.id]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // In think-first mode the opponent's moves play themselves.
  useEffect(() => {
    if (!think || !pending || mine(pending.color)) return;
    timer.current = window.setTimeout(() => setPly((p) => p + 1), ply === 0 ? 400 : 700);
    return () => window.clearTimeout(timer.current);
  }, [think, ply, line?.id]);

  useEffect(() => {
    const max = line?.plies.length ?? 0;
    const onKey = (e: KeyboardEvent) => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
      // Same reset as the on-screen stepper, so the next move is quizzed, not shown already revealed.
      setMisses(0);
      setQuizMsg(null);
      if (e.key === 'ArrowRight') setPly((p) => Math.min(max, p + 1));
      if (e.key === 'ArrowLeft') setPly((p) => Math.max(0, p - 1));
      if (e.key === 'Home') setPly(0);
      if (e.key === 'End') setPly(max);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [line]);

  if (!rep || !line) return <p className="empty">{copy.notFound}</p>;
  if (ply < 0) return null;

  const last = line.plies[ply - 1];
  const fen = last?.fenAfter ?? line.plies[0].fenBefore;
  const atEnd = ply === line.plies.length;
  const chapter = rep.chapters.find((c) => c.id === line.chapterId);
  const comment = ply === 0 ? chapter?.intro : last?.comment;
  const revealed = misses >= 2;
  const shapes: DrawShape[] = revealed && pending
    ? [{ orig: pending.from as Key, dest: pending.to as Key, brush: 'green' }]
    : ((last?.shapes ?? []) as DrawShape[]);
  const next = rep.lines[Number(index) + 1];

  const step = (p: number) => {
    setPly(p);
    setMisses(0);
    setQuizMsg(null);
  };

  const toggleThink = () => {
    const v = !think;
    setThink(v);
    setMisses(0);
    setQuizMsg(null);
    try {
      localStorage.setItem(THINK_KEY, v ? 'on' : 'off');
    } catch {
      /* private mode */
    }
  };

  const onMove = (from: string, to: string) => {
    if (!pending || !yourTurn) return;
    if (pending.from === from && pending.to === to) {
      setQuizMsg({ tone: 'good', text: pick(copy.learn.right) });
      step(ply + 1);
      setQuizMsg({ tone: 'good', text: pick(copy.learn.right) });
      return;
    }
    const n = misses + 1;
    setMisses(n);
    sfx('wrong');
    setQuizMsg({ tone: 'bad', text: n >= 2 ? copy.learn.reveal(pending.san) : pick(copy.learn.wrong) });
  };

  const drillNow = async () => {
    await addLine(line);
    navigate(`/drill?line=${encodeURIComponent(line.id)}`);
  };

  return (
    <>
      <Link to={`/openings/${rep.id}`} className="back">← {rep.title}</Link>
      <div className="play">
        <Board
          fen={fen}
          orientation={rep.side}
          lastMove={last && [last.from, last.to]}
          shapes={shapes}
          interactive={yourTurn}
          onMove={onMove}
        />
        <aside className="card side">
          <div className="page-head" style={{ marginBottom: '0.2rem' }}>
            <div>
              <p className="eyebrow">{line.chapterTitle}</p>
              <h2>{line.label}</h2>
            </div>
            <button className={`chip ${think ? 'on' : ''}`} aria-pressed={think} onClick={toggleThink} title={copy.learn.thinkHint}>
              {copy.learn.think}
            </button>
          </div>

          {branchAt > 0 && ply === branchAt && !quizMsg && (
            <p className="muted small">{copy.learn.skipped(Math.floor(branchAt / 2) + 1)}</p>
          )}
          {yourTurn && (
            <div className={`feedback ${quizMsg?.tone ?? 'info'}`} role="status">
              {quizMsg?.text ?? copy.learn.yourMove}
            </div>
          )}
          {!yourTurn && quizMsg?.tone === 'good' && <div className="feedback good" role="status">{quizMsg.text}</div>}

          <div className={`comment ${comment || ply === 0 ? '' : 'empty'}`}>
            {ply > 0 && <strong>{formatPly(ply - 1, last!.san)} </strong>}
            {comment}
          </div>

          <ol className="movelist">
            {line.plies.map((p, i) => {
              const hidden = think && i >= ply && !atEnd;
              return (
                <li key={i}>
                  <button
                    className={`mv ${i === ply - 1 ? 'on' : ''} ${p.comment || p.shapes ? 'has-note' : ''} ${hidden ? 'hidden-mv' : ''}`}
                    onClick={() => step(i + 1)}
                    disabled={hidden}
                  >
                    {hidden ? (i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ?` : '?') : i % 2 === 0 ? formatPly(i, p.san) : p.san}
                  </button>
                </li>
              );
            })}
          </ol>

          <div className="progress" aria-hidden>
            <span style={{ width: `${(ply / line.plies.length) * 100}%` }} />
          </div>
          <div className="row stepper">
            <button className="btn ghost" onClick={() => step(0)} aria-label="Start">⏮</button>
            <button className="btn ghost" onClick={() => step(Math.max(0, ply - 1))} aria-label="Back">◀</button>
            <button className={`btn ${yourTurn ? 'ghost wide' : 'primary'}`} onClick={() => step(Math.min(line.plies.length, ply + 1))} aria-label="Forward" disabled={atEnd}>
              {yourTurn ? copy.learn.showMe : '▶'}
            </button>
            <button className="btn ghost" onClick={() => step(line.plies.length)} aria-label="End">⏭</button>
            <span className="hint" style={{ margin: 0 }}>{copy.learn.keys}</span>
          </div>

          {atEnd && chapter?.plans && (
            <div className="comment">
              <strong>What now: </strong>
              {chapter.plans}
            </div>
          )}

          {atEnd && (
            <div className="end-box">
              <p>{inQueue ? copy.learn.added : copy.learn.endOfLine}</p>
              <div className="row">
                <button className="btn primary" onClick={drillNow}>{copy.learn.drillNow}</button>
                {!inQueue && (
                  <button className="btn ghost" onClick={() => addLine(line).then(() => toast(copy.learn.added, 'good'))}>
                    {copy.learn.addToDrill}
                  </button>
                )}
                <Link
                  className="btn ghost"
                  to={`/play?fen=${encodeURIComponent(line.plies[line.plies.length - 1].fenAfter)}&color=${rep.side}`}
                >
                  {copy.learn.playOut}
                </Link>
                {next && (
                  <Link className="btn ghost" to={`/learn/${rep.id}/${Number(index) + 1}`}>Next line →</Link>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
