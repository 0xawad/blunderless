import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Chess, SQUARES, type Square } from 'chess.js';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.cburnett.css';
import { usePrefs } from '../prefs';
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
const DURATION = { off: 0, normal: 220, slow: 340 } as const;
const PROMO: { p: 'q' | 'r' | 'b' | 'n'; role: string }[] = [
  { p: 'q', role: 'queen' },
  { p: 'r', role: 'rook' },
  { p: 'b', role: 'bishop' },
  { p: 'n', role: 'knight' },
];

export function Board({ fen, orientation, interactive, premovable, lastMove, shapes, onMove, silent, overlay }: BoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const fenRef = useRef(fen);
  fenRef.current = fen;
  const prevFen = useRef(fen);
  const prefs = usePrefs();
  const [promo, setPromo] = useState<{ from: string; to: string; color: 'w' | 'b' } | null>(null);
  const [, bump] = useState(0);

  useEffect(() => {
    if (!el.current) return;
    api.current = Chessground(el.current, {
      coordinates: true,
      animation: { duration: DURATION[prefs.animation] },
      highlight: { lastMove: true, check: true },
      premovable: { enabled: !!premovable },
      draggable: { showGhost: true, distance: 2 },
      selectable: { enabled: true },
      movable: {
        free: false,
        showDests: true,
        events: {
          after: (from, to) => {
            unlockAudio();
            // A pawn reaching the last rank needs a piece choice before the move is real.
            const chess = new Chess(fenRef.current);
            const piece = chess.get(from as Square);
            if (piece?.type === 'p' && /[18]$/.test(to)) {
              setPromo({ from, to, color: piece.color });
              return;
            }
            onMoveRef.current?.(from, to);
          },
        },
      },
    });
    return () => api.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api.current?.set({ animation: { duration: DURATION[prefs.animation] }, premovable: { enabled: !!premovable } });
  }, [prefs.animation, premovable]);

  // Deliberately runs on every render: re-sending the same fen is how a
  // rejected move snaps back after the parent decides it was wrong.
  useEffect(() => {
    const chess = new Chess(fen);
    const turn = chess.turn() === 'w' ? 'white' : 'black';
    api.current?.set({
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
    api.current?.setAutoShapes(shapes ?? []);
    // A queued premove fires as soon as it's your turn again.
    if (interactive && premovable) api.current?.playPremove();
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

  const pick = (p: 'q' | 'r' | 'b' | 'n') => {
    const m = promo!;
    setPromo(null);
    onMoveRef.current?.(m.from, m.to, p);
  };
  const cancelPromo = () => {
    setPromo(null);
    bump((n) => n + 1); // re-run the fen effect so the pawn snaps back
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

  return (
    <div className="board-wrap">
      <div ref={el} className="board" />
      {promo && (
        <>
          <div className="board-overlay" style={{ background: 'rgb(10 12 20 / 0.25)' }} onClick={cancelPromo} />
          <div className="promo" style={promoStyle}>
            {PROMO.map((x) => (
              <button key={x.p} onClick={() => pick(x.p)} aria-label={x.role}>
                <piece className={`${promo.color === 'w' ? 'white' : 'black'} ${x.role}`} />
              </button>
            ))}
          </div>
        </>
      )}
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
