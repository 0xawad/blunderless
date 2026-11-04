import { useEffect, useRef } from 'react';
import { Chess, SQUARES, type Square } from 'chess.js';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';

export interface BoardProps {
  fen: string;
  orientation: 'white' | 'black';
  /** Let the side to move drag pieces (any legal move, right or wrong). */
  interactive?: boolean;
  lastMove?: [string, string];
  shapes?: DrawShape[];
  onMove?: (from: string, to: string) => void;
}

export function legalDests(chess: Chess): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>();
  for (const s of SQUARES) {
    const moves = chess.moves({ square: s as Square, verbose: true });
    if (moves.length) dests.set(s, moves.map((m) => m.to));
  }
  return dests;
}

export function Board({ fen, orientation, interactive, lastMove, shapes, onMove }: BoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  useEffect(() => {
    if (!el.current) return;
    api.current = Chessground(el.current, {
      coordinates: true,
      animation: { duration: 180 },
      highlight: { lastMove: true, check: true },
      premovable: { enabled: false },
      draggable: { showGhost: true },
      movable: {
        free: false,
        showDests: true,
        events: { after: (from, to) => onMoveRef.current?.(from, to) },
      },
    });
    return () => api.current?.destroy();
  }, []);

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

  return (
    <div className="board-wrap">
      <div ref={el} className="board" />
    </div>
  );
}
