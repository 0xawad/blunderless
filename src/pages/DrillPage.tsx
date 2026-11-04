import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import { Rating } from 'ts-fsrs';
import { copy, pick } from '../copy';
import { Board } from '../chess/Board';
import { getLine, getRepertoire, type Line } from '../repertoire';
import { Drill } from '../srs/drill';
import { db, dueLines, recordReview } from '../srs/db';

type Feedback = { tone: 'good' | 'bad' | 'info'; text: string };
const OPPONENT_DELAY = 450;

export function DrillPage() {
  const [params] = useSearchParams();
  const [queue, setQueue] = useState<Line[] | null>(null);
  const [practice, setPractice] = useState(false);
  const [pos, setPos] = useState(0);
  const [results, setResults] = useState<number[]>([]); // grades

  const load = useCallback(async () => {
    const one = params.get('line');
    const rep = params.get('rep');
    if (one) {
      const l = getLine(one);
      setQueue(l ? [l] : []);
      return;
    }
    const due = await dueLines();
    setQueue(rep ? due.filter((l) => l.repertoireId === rep) : due);
  }, [params]);

  useEffect(() => {
    setPos(0);
    setResults([]);
    setPractice(false);
    load();
  }, [load]);

  const startPractice = async () => {
    const known = (await db.cards.toArray()).map((c) => getLine(c.lineId)).filter((l): l is Line => !!l);
    const shuffled = known.sort(() => Math.random() - 0.5).slice(0, 5);
    setPractice(true);
    setPos(0);
    setResults([]);
    setQueue(shuffled);
  };

  if (queue === null) return null;

  if (queue.length === 0) {
    return (
      <section className="card empty-state">
        <h1>{copy.drill.emptyTitle}</h1>
        <p className="lead">{copy.drill.emptyBody}</p>
        <div className="row">
          <button className="btn primary" onClick={startPractice}>{copy.drill.practice}</button>
          <Link to="/openings" className="btn ghost">{copy.home.learnCta}</Link>
        </div>
      </section>
    );
  }

  if (pos >= queue.length) {
    const perfect = results.filter((r) => r === Rating.Good).length;
    return (
      <section className="card empty-state">
        <div className="big-emoji" aria-hidden>{perfect === results.length ? '🏆' : '♟'}</div>
        <h1>Session done</h1>
        <p className="lead">{copy.drill.sessionDone(results.length, perfect)}</p>
        <div className="row">
          <Link to="/" className="btn primary">Home</Link>
          <button className="btn ghost" onClick={startPractice}>{copy.drill.practice}</button>
        </div>
      </section>
    );
  }

  return (
    <DrillRun
      key={`${pos}-${queue[pos].id}`}
      line={queue[pos]}
      counter={`${pos + 1} / ${queue.length}${practice ? ' · practice' : ''}`}
      onFinish={async (d) => {
        if (!practice) await recordReview(d.line.id, d.grade(), d.mistakes);
        setResults((r) => [...r, d.grade()]);
      }}
      onNext={() => setPos((p) => p + 1)}
    />
  );
}

function DrillRun({
  line,
  counter,
  onFinish,
  onNext,
}: {
  line: Line;
  counter: string;
  onFinish: (d: Drill) => void;
  onNext: () => void;
}) {
  const rep = getRepertoire(line.repertoireId)!;
  const drill = useMemo(() => new Drill(line, rep.side), [line, rep.side]);
  const [, rerender] = useState(0);
  const [feedback, setFeedback] = useState<Feedback>({ tone: 'info', text: copy.drill.yourMove });
  const [shapes, setShapes] = useState<DrawShape[]>([]);
  const finished = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const tick = () => rerender((n) => n + 1);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const afterMove = useCallback(() => {
    if (drill.done) {
      if (!finished.current) {
        finished.current = true;
        const g = drill.grade();
        setFeedback({
          tone: g === Rating.Good ? 'good' : g === Rating.Hard ? 'info' : 'bad',
          text: pick(g === Rating.Good ? copy.drill.perfect : g === Rating.Hard ? copy.drill.shaky : copy.drill.failed),
        });
        onFinish(drill);
      }
      tick();
      return;
    }
    if (!drill.isUserTurn) {
      tick();
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        if (drill.done || drill.isUserTurn) return;
        drill.playOpponent();
        if (drill.index === 1) setFeedback({ tone: 'info', text: copy.drill.yourMove });
        afterMove();
      }, OPPONENT_DELAY);
    } else {
      tick();
    }
  }, [drill, onFinish]);

  // Black lines open with the opponent's move.
  useEffect(() => {
    if (!drill.isUserTurn && drill.index === 0) {
      setFeedback({ tone: 'info', text: copy.drill.theirMove });
      afterMove();
    }
  }, [drill, afterMove]);

  const onMove = (from: string, to: string) => {
    if (!drill.isUserTurn) return;
    const result = drill.attempt(from, to);
    if (result === 'correct') {
      setShapes([]);
      setFeedback({ tone: 'good', text: pick(copy.drill.correct) });
      afterMove();
      return;
    }
    if (drill.revealed) {
      const p = drill.current!;
      setShapes([{ orig: p.from as Key, dest: p.to as Key, brush: 'green' }]);
      setFeedback({ tone: 'bad', text: copy.drill.revealed });
    } else {
      setFeedback({ tone: 'bad', text: pick(copy.drill.wrong) });
    }
    tick();
  };

  const hint = () => {
    const p = drill.hint();
    if (p) setShapes([{ orig: p.from as Key, brush: 'yellow' }]);
    tick();
  };

  const last = drill.previous;

  return (
    <div className="play">
      <Board
        fen={drill.fen}
        orientation={rep.side}
        interactive={!drill.done && drill.isUserTurn}
        lastMove={last && [last.from, last.to]}
        shapes={shapes}
        onMove={onMove}
      />
      <aside className="card side">
        <p className="eyebrow">{counter}</p>
        <h2>{rep.title}</h2>
        <p className="muted">{line.chapterTitle} · {line.label}</p>

        <div className={`feedback ${feedback.tone}`} role="status" aria-live="polite">
          {feedback.text}
        </div>

        {last?.comment && drill.done && <div className="comment">{last.comment}</div>}

        <div className="row">
          {!drill.done && (
            <button className="btn ghost" onClick={hint} disabled={!drill.isUserTurn}>
              {copy.drill.hint}
            </button>
          )}
          {drill.done && (
            <button className="btn primary" onClick={onNext} autoFocus>
              {copy.drill.next}
            </button>
          )}
        </div>
        <div className="progress" aria-hidden>
          <span style={{ width: `${(Math.min(drill.index, line.plies.length) / line.plies.length) * 100}%` }} />
        </div>
        <p className="hint">
          Move {Math.min(drill.index + 1, line.plies.length)} of {line.plies.length} · mistakes: {drill.mistakes}
        </p>
      </aside>
    </div>
  );
}
