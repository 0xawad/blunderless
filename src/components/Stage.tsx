// Layout helpers for every screen with a board. Styles: src/styles/board.css.
import type { CSSProperties, ReactNode } from 'react';
import type { MoveClass } from '../srs/types';

/**
 * The two-column board layout. `bars` reserves room for player bars above and
 * below the board, `controls` for a row of buttons under it, so the board can
 * be as tall as the viewport allows without pushing anything off screen.
 */
export function Stage({ bars, controls, className = '', children }: { bars?: boolean; controls?: boolean; className?: string; children: ReactNode }) {
  return <div className={`stage${bars ? ' with-bars' : ''}${controls ? ' with-controls' : ''} ${className}`}>{children}</div>;
}

export function StageBoard({ children }: { children: ReactNode }) {
  return <div className="stage-board">{children}</div>;
}

/** The row holding the board, and the eval bar when there is one. */
export function BoardRow({ children }: { children: ReactNode }) {
  return <div className="board-row">{children}</div>;
}

export function StageControls({ children }: { children: ReactNode }) {
  return <div className="stage-controls">{children}</div>;
}

export function StagePanel({ head, foot, children, label }: { head?: ReactNode; foot?: ReactNode; children: ReactNode; label?: string }) {
  return (
    <aside className="stage-panel" aria-label={label}>
      {head && <header className="panel-head">{head}</header>}
      <div className="panel-body">{children}</div>
      {foot && <footer className="panel-foot">{foot}</footer>}
    </aside>
  );
}

/** Formats a white-POV centipawn score the way players read it: +1.3, -0.4, M3. */
export function formatEval(cp: number | undefined): string {
  if (cp === undefined) return '';
  // Mates are folded in as 10000 - 10 * moves (see scoreToCp in engine.ts).
  if (Math.abs(cp) >= 9000) {
    const n = Math.max(1, Math.round((10000 - Math.abs(cp)) / 10));
    return `${cp < 0 ? '-' : ''}M${n}`;
  }
  const v = cp / 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(Math.abs(v) >= 10 ? 0 : 1)}`;
}

/**
 * Vertical evaluation bar. `whitePct` is White's winning chances (0-100);
 * `orientation` is the side at the bottom of the board.
 */
export function EvalBar({ whitePct, text, orientation }: { whitePct: number; text: string; orientation: 'white' | 'black' }) {
  const whiteAhead = whitePct >= 50;
  return (
    <div className={`evalbar${orientation === 'black' ? ' flipped' : ''}`} role="img" aria-label={`Evaluation ${text}`}>
      <span style={{ height: `${Math.max(3, Math.min(97, whitePct))}%` }} />
      <b className={whiteAhead ? 'white-side' : 'black-side'}>{text.replace(/^[+-]/, '')}</b>
    </div>
  );
}

const BADGE: Partial<Record<MoveClass, string>> = {
  best: '★',
  book: '≡',
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??',
  'missed-win': '??',
};

/** Where a badge for `square` (e.g. "e4") goes inside .board-wrap, as CSS left/top. */
export function squareBadgeStyle(square: string, orientation: 'white' | 'black'): CSSProperties {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const col = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 7 - rank : rank;
  return { left: `${(col + 1) * 12.5}%`, top: `${row * 12.5}%` };
}

/** A move-quality marker on the destination square, as in a reviewed game. Render inside the board's wrapper. */
export function SquareBadge({ cls, square, orientation, merit }: { cls: MoveClass; square: string; orientation: 'white' | 'black'; merit?: 'great' | 'brilliant' }) {
  const glyph = merit === 'brilliant' ? '!!' : merit === 'great' ? '!' : BADGE[cls];
  if (!glyph) return null;
  return (
    <span className={`sq-badge ${merit ?? cls}`} style={squareBadgeStyle(square, orientation)} aria-hidden>
      {glyph}
    </span>
  );
}
