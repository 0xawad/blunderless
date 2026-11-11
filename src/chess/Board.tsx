import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Chess, SQUARES, type Move, type Square } from 'chess.js';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.cburnett.css';
import { copy } from '../copy';
import { getPrefs, MIN_BOARD_SCALE, setPrefs, usePrefs } from '../prefs';
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
  /** Accessible name, when "Chess board" is not specific enough (two boards on one page, say). */
  label?: string;
}

export function legalDests(chess: Chess): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>();
  for (const s of SQUARES) {
    const moves = chess.moves({ square: s as Square, verbose: true });
    if (moves.length) dests.set(s, moves.map((m) => m.to));
  }
  return dests;
}

/* ---------------------------------------------------------------------------
   The board in words. chessground draws unlabeled <piece> elements, so people
   using a screen reader or a keyboard get the position as text, each move
   announced, and a text field to play from (see the Board component).
   ------------------------------------------------------------------------- */

type Promotion = 'q' | 'r' | 'b' | 'n';

export type TypedMove =
  | { ok: true; from: string; to: string; /** Missing when a pawn reaches the last rank and no piece was typed: ask. */ promotion?: Promotion }
  | { ok: false; reason: 'illegal' | 'ambiguous' };

const COORDS = /^([a-h][1-8])[-x]?([a-h][1-8])=?([qrbn])?$/;
const CASTLE = /^[0o]-?[0o](-?[0o])?$/i;
// Piece, optional start file and rank, optional capture, target square, optional promotion.
const SAN_SHAPE = /^[kqrbnp]?[a-h]?[1-8]?x?[a-h][1-8](=?[qrbn])?$/i;

/** The ways a typed move can be read as algebraic notation, most literal first. */
function sanReadings(text: string): string[] {
  // The promotion piece in either case, with or without "=": e8q, e8=Q.
  const promo = (s: string) => s.replace(/([18])=?([qrbn])$/i, (_m, rank: string, p: string) => `${rank}=${p.toUpperCase()}`);
  const lower = promo(text.toLowerCase());
  const out = [promo(text), lower];
  // "bc4" is the b-pawn taking on c4 before it is a bishop move, as lower case means a pawn.
  if (/^[a-h][a-h][1-8]/.test(lower)) out.push(`${lower[0]}x${lower.slice(1)}`);
  if (/^[nbrqk]/.test(lower)) out.push(lower[0].toUpperCase() + lower.slice(1));
  return [...new Set(out)];
}

/**
 * Reads a typed move against the position: coordinates ("e2e4", "e7-e8q") or
 * algebraic notation ("Nf3", "exd5", "O-O", "e8=Q"). Forgiving about case,
 * zeros in castling, a missing "x" and trailing "+", "#", "!" or "?".
 */
export function parseTypedMove(fen: string, typed: string): TypedMove {
  const illegal: TypedMove = { ok: false, reason: 'illegal' };
  const text = typed.trim().replace(/[+#!?]+$/, '');
  // One move, start to end. chess.js's forgiving parser would find a move
  // inside a longer string and reads "--" as a null move; neither counts here.
  if (!COORDS.test(text.toLowerCase()) && !CASTLE.test(text) && !SAN_SHAPE.test(text)) return illegal;
  // Did they say what to promote to? ("e8=Q", "e8q", "e7e8q")
  const namesPiece = /[18]=?[qrbn]$/i.test(text);
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return illegal;
  }
  const legal = chess.moves({ verbose: true });

  const coords = COORDS.exec(text.toLowerCase());
  if (coords) {
    const [, from, to, piece] = coords;
    const hit = legal.find((m) => m.from === from && m.to === to && (!piece || m.promotion === piece));
    return hit ? { ok: true, from, to, promotion: piece as Promotion | undefined } : illegal;
  }

  const castle = CASTLE.exec(text);
  for (const san of castle ? [castle[1] ? 'O-O-O' : 'O-O'] : sanReadings(text)) {
    try {
      const m = chess.move(san);
      // Left to itself chess.js picks a knight for "dxe8"; an unnamed promotion is the caller's to ask about.
      return { ok: true, from: m.from, to: m.to, promotion: namesPiece ? (m.promotion as Promotion | undefined) : undefined };
    } catch {
      /* not this reading */
    }
  }

  // A pawn move to the last rank with no piece named is legal once one is chosen.
  if (/^[a-h]?x?[a-h][18]$/i.test(text)) {
    try {
      const m = chess.move(`${text.toLowerCase()}=Q`);
      return { ok: true, from: m.from, to: m.to };
    } catch {
      /* not a promotion either */
    }
  }

  const piece = /^([nbrqk])x?([a-h][1-8])$/i.exec(text);
  if (piece) {
    const [type, to] = [piece[1].toLowerCase(), piece[2].toLowerCase()];
    if (legal.filter((m) => m.piece === type && m.to === to).length > 1) return { ok: false, reason: 'ambiguous' };
  }
  return illegal;
}

const PIECE_ORDER = ['k', 'q', 'r', 'b', 'n', 'p'] as const;

/** Where every piece stands, one sentence per side, read straight from the FEN. */
export function describePosition(fen: string): string[] {
  const on: Record<'w' | 'b', Record<string, string[]>> = { w: {}, b: {} };
  fen.split(' ')[0].split('/').forEach((row, r) => {
    let file = 0;
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') {
        file += Number(ch);
        continue;
      }
      const type = ch.toLowerCase();
      (on[ch === type ? 'b' : 'w'][type] ??= []).push('abcdefgh'[file] + (8 - r));
      file++;
    }
  });
  return (['w', 'b'] as const).map((color) => {
    const groups = PIECE_ORDER.filter((t) => on[color][t]).map((t) => {
      const squares = on[color][t].sort();
      return `${squares.length === 1 ? copy.board.pieces[t] : copy.board.piecesPlural[t]} ${squares.join(', ')}`;
    });
    return copy.board.side(copy.board.colors[color], groups.join('; ') || copy.board.noPieces);
  });
}

/** Pieces and side to move: enough to tell whether one legal move links two positions. */
const placement = (fen: string) => fen.split(' ', 2).join(' ');

/** The legal move that turns `before` into `after`, if they are one move apart. */
function moveBetween(before: string, after: string, lastMove?: readonly string[]): Move | undefined {
  try {
    const chess = new Chess(before);
    const want = placement(after);
    const moves = lastMove ? chess.moves({ square: lastMove[0] as Square, verbose: true }) : chess.moves({ verbose: true });
    return moves.find((m) => (!lastMove || m.to === lastMove[1]) && placement(m.after) === want);
  } catch {
    return undefined;
  }
}

function moveInWords(m: Move): string {
  const color = copy.board.colors[m.color];
  if (m.isKingsideCastle() || m.isQueensideCastle()) return copy.board.castled(color, m.isQueensideCastle());
  const piece = copy.board.pieces[m.piece];
  const text = m.captured
    ? // An en passant capture takes the pawn beside the capturing pawn, not on the square it lands on.
      copy.board.took(color, piece, copy.board.pieces[m.captured], m.isEnPassant() ? m.to[0] + m.from[1] : m.to)
    : copy.board.moved(color, piece, m.to);
  return m.promotion ? `${text} ${copy.board.promoted(copy.board.pieces[m.promotion])}` : text;
}

function statusInWords(chess: Chess): string {
  if (chess.isCheckmate()) return copy.board.checkmate;
  if (chess.isStalemate()) return copy.board.stalemate;
  if (chess.isDraw()) return copy.board.draw;
  const turn = copy.board.toMove(copy.board.colors[chess.turn()]);
  return chess.inCheck() ? `${copy.board.check} ${turn}` : turn;
}

function changeInWords(before: string, now: Chess, fen: string, lastMove?: readonly string[]): string {
  const move = moveBetween(before, fen, lastMove);
  return move ? `${moveInWords(move)} ${statusInWords(now)}` : statusInWords(now);
}

/**
 * What to announce when the board goes from `before` to `fen`: the move in
 * words when the two are one move apart, then check, mate or whose turn it is.
 * "White knight to f3. Black to move."
 */
export function describeChange(before: string, fen: string, lastMove?: readonly string[]): string {
  try {
    return changeInWords(before, new Chess(fen), fen, lastMove);
  } catch {
    return '';
  }
}

/* ------------------------------------------------------------------------- */

const pieceCount = (fen: string) => (fen.split(' ')[0].match(/[a-zA-Z]/g) ?? []).length;
const boardPart = (fen: string) => fen.split(' ')[0];
// With the ease-out curve (see vite.config.ts) short durations still read as smooth.
const DURATION = { off: 0, normal: 150, slow: 260 } as const;
const PROMO: { p: Promotion; role: string }[] = [
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

// The typed-move strip, once focused: along the board's bottom edge, above the
// pieces, overlays and the promotion picker (z-index 11 to 14 in the board CSS).
const TYPED_STRIP: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 15,
  padding: 'var(--s-2)',
  background: 'var(--surface)',
  borderTop: '1px solid var(--line)',
};

// True from the moment someone types a move until they use a pointer again.
// While it is, a board that becomes playable takes focus back if nothing else
// has it, so playing from the keyboard does not mean Tabbing back to the board
// after every "Next" button that disappears. Shared by all boards on purpose:
// the next puzzle is often a new Board.
let keyboardPlay = false;

export function Board({ fen, orientation, interactive, premovable, lastMove, shapes, onMove, silent, overlay, resizable, label }: BoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const over = useRef<HTMLDivElement>(null);
  const live = useRef<HTMLDivElement>(null);
  const typedInput = useRef<HTMLInputElement>(null);
  const promoBox = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const fenRef = useRef(fen);
  fenRef.current = fen;
  const prevFen = useRef(fen);
  const synced = useRef('');
  const shapesKey = useRef('');
  const resize = useRef<{ pointer: number; x0: number; width: number; from: number; scale: number } | null>(null);
  const prefs = usePrefs();
  const [promo, setPromo] = useState<{ from: string; to: string; color: 'w' | 'b'; fen: string } | null>(null);
  // The picker belongs to one position. If that changes under it (a flag
  // falls, the review steps on, a new game starts) the pawn it was for is gone.
  const picker = promo && promo.fen === fen && interactive ? promo : null;
  const [nudge, bump] = useState(0);
  const [typed, setTyped] = useState('');
  const [typedError, setTypedError] = useState<{ text: string; n: number } | null>(null);
  const [typing, setTyping] = useState(false);
  const typedId = useId();
  // The move field appears once the board has been playable and then stays, so
  // focus is not thrown away every time it is the other side's turn. A board
  // that only ever shows positions never gets one.
  const [playable, setPlayable] = useState(!!interactive);
  if (interactive && !playable) setPlayable(true);

  // A move made on the board or typed. Only touches refs and state setters, so
  // the copy chessground holds from the first render never goes stale.
  const userMove = (from: string, to: string, promotion?: Promotion) => {
    if (!promotion) {
      // A pawn reaching the last rank needs a piece choice before the move is real.
      const piece = new Chess(fenRef.current).get(from as Square);
      if (piece?.type === 'p' && /[18]$/.test(to)) {
        if (getPrefs().autoQueen) onMoveRef.current?.(from, to, 'q');
        else setPromo({ from, to, color: piece.color, fen: fenRef.current });
        bump((n) => n + 1);
        return;
      }
    }
    onMoveRef.current?.(from, to, promotion);
    // Re-render once: if the parent rejected the move, the board snaps back.
    bump((n) => n + 1);
  };

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
            userMove(from, to);
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
    const drifted = boardPart(cg.getFen()) !== boardPart(fen) && !picker;
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

  // One sound and one spoken line per position change, whoever moved.
  useEffect(() => {
    const before = prevFen.current;
    prevFen.current = fen;
    if (before === fen) return;
    let chess: Chess;
    try {
      chess = new Chess(fen);
    } catch {
      return;
    }
    // Written straight to the live region: a state update would re-render the board for every move.
    if (live.current) live.current.textContent = changeInWords(before, chess, fen, lastMove);
    if (silent) return;
    const [from, to] = lastMove ?? [];
    const moved = to ? chess.get(to as Square) : undefined;
    const castle = !!from && !!to && moved?.type === 'k' && Math.abs(from.charCodeAt(0) - to.charCodeAt(0)) === 2;
    const pawns = (f: string) => (f.split(' ')[0].match(/[pP]/g) ?? []).length;
    const promote = !!moved && moved.type !== 'p' && moved.type !== 'k' && /[18]$/.test(to ?? '') && pawns(before) > pawns(fen);
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
    const pointerUsed = () => {
      keyboardPlay = false;
    };
    document.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerup', hideOver);
    document.addEventListener('pointercancel', hideOver);
    document.addEventListener('pointerdown', pointerUsed, { passive: true });
    return () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', hideOver);
      document.removeEventListener('pointercancel', hideOver);
      document.removeEventListener('pointerdown', pointerUsed);
      // Unmounted in the middle of a resize drag: put the saved size back.
      if (resize.current) {
        resize.current = null;
        document.documentElement.style.setProperty('--board-scale', String(getPrefs().boardScale));
      }
    };
  }, []);

  /* ---- promotion picker ---- */

  const pick = (p: Promotion) => {
    const m = picker;
    if (!m) return;
    setPromo(null);
    onMoveRef.current?.(m.from, m.to, p);
    bump((n) => n + 1);
  };
  const cancelPromo = () => {
    setPromo(null);
    bump((n) => n + 1); // re-render so the pawn snaps back
  };

  // Forget a picker whose position is gone, so it cannot come back if the same position does.
  useEffect(() => {
    if (promo && !picker) setPromo(null);
  }, [promo, picker]);

  // Focus goes into the picker when it opens and back where it was when it closes.
  useEffect(() => {
    if (!picker) return;
    const active = document.activeElement;
    const back = active instanceof HTMLElement && active !== document.body ? active : null;
    promoBox.current?.querySelector('button')?.focus({ preventScroll: true });
    return () => {
      if (back?.isConnected) back.focus({ preventScroll: true });
    };
  }, [picker]);

  // The picker sits on the destination file, starting from the last rank.
  const pickerAtTop = !!picker && ((picker.to.endsWith('8') && orientation === 'white') || (picker.to.endsWith('1') && orientation === 'black'));
  const pickerStyle: CSSProperties | undefined = picker
    ? (() => {
        const file = picker.to.charCodeAt(0) - 97;
        const col = orientation === 'white' ? file : 7 - file;
        return { left: `${col * 12.5}%`, ...(pickerAtTop ? { top: 0 } : { bottom: 0, flexDirection: 'column-reverse' as const }) };
      })()
    : undefined;

  const onPickerKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const buttons = [...e.currentTarget.querySelectorAll('button')];
    const at = buttons.findIndex((b) => b === document.activeElement);
    // The buttons are in queen-first order; on screen that runs down from the top or up from the bottom.
    const down = pickerAtTop ? 1 : -1;
    const letter = PROMO.find((x) => x.p === e.key.toLowerCase());
    let to: number | null = null;
    if (e.key === 'Escape') cancelPromo();
    else if (letter) pick(letter.p);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') to = at + down;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') to = at - down;
    // Tab stays inside until a piece is picked or the picker is cancelled.
    else if (e.key === 'Tab') to = at + (e.shiftKey ? -1 : 1);
    else return;
    e.preventDefault();
    e.stopPropagation(); // pages listen for arrows and Escape too
    if (to !== null) buttons[(to + buttons.length) % buttons.length]?.focus();
  };

  /* ---- corner grip: drag to resize the board, remembered across pages ---- */

  const showScale = (s: number) => document.documentElement.style.setProperty('--board-scale', String(s));
  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || resize.current) return;
    e.preventDefault();
    // Capturing the pointer routes the rest of the gesture to the grip, so
    // nothing has to listen on the document and nothing can be left behind.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      return;
    }
    const from = getPrefs().boardScale;
    resize.current = { pointer: e.pointerId, x0: e.clientX, width: wrap.current?.getBoundingClientRect().width || 1, from, scale: from };
  };
  const moveResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = resize.current;
    if (!r || e.pointerId !== r.pointer) return;
    r.scale = Math.max(MIN_BOARD_SCALE, Math.min(1, r.from * (1 + (e.clientX - r.x0) / r.width)));
    showScale(r.scale);
  };
  /** Pointer up keeps the new size; a cancelled gesture (or losing the pointer) goes back to the old one. */
  const endResize = (e: ReactPointerEvent<HTMLDivElement>, keep: boolean) => {
    const r = resize.current;
    if (!r || e.pointerId !== r.pointer) return;
    resize.current = null;
    if (keep) setPrefs({ boardScale: Math.round(r.scale * 100) / 100 });
    showScale(getPrefs().boardScale);
    api.current?.redrawAll();
  };

  /* ---- typing a move ---- */

  const submitTyped = (e: FormEvent) => {
    e.preventDefault();
    const text = typed.trim();
    if (!text) return;
    const fail = (message: string) => setTypedError((prev) => ({ text: message, n: (prev?.n ?? 0) + 1 }));
    if (!interactive) return fail(copy.board.moveWait);
    const move = parseTypedMove(fen, text);
    if (!move.ok) return fail(move.reason === 'ambiguous' ? copy.board.moveAmbiguous(text) : copy.board.moveIllegal(text));
    setTyped('');
    setTypedError(null);
    unlockAudio();
    userMove(move.from, move.to, move.promotion);
  };

  const onTypedKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Tab') return;
    if (e.key === 'Escape') {
      // Escape clears what was typed; with nothing typed it is the page's to handle.
      if (!typed && !typedError) return;
      setTyped('');
      setTypedError(null);
    }
    // Pages bind letters and arrows (F flips the board, arrows step through moves): not while typing.
    e.stopPropagation();
  };

  useEffect(() => {
    if (keyboardPlay && interactive && document.activeElement === document.body) typedInput.current?.focus({ preventScroll: true });
  }, [interactive, fen]);

  const position = useMemo(() => {
    const turn = copy.board.toMove(copy.board.colors[fen.split(' ')[1] === 'b' ? 'b' : 'w']);
    return [...describePosition(fen), turn];
  }, [fen]);

  return (
    <div ref={wrap} className="board-wrap" data-nudge={nudge} role="group" aria-label={label ?? copy.board.label}>
      {position.map((line, i) => (
        <p key={i} className="sr-only">{line}</p>
      ))}
      <div ref={live} className="sr-only" role="status" />
      {onMove && playable && (
        <form
          className={typing ? 'board-typed' : 'board-typed sr-only'}
          style={typing ? TYPED_STRIP : undefined}
          onSubmit={submitTyped}
          onFocus={() => {
            keyboardPlay = true;
            setTyping(true);
          }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setTyping(false);
          }}
          noValidate
        >
          <div className="between">
            <label htmlFor={typedId} className="sr-only">{copy.board.moveLabel}</label>
            <input
              id={typedId}
              ref={typedInput}
              className="grow"
              type="text"
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                setTypedError(null);
              }}
              onKeyDown={onTypedKey}
              placeholder={copy.board.movePlaceholder}
              maxLength={12}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              aria-invalid={typedError ? true : undefined}
              aria-describedby={typedError ? `${typedId}-error` : undefined}
            />
            <button type="submit" className="btn">{copy.board.movePlay}</button>
          </div>
          {typedError && (
            <p key={typedError.n} id={`${typedId}-error`} className="field-error" role="alert">{typedError.text}</p>
          )}
        </form>
      )}
      <div ref={el} className="board" aria-hidden />
      <div ref={over} className="drag-over" aria-hidden />
      {picker && (
        <>
          <div className="board-overlay promo-dim" onClick={cancelPromo} aria-hidden />
          <div
            ref={promoBox}
            className="promo cg-wrap"
            style={pickerStyle}
            role="dialog"
            aria-modal="true"
            aria-label={copy.board.promoLabel}
            aria-describedby={`${typedId}-promo`}
            onKeyDown={onPickerKey}
          >
            <span id={`${typedId}-promo`} className="sr-only">{copy.board.promoHint}</span>
            {PROMO.map((x) => (
              <button key={x.p} type="button" onClick={() => pick(x.p)} aria-label={copy.board.promoPieces[x.p]} title={copy.board.promoPieces[x.p]}>
                <piece className={`${picker.color === 'w' ? 'white' : 'black'} ${x.role}`} aria-hidden />
              </button>
            ))}
          </div>
        </>
      )}
      {resizable && (
        <div
          className="board-grip"
          title={copy.board.resize}
          aria-hidden
          onPointerDown={startResize}
          onPointerMove={moveResize}
          onPointerUp={(e) => endResize(e, true)}
          onPointerCancel={(e) => endResize(e, false)}
          onLostPointerCapture={(e) => endResize(e, false)}
        />
      )}
      {overlay}
    </div>
  );
}

/** A centred card over the board, for results and the like. */
export function BoardOverlay({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="board-overlay" role="dialog" aria-modal="false" aria-label={label ?? copy.board.result}>
      <div className="overlay-card">{children}</div>
    </div>
  );
}
