// Two ways to get an opening into your hands without memorising a list of lines:
//  - Explore: walk the whole repertoire as one tree. Every position shows your
//    move, the replies you need to know, and why.
//  - Spar: play it like a game. The app picks the opponent's replies (leaning
//    toward lines you haven't nailed yet), you answer from memory. Finishing a
//    line updates its drill schedule.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import { Rating } from 'ts-fsrs';
import { copy, pick } from '../copy';
import { Board } from '../chess/Board';
import { START_FEN, formatPly, getLine, getRepertoire, type Repertoire } from '../repertoire';
import { lineForWalk, nodeAt, pickReply, repertoireTree, type RepTree, type TreeMove } from '../repertoire/tree';
import { addLine, recordReview, setSetting, statusOf, type CardRow } from '../srs/db';
import { dayKey } from '../streak';
import { useCards } from '../components/ui';
import { play as sfx } from '../sound';

type Mode = 'explore' | 'spar';
const OPP_DELAY = 550;

const isMine = (rep: Repertoire, fen: string) => (fen.split(' ')[1] === 'w') === (rep.side === 'white');
const fenOf = (path: TreeMove[]) => path[path.length - 1]?.fenAfter ?? START_FEN;
const arrow = (m: { from: string; to: string }, brush: string): DrawShape => ({ orig: m.from as Key, dest: m.to as Key, brush });

/** Replays ?moves=e4,c6,d4 through the tree; stops at the first move it doesn't know. */
function pathFromSans(tree: RepTree, sans: string[]): TreeMove[] {
  const out: TreeMove[] = [];
  for (const san of sans) {
    const m = nodeAt(tree, fenOf(out))?.moves.find((x) => x.san === san);
    if (!m) break;
    out.push(m);
  }
  return out;
}

/** The chapter a branch belongs to, or how many it spans. */
function chapterOf(lineIds: string[]): string | undefined {
  const titles = new Set(lineIds.map((id) => getLine(id)?.chapterTitle).filter(Boolean));
  if (titles.size === 1) return [...titles][0];
  return titles.size > 1 ? `${titles.size} chapters` : undefined;
}

export function OpeningMap() {
  const { repId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const rep = getRepertoire(repId);
  const mode: Mode = params.get('mode') === 'spar' ? 'spar' : 'explore';
  const cards = useCards();
  if (!rep) return <p className="empty">{copy.notFound}</p>;
  const tree = repertoireTree(rep);

  const setMode = (m: Mode) => {
    const next = new URLSearchParams(params);
    next.set('mode', m);
    next.delete('moves');
    setParams(next, { replace: true });
  };

  return (
    <>
      <div className="map-head">
        <Link to={`/openings/${rep.id}`} className="back">← {rep.title}</Link>
        <div className="tabs compact mode-tabs" role="tablist" aria-label={copy.map.modeLabel}>
          {(['explore', 'spar'] as Mode[]).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
              {copy.map.modes[m]}
            </button>
          ))}
        </div>
      </div>
      {mode === 'explore' ? (
        <Explore key={rep.id} tree={tree} cards={cards} start={params.get('moves')?.split(',').filter(Boolean) ?? []} />
      ) : (
        <Spar key={rep.id} tree={tree} cards={cards} />
      )}
    </>
  );
}

function MovePath({ path, onJump, empty }: { path: TreeMove[]; onJump?: (n: number) => void; empty: string }) {
  if (!path.length) return <p className="muted small">{empty}</p>;
  return (
    <ol className="movelist compact-moves">
      {path.map((m, i) => (
        <li key={i}>
          <button className={`mv ${i === path.length - 1 ? 'on' : ''}`} onClick={() => onJump?.(i + 1)} disabled={!onJump}>
            {i % 2 === 0 ? formatPly(i, m.san) : m.san}
          </button>
        </li>
      ))}
    </ol>
  );
}

function Explore({ tree, cards, start }: { tree: RepTree; cards?: Map<string, CardRow>; start: string[] }) {
  const rep = tree.rep;
  const navigate = useNavigate();
  const [path, setPath] = useState<TreeMove[]>(() => pathFromSans(tree, start));
  const [note, setNote] = useState<{ tone: 'bad' | 'info'; text: string } | null>(null);
  const fen = fenOf(path);
  const node = nodeAt(tree, fen);
  const moves = node?.moves ?? [];
  const mine = isMine(rep, fen);
  const last = path[path.length - 1];

  const go = useCallback((p: TreeMove[]) => {
    setPath(p);
    setNote(null);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, select, textarea')) return;
      if (e.key === 'ArrowLeft') go(path.slice(0, -1));
      if (e.key === 'ArrowRight' && moves[0]) go([...path, moves[0]]);
      if (e.key === 'Home') go([]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [path, moves, go]);

  const onMove = (from: string, to: string) => {
    const m = moves.find((x) => x.from === from && x.to === to);
    if (m) return go([...path, m]);
    setNote(mine ? { tone: 'bad', text: copy.map.notYourMove } : { tone: 'info', text: copy.map.notCovered });
    sfx('wrong');
  };

  // Lines through this position: any line that plays one of its moves or ends here.
  const lineIds = useMemo(() => [...new Set([...moves.flatMap((m) => m.lineIds), ...(node?.endsHere ?? [])])], [moves, node]);
  const learned = lineIds.filter((id) => cards?.has(id)).length;
  const firstNew = lineIds.find((id) => !cards?.has(id));
  const lineIndex = (id: string) => rep.lines.findIndex((l) => l.id === id);

  const shapes: DrawShape[] = [
    ...((last?.shapes ?? []) as DrawShape[]),
    ...(mine ? moves.slice(0, 1).map((m) => arrow(m, 'green')) : moves.slice(0, 5).map((m, i) => arrow(m, i === 0 ? 'blue' : 'paleBlue'))),
  ];
  // Uncommented moves early on: show the chapter's intro once every line here shares a chapter.
  const chapterHere = chapterOf(lineIds);
  const introHere = !last?.comment && path.length <= 6 ? rep.chapters.find((c) => c.title === chapterHere)?.intro : undefined;
  const leaf = !moves.length;
  const endLine = leaf ? getLine(node?.endsHere[0] ?? '') : undefined;
  const chapter = endLine ? rep.chapters.find((c) => c.id === endLine.chapterId) : undefined;

  return (
    <div className="play">
      <Board fen={fen} orientation={rep.side} interactive lastMove={last && [last.from, last.to]} shapes={shapes} onMove={onMove} />
      <aside className="card side">
        <p className="eyebrow">{copy.map.exploreEyebrow(rep.title)}</p>
        <MovePath path={path} onJump={(n) => go(path.slice(0, n))} empty={copy.map.startPosition} />

        {(!last || last.comment || introHere) && (
          <div className="comment">
            {last ? (
              <>
                <strong>{formatPly(path.length - 1, last.san)} </strong>
                {last.comment ?? introHere}
              </>
            ) : (
              copy.map.rootIntro(rep.side)
            )}
          </div>
        )}

        {note && <div className={`feedback ${note.tone}`} role="status">{note.text}</div>}

        {!leaf && (
          <div className="branches">
            <p className="eyebrow">{mine ? copy.map.yourMove : copy.map.theirReplies(moves.length)}</p>
            <ul>
              {moves.map((m, i) => (
                <li key={m.san}>
                  <button className={`branch ${mine ? 'mine' : ''}`} onClick={() => go([...path, m])}>
                    <strong>{formatPly(path.length, m.san)}</strong>
                    <span className="muted small">
                      {i === 0 && !mine ? `${copy.map.mostCommon} · ` : ''}
                      {copy.map.lines(m.lineIds.length)}
                      {chapterOf(m.lineIds) && ` · ${chapterOf(m.lineIds)}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {leaf && (
          <div className="end-box">
            <p><strong>{copy.map.endOfPrep}</strong></p>
            {chapter?.plans && <p className="muted">{chapter.plans}</p>}
            <div className="row">
              <Link className="btn primary" to={`/play?fen=${encodeURIComponent(fen)}&color=${rep.side}`}>{copy.learn.playOut}</Link>
              {endLine && (
                <Link className="btn ghost" to={`/learn/${rep.id}/${lineIndex(endLine.id)}`}>{copy.map.learnThis}</Link>
              )}
            </div>
          </div>
        )}

        <div className="row stepper">
          <button className="btn ghost" onClick={() => go([])} aria-label="Start" disabled={!path.length}>⏮</button>
          <button className="btn ghost" onClick={() => go(path.slice(0, -1))} aria-label="Back" disabled={!path.length}>◀</button>
          <button className="btn ghost" onClick={() => moves[0] && go([...path, moves[0]])} aria-label="Main line" disabled={leaf}>▶</button>
          <span className="hint" style={{ margin: 0 }}>{copy.map.keys}</span>
        </div>

        {lineIds.length > 0 && (
          <p className="muted small">
            {copy.map.coverage(lineIds.length, learned)}{' '}
            {firstNew && (
              <button className="linklike" onClick={() => navigate(`/learn/${rep.id}/${lineIndex(firstNew)}`)}>
                {copy.map.learnNext}
              </button>
            )}
          </p>
        )}
      </aside>
    </div>
  );
}

interface SparResult {
  lineId?: string;
  mistakes: number;
  perfect: boolean;
}

function Spar({ tree, cards }: { tree: RepTree; cards?: Map<string, CardRow> }) {
  const rep = tree.rep;
  const [path, setPath] = useState<TreeMove[]>([]);
  const [misses, setMisses] = useState(0); // on the current move
  const [failed, setFailed] = useState<number[]>([]); // plies you missed this run
  const [hinted, setHinted] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad' | 'info'; text: string }>({ tone: 'info', text: copy.map.sparStart });
  const [result, setResult] = useState<SparResult | null>(null);
  const [session, setSession] = useState({ lines: 0, perfect: 0 });
  const timer = useRef<number | undefined>(undefined);
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  const fen = fenOf(path);
  const node = nodeAt(tree, fen);
  const moves = node?.moves ?? [];
  const mine = isMine(rep, fen);
  const last = path[path.length - 1];
  const want = mine ? moves[0] : undefined;

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Due, weak and never-seen lines come up more often; known ones still appear.
  const weight = useCallback((lineId: string) => {
    const row = cardsRef.current?.get(lineId);
    const st = statusOf(row);
    return st === 'due' ? 4 : st === 'new' ? 3 : st === 'learning' ? 2 : 1;
  }, []);

  const finish = useCallback(
    async (p: TreeMove[], missedOnPath: number[]) => {
      const { line, missed } = lineForWalk(tree, p, missedOnPath);
      const mistakes = missedOnPath.length;
      setResult({ lineId: line?.id, mistakes, perfect: mistakes === 0 });
      setSession((s) => ({ lines: s.lines + 1, perfect: s.perfect + (mistakes === 0 ? 1 : 0) }));
      setMsg({ tone: mistakes ? 'info' : 'good', text: pick(mistakes ? copy.drill.shaky : copy.drill.perfect) });
      sfx(mistakes ? 'move' : 'correct');
      await setSetting('lastSpar', dayKey(new Date()));
      if (line) {
        await addLine(line);
        await recordReview(line.id, mistakes === 0 ? Rating.Good : mistakes === 1 ? Rating.Hard : Rating.Again, mistakes, missed);
      }
    },
    [tree],
  );

  // The opponent plays itself; the end of the tree ends the run.
  useEffect(() => {
    if (result) return;
    if (!moves.length) {
      if (path.length) void finish(path, failed);
      return;
    }
    if (mine) return;
    timer.current = window.setTimeout(() => {
      const reply = pickReply(moves, weight);
      setPath((p) => [...p, reply]);
      if (reply.comment) setMsg({ tone: 'info', text: reply.comment });
    }, path.length ? OPP_DELAY : 300);
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, result]);

  const onMove = (from: string, to: string, promotion?: string) => {
    if (!want || result) return;
    if (want.from === from && want.to === to && (!promotion || want.uci.slice(4) === promotion)) {
      setPath([...path, want]);
      setMisses(0);
      setHinted(false);
      setMsg({ tone: 'good', text: want.comment ?? pick(copy.drill.correct) });
      return;
    }
    const n = misses + 1;
    setMisses(n);
    if (!failed.includes(path.length)) setFailed([...failed, path.length]);
    sfx('wrong');
    setMsg({ tone: 'bad', text: n >= 2 ? copy.map.revealed(want.san) : pick(copy.map.sparWrong) });
  };

  const hint = () => {
    if (!want) return;
    setHinted(true);
    if (!failed.includes(path.length)) setFailed([...failed, path.length]);
  };

  const again = () => {
    setPath([]);
    setMisses(0);
    setFailed([]);
    setHinted(false);
    setResult(null);
    setMsg({ tone: 'info', text: copy.map.sparStart });
  };

  const shapes: DrawShape[] = [];
  if (want && misses >= 2) shapes.push(arrow(want, 'green'));
  else if (want && hinted) shapes.push({ orig: want.from as Key, brush: 'yellow' });
  if (result) shapes.push(...((last?.shapes ?? []) as DrawShape[]));

  const line = result?.lineId ? getLine(result.lineId) : undefined;
  const chapter = line ? rep.chapters.find((c) => c.id === line.chapterId) : undefined;
  const sans = path.map((m) => m.san).join(',');

  return (
    <div className="play">
      <Board
        fen={fen}
        orientation={rep.side}
        interactive={!!want && !result}
        lastMove={last && [last.from, last.to]}
        shapes={shapes}
        onMove={onMove}
      />
      <aside className="card side">
        <p className="eyebrow">{copy.map.sparEyebrow(rep.title)}</p>
        <div className={`feedback ${msg.tone}`} role="status" aria-live="polite">{msg.text}</div>
        <MovePath path={path} empty={copy.map.sparEmpty} />
        {!result && (
          <div className="row">
            <button className="btn ghost" onClick={hint} disabled={!want || hinted || misses >= 2}>{copy.drill.hint}</button>
            <span className="hint" style={{ margin: 0 }}>{want ? copy.map.yourTurn : copy.map.theirTurn}</span>
          </div>
        )}
        {result && (
          <div className="end-box">
            <p>
              <strong>{line ? `${line.chapterTitle} · ${line.label}` : copy.map.endOfPrep}</strong>
              <br />
              <span className="muted small">{result.mistakes ? copy.map.sparMistakes(result.mistakes) : copy.map.sparClean}</span>
            </p>
            {chapter?.plans && (
              <div className="comment">
                <strong>{copy.map.whatNow} </strong>
                {chapter.plans}
              </div>
            )}
            <div className="row">
              <button className="btn primary" onClick={again} autoFocus>{copy.map.sparAgain}</button>
              <Link className="btn ghost" to={`/play?fen=${encodeURIComponent(fen)}&color=${rep.side}`}>{copy.learn.playOut}</Link>
              <Link className="btn ghost" to={`/openings/${rep.id}/map?mode=explore&moves=${encodeURIComponent(sans)}`}>{copy.map.exploreHere}</Link>
            </div>
          </div>
        )}
        {session.lines > 0 && <p className="muted small">{copy.map.session(session.lines, session.perfect)}</p>}
      </aside>
    </div>
  );
}
