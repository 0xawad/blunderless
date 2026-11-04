import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { copy } from '../copy';
import { Board } from '../chess/Board';
import { formatPly, getRepertoire } from '../repertoire';
import { addLine, db } from '../srs/db';
import { useToast } from '../components/Toast';

export function Learn() {
  const { repId = '', index = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const rep = getRepertoire(repId);
  const line = rep?.lines[Number(index)];
  const [ply, setPly] = useState(0); // number of plies played
  const inQueue = useLiveQuery(async () => !!(line && (await db.cards.get(line.id))), [line?.id]);

  useEffect(() => {
    setPly(0);
  }, [line?.id]);

  useEffect(() => {
    const max = line?.plies.length ?? 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setPly((p) => Math.min(max, p + 1));
      if (e.key === 'ArrowLeft') setPly((p) => Math.max(0, p - 1));
      if (e.key === 'Home') setPly(0);
      if (e.key === 'End') setPly(max);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [line]);

  if (!rep || !line) return <p className="empty">{copy.notFound}</p>;

  const last = line.plies[ply - 1];
  const fen = last?.fenAfter ?? line.plies[0].fenBefore;
  const atEnd = ply === line.plies.length;
  const comment = ply === 0 ? rep.chapters.find((c) => c.id === line.chapterId)?.intro : last?.comment;
  const next = rep.lines[Number(index) + 1];

  const drillNow = async () => {
    await addLine(line);
    navigate(`/drill?line=${encodeURIComponent(line.id)}`);
  };

  return (
    <>
      <Link to={`/openings/${rep.id}`} className="back">← {rep.title}</Link>
      <div className="play">
        <Board fen={fen} orientation={rep.side} lastMove={last && [last.from, last.to]} />
        <aside className="card side">
          <p className="eyebrow">{line.chapterTitle}</p>
          <h2>{line.label}</h2>

          <div className="comment">
            {ply > 0 && <strong>{formatPly(ply - 1, last!.san)} </strong>}
            {comment ?? copy.learn.noComment}
          </div>

          <ol className="movelist">
            {line.plies.map((p, i) => (
              <li key={i}>
                <button
                  className={`mv ${i === ply - 1 ? 'on' : ''} ${p.comment ? 'has-note' : ''}`}
                  onClick={() => setPly(i + 1)}
                >
                  {i % 2 === 0 ? formatPly(i, p.san) : p.san}
                </button>
              </li>
            ))}
          </ol>

          <div className="progress" aria-hidden>
            <span style={{ width: `${(ply / line.plies.length) * 100}%` }} />
          </div>
          <div className="row stepper">
            <button className="btn ghost" onClick={() => setPly(0)} aria-label="Start">⏮</button>
            <button className="btn ghost" onClick={() => setPly((p) => Math.max(0, p - 1))} aria-label="Back">◀</button>
            <button className="btn primary" onClick={() => setPly((p) => Math.min(line.plies.length, p + 1))} aria-label="Forward" disabled={atEnd}>▶</button>
            <button className="btn ghost" onClick={() => setPly(line.plies.length)} aria-label="End">⏭</button>
            <span className="hint" style={{ margin: 0 }}>{copy.learn.keys}</span>
          </div>

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
