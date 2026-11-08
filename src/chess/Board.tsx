import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Chess, SQUARES, type Square } from 'chess.js';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.cburnett.css';
import { getPrefs, setPrefs, usePrefs } from '../prefs';
import { playMove, unlockAudio } from '../sound';

export interface BoardProps {
  fen: string;
  orientation: 'white' | 'black';
  /** Let the side to move drag pieces (any legal move, right or wrong). */
  interactive?: boolean;
  /** Let you queue a move while the other side is thinking. */
  premovable?: boolean;
  lastMove?: [string, string];
  shapes?: DrawShape[];
  onMove?: (from: string, to: string, promotion?: string) => void;
  /** Suppress the move sound (e.g. while stepping through a lesson quickly). */
  silent?: boolean;
  /** Rendered on top of the board (result cards and the like). */
  overlay?: ReactNode;
  /** Show the corner grip that lets you resize the board. */
  resizable?: boolean;
}

export function legalDests(chess: Chess): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>();
  for (const s of SQUARES) {
    const moves = chess.moves({ square: s as Square, verbose: true });
    if (moves.length) dests.set(s, moves.map((m) => m.to));
  }
  return dests;
}

const pieceCount = (fen: string) => (fen.split(' ')[0].match(/[a-zA-Z]/g) ?? []).length;
const boardPart = (fen: string) => fen.split(' ')[0];
// With the ease-out curve (see vite.config.ts) short durations still read as smooth.
const DURATION = { off: 0, normal: 150, slow: 260 } as const;
const PROMO: { p: 'q' | 'r' | 'b' | 'n'; role: string }[] = [
  { p: 'q', role: 'queen' },
  { p: 'r', role: 'rook' },
  { p: 'b', role: 'bishop' },
  { p: 'n', role: 'knight' },
];

// Arrow and circle colours that sit well on every board theme. Right-drag
// draws green; hold Shift for red, Alt for blue, Ctrl/Cmd for orange.
const BRUSHES = {
  green: { key: 'g', color: '#3b8c3f', opacity: 0.82, lineWidth: 10 },
  red: { key: 'r', color: '#c4382e', opacity: 0.82, lineWidth: 10 },
  blue: { key: 'b', color: '#2f6fae', opacity: 0.82, lineWidth: 10 },
  yellow: { key: 'y', color: '#e8902a', opacity: 0.85, lineWidth: 10 },
  paleBlue: { key: 'pb', color: '#2f6fae', opacity: 0.42, lineWidth: 14 },
  paleGreen: { key: 'pg', color: '#3b8c3f', opacity: 0.42, lineWidth: 14 },
  paleRed: { key: 'pr', color: '#c4382e', opacity: 0.42, lineWidth: 14 },
  paleGrey: { key: 'pgr', color: '#4a4a4a', opacity: 0.35, lineWidth: 14 },
  purple: { key: 'purple', color: '#68217a', opacity: 0.65, lineWidth: 10 },
  pink: { key: 'pink', color: '#ee2080', opacity: 0.5, lineWidth: 10 },
  white: { key: 'white', color: 'white', opacity: 1, lineWidth: 10 },
};

export function Board({ fen, orientation, interactive, premovable, lastMove, shapes, onMove, silent, overlay, resizable }: BoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const over = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const fenRef = useRef(fen);
  fenRef.current = fen;
  const prevFen = useRef(fen);
  const synced = useRef('');
  const shapesKey = useRef('');
  const prefs = usePrefs();
  const [promo, setPromo] = useState<{ from: string; to: string; color: 'w' | 'b' } | null>(null);
  const [nudge, bump] = useState(0);

  useEffect(() => {
    if (!el.current) return;
    // A fresh board knows nothing yet: make the sync effect push everything again.
    synced.current = '';
    shapesKey.current = '';
    api.current = Chessground(el.current, {
      coordinates: getPrefs().coordinates,
      animation: { duration: DURATION[getPrefs().animation] },
      highlight: { lastMove: getPrefs().highlightLast, check: true },
      premovable: { enabled: !!premovable },
      draggable: { showGhost: true, distance: 3 },
      // Dragging a piece on a phone shouldn't scroll the page.
      blockTouchScroll: true,
      selectable: { enabled: true },
      drawable: { brushes: BRUSHES, defaultSnapToValidMove: true },
      movable: {
        free: false,
        showDests: getPrefs().showDests,
        events: {
          after: (from, to) => {
            unlockAudio();
            hideOver();
            // A pawn reaching the last rank needs a piece choice before the move is real.
            const chess = new Chess(fenRef.current);
            const piece = chess.get(from as Square);
            if (piece?.type === 'p' && /[18]$/.test(to)) {
              if (getPrefs().autoQueen) onMoveRef.current?.(from, to, 'q');
              else setPromo({ from, to, color: piece.color });
              bump((n) => n + 1);
              return;
            }
            onMoveRef.current?.(from, to);
            // Re-render once: if the parent rejected the move, the board snaps back.
            bump((n) => n + 1);
          },
        },
      },
    });
    // Shapes set before the board has its size are drawn into a 0x0 box; redraw once it's laid out.
    const raf = requestAnimationFrame(() => api.current?.redrawAll());
    return () => {
      cancelAnimationFrame(raf);
      api.current?.destroy();
      api.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api.current?.set({
      animation: { duration: DURATION[prefs.animation] },
      premovable: { enabled: !!premovable },
      coordinates: prefs.coordinates,
      highlight: { lastMove: prefs.highlightLast, check: true },
      movable: { showDests: prefs.showDests },
    });
    if (api.current) api.current.redrawAll();
  }, [prefs.animation, prefs.coordinates, prefs.highlightLast, prefs.showDests, premovable]);

  // Push the position to the board only when something about it changed, or
  // when the board shows something else than it should (a rejected move).
  // Re-setting on every render would reset a piece you're dragging every
  // time anything else on the page updates.
  useEffect(() => {
    const cg = api.current;
    if (!cg) return;
    const key = [fen, orientation, interactive, premovable, lastMove?.join('')].join('|');
    const drifted = boardPart(cg.getFen()) !== boardPart(fen) && !promo;
    if (key !== synced.current || drifted) {
      synced.current = key;
      const chess = new Chess(fen);
      const turn = chess.turn() === 'w' ? 'white' : 'black';
      cg.set({
        fen,
        orientation,
        turnColor: turn,
        lastMove: lastMove as Key[] | undefined,
        check: chess.inCheck(),
        movable: {
          color: interactive ? turn : premovable ? (turn === 'white' ? 'black' : 'white') : undefined,
          dests: interactive ? legalDests(chess) : new Map(),
        },
      });
      // A drag whose piece is no longer on its start square is left over
      // from a move that already happened; clear it so no ghost piece sticks.
      const drag = cg.state.draggable.current;
      if (drag && !cg.state.pieces.has(drag.orig)) {
        cg.cancelMove();
        cg.redrawAll();
      }
      // A queued premove fires as soon as it's your turn again.
      if (interactive && premovable) cg.playPremove();
    }
    const sk = JSON.stringify(shapes ?? []);
    if (sk !== shapesKey.current) {
      shapesKey.current = sk;
      cg.setAutoShapes(shapes ?? []);
    }
  });

  // One sound per position change, whoever moved.
  useEffect(() => {
    const before = prevFen.current;
    prevFen.current = fen;
    if (before === fen || silent) return;
    let chess: Chess;
    try {
      chess = new Chess(fen);
    } catch {
      return;
    }
    const [from, to] = lastMove ?? [];
    const moved = to ? chess.get(to as Square) : undefined;
    const castle = !!from && !!to && moved?.type === 'k' && Math.abs(from.charCodeAt(0) - to.charCodeAt(0)) === 2;
    const promote = !!from && !!moved && moved.type !== 'p' && moved.type !== 'k' && /[27]$/.test(from) && /[18]$/.test(to ?? '');
    playMove({ capture: pieceCount(before) > pieceCount(fen), check: chess.inCheck(), mate: chess.isCheckmate(), castle, promote });
  }, [fen, lastMove, silent]);

  // While dragging, outline the square under the piece, like the big sites do.
  // Only touch the DOM when the square changes, and move it with a transform
  // (no layout), so it never competes with the dragged piece for frames.
  const overKey = useRef<string | null>(null);
  function hideOver() {
    overKey.current = null;
    if (over.current) over.current.style.opacity = '0';
  }
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const move = (e: PointerEvent) => {
      const cg = api.current;
      const box = over.current;
      if (!cg || !box) return;
      if (!cg.state.draggable.current?.started) {
        if (overKey.current) hideOver();
        return;
      }
      const k = cg.getKeyAtDomPos([e.clientX, e.clientY]) ?? null;
      if (k === overKey.current) return;
      overKey.current = k;
      if (!k) return void (box.style.opacity = '0');
      const file = k.charCodeAt(0) - 97;
      const rank = Number(k[1]) - 1;
      const white = cg.state.orientation === 'white';
      box.style.transform = `translate(${(white ? file : 7 - file) * 100}%, ${(white ? 7 - rank : rank) * 100}%)`;
      box.style.opacity = '1';
    };
    document.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerup', hideOver);
    document.addEventListener('pointercancel', hideOver);
    return () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', hideOver);
      document.removeEventListener('pointercancel', hideOver);
    };
  }, []);

  const pick = (p: 'q' | 'r' | 'b' | 'n') => {
    const m = promo!;
    setPromo(null);
    onMoveRef.current?.(m.from, m.to, p);
    bump((n) => n + 1);
  };
  const cancelPromo = () => {
    setPromo(null);
    bump((n) => n + 1); // re-render so the pawn snaps back
  };

  // Promotion picker sits on the destination file, starting from the last rank.
  const promoStyle = promo
    ? (() => {
        const file = promo.to.charCodeAt(0) - 97;
        const col = orientation === 'white' ? file : 7 - file;
        const atTop = (promo.to.endsWith('8') && orientation === 'white') || (promo.to.endsWith('1') && orientation === 'black');
        return { left: `${col * 12.5}%`, ...(atTop ? { top: 0 } : { bottom: 0, flexDirection: 'column-reverse' as const }) };
      })()
    : undefined;

  // Corner grip: drag to resize the board, remembered across pages.
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const w = wrap.current?.getBoundingClientRect().width ?? 1;
    const x0 = e.clientX;
    const s0 = getPrefs().boardScale;
    const root = document.documentElement;
    let s = s0;
    const moveIt = (ev: PointerEvent) => {
      s = Math.max(0.6, Math.min(1, s0 * (1 + (ev.clientX - x0) / w)));
      root.style.setProperty('--board-scale', String(s));
    };
    const up = () => {
      document.removeEventListener('pointermove', moveIt);
      document.removeEventListener('pointerup', up);
      setPrefs({ boardScale: Math.round(s * 100) / 100 });
      api.current?.redrawAll();
    };
    document.addEventListener('pointermove', moveIt);
    document.addEventListener('pointerup', up);
  };

  return (
    <div ref={wrap} className="board-wrap" data-nudge={nudge}>
      <div ref={el} className="board" />
      <div ref={over} className="drag-over" aria-hidden />
      {promo && (
        <>
          <div className="board-overlay promo-dim" onClick={cancelPromo} />
          <div className="promo cg-wrap" style={promoStyle}>
            {PROMO.map((x) => (
              <button key={x.p} onClick={() => pick(x.p)} aria-label={x.role}>
                <piece className={`${promo.color === 'w' ? 'white' : 'black'} ${x.role}`} />
              </button>
            ))}
          </div>
        </>
      )}
      {resizable && <div className="board-grip" onPointerDown={startResize} title="Drag to resize the board" aria-hidden />}
      {overlay}
    </div>
  );
}

/** A centred card over the board, for results and the like. */
export function BoardOverlay({ children }: { children: ReactNode }) {
  return (
    <div className="board-overlay">
      <div className="overlay-card">{children}</div>
    </div>
  );
}
