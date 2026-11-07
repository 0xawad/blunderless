import { useEffect, useRef } from 'react';
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
  lastMove?: [string, string];
  shapes?: DrawShape[];
  onMove?: (from: string, to: string) => void;
  /** Suppress the move sound (e.g. while stepping through a lesson quickly). */
  silent?: boolean;
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

const DURATION = { off: 0, normal: 200, slow: 320 } as const;

export function Board({ fen, orientation, interactive, lastMove, shapes, onMove, silent }: BoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const prevFen = useRef(fen);
  const prefs = usePrefs();

  useEffect(() => {
    if (!el.current) return;
    api.current = Chessground(el.current, {
      coordinates: true,
      animation: { duration: DURATION[prefs.animation] },
      highlight: { lastMove: true, check: true },
      premovable: { enabled: false },
      draggable: { showGhost: true, distance: 2 },
      selectable: { enabled: true },
      movable: {
        free: false,
        showDests: true,
        events: {
          after: (from, to) => {
            unlockAudio();
            onMoveRef.current?.(from, to);
          },
        },
      },
    });
    return () => api.current?.destroy();
  }, []);

  useEffect(() => {
    api.current?.set({ animation: { duration: DURATION[prefs.animation] } });
  }, [prefs.animation]);

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
        color: interactive ? turn : undefined,
        dests: interactive ? legalDests(chess) : new Map(),
      },
    });
    api.current?.setAutoShapes(shapes ?? []);
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
    playMove({
      capture: pieceCount(before) > pieceCount(fen),
      check: chess.inCheck(),
      mate: chess.isCheckmate(),
      castle,
      promote,
    });
  }, [fen, lastMove, silent]);

  return (
    <div className="board-wrap">
      <div ref={el} className="board" />
    </div>
  );
}
