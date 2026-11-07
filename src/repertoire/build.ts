import { Chess } from 'chess.js';
import { parsePgn, type PgnNode, type PgnShape } from './pgn';

export type Side = 'white' | 'black';

export interface Ply {
  san: string;
  from: string;
  to: string;
  color: 'w' | 'b';
  fenBefore: string;
  fenAfter: string;
  promotion?: string;
  comment?: string;
  /** Arrows and highlights from [%cal] / [%csl] in the move's comment. */
  shapes?: PgnShape[];
}

export interface Line {
  id: string;
  repertoireId: string;
  chapterId: string;
  chapterTitle: string;
  label: string;
  plies: Ply[];
}

export interface Chapter {
  id: string;
  title: string;
  intro?: string;
  /** What to do once the line runs out, from the [Plans "..."] header. */
  plans?: string;
  lines: Line[];
}

export interface Repertoire {
  id: string;
  title: string;
  tagline: string;
  side: Side;
  chapters: Chapter[];
  lines: Line[];
}

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export function formatPly(index: number, san: string): string {
  const n = Math.floor(index / 2) + 1;
  return index % 2 === 0 ? `${n}.${san}` : `${n}...${san}`;
}

export function formatLine(plies: { san: string }[], from = 0): string {
  return plies
    .slice(from)
    .map((p, i) => {
      const idx = from + i;
      return idx % 2 === 0 || i === 0 ? formatPly(idx, p.san) : p.san;
    })
    .join(' ');
}

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Every root-to-leaf path, replayed through chess.js so a typo fails loudly. */
function flatten(root: PgnNode, where: string): Ply[][] {
  const out: Ply[][] = [];
  const walk = (node: PgnNode, chess: Chess, acc: Ply[]) => {
    if (!node.children.length) {
      if (acc.length) out.push(acc);
      return;
    }
    for (const child of node.children) {
      const c = new Chess(chess.fen());
      let m;
      try {
        m = c.move(child.san);
      } catch {
        throw new Error(`${where}: illegal move ${formatPly(acc.length, child.san)} after "${formatLine(acc)}"`);
      }
      walk(child, c, [
        ...acc,
        {
          san: m.san,
          from: m.from,
          to: m.to,
          color: m.color,
          fenBefore: m.before,
          fenAfter: m.after,
          promotion: m.promotion,
          comment: child.comment,
          shapes: child.shapes,
        },
      ]);
    }
  };
  walk(root, new Chess(), []);
  return out;
}

/** "Main line", or the first move where this line leaves the chapter's main line. */
function labelFor(plies: Ply[], main: Ply[]): string {
  const i = plies.findIndex((p, idx) => main[idx]?.san !== p.san);
  return i === -1 ? 'Main line' : `vs ${formatPly(i, plies[i].san)}`;
}

export function buildRepertoire(pgnText: string): Repertoire {
  const games = parsePgn(pgnText);
  const meta = games[0]?.headers ?? {};
  const id = meta.Repertoire;
  const side = meta.Side as Side;
  if (!id || (side !== 'white' && side !== 'black')) {
    throw new Error('First game must carry [Repertoire "..."] and [Side "white|black"] headers');
  }

  const chapters: Chapter[] = games.map((g, gi) => {
    const title = g.headers.Chapter ?? `Chapter ${gi + 1}`;
    const chapterId = slug(title);
    const paths = flatten(g.root, `${id}/${title}`);
    const main = paths[0] ?? [];
    return {
      id: chapterId,
      title,
      intro: g.root.comment,
      plans: g.headers.Plans,
      lines: paths.map((plies) => ({
        id: `${id}:${plies.map((p) => p.san).join(' ')}`,
        repertoireId: id,
        chapterId,
        chapterTitle: title,
        label: labelFor(plies, main),
        plies,
      })),
    };
  });

  return {
    id,
    title: meta.Title ?? id,
    tagline: meta.Tagline ?? '',
    side,
    chapters,
    lines: chapters.flatMap((c) => c.lines),
  };
}
