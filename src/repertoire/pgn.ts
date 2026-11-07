// Minimal PGN reader: headers, movetext, {comments} and (variations).
// It doesn't check legality; build.ts replays every move through chess.js.

export type Brush = 'green' | 'red' | 'blue' | 'yellow';

/** Same shape as chessground's DrawShape: an arrow (orig to dest) or a circled square. */
export interface PgnShape {
  orig: string;
  dest?: string;
  brush: Brush;
}

export interface PgnNode {
  san: string;
  comment?: string;
  shapes?: PgnShape[];
  children: PgnNode[];
}

export interface PgnGame {
  headers: Record<string, string>;
  root: PgnNode; // san === '' ; root.comment is the intro text
}

const HEADER = /^\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/;
const TOKEN = /\{[^}]*\}|\(|\)|\$\d+|\d+\.(?:\.\.)?|1-0|0-1|1\/2-1\/2|\*|[^\s(){}]+/g;
const MOVE_NUMBER = /^\d+\.+$/;
const RESULT = /^(1-0|0-1|1\/2-1\/2|\*)$/;
const COMMAND = /\[%(cal|csl)\s+([^\]]*)\]/g;
const ARROW = /^([GRBY])([a-h][1-8])([a-h][1-8])$/;
const SQUARE = /^([GRBY])([a-h][1-8])$/;
const BRUSHES: Record<string, Brush> = { G: 'green', R: 'red', B: 'blue', Y: 'yellow' };

/** Pull [%cal Ge2e4,...] arrows and [%csl Rd5,...] highlights out of a comment. */
export function parseComment(raw: string): { text?: string; shapes: PgnShape[] } {
  const shapes: PgnShape[] = [];
  const stripped = raw.replace(COMMAND, (_, cmd: string, args: string) => {
    for (const item of args.split(',')) {
      const m = (cmd === 'cal' ? ARROW : SQUARE).exec(item.trim());
      if (!m) continue;
      shapes.push(m[3] ? { orig: m[2], dest: m[3], brush: BRUSHES[m[1]] } : { orig: m[2], brush: BRUSHES[m[1]] });
    }
    return ' ';
  });
  const text = stripped.replace(/\s+/g, ' ').trim();
  return { text: text || undefined, shapes };
}

export function splitGames(text: string): { headers: Record<string, string>; movetext: string }[] {
  const games: { headers: Record<string, string>; movetext: string }[] = [];
  let headers: Record<string, string> = {};
  let movetext: string[] = [];
  let inMoves = false;

  const flush = () => {
    if (Object.keys(headers).length || movetext.join('').trim()) {
      games.push({ headers, movetext: movetext.join('\n') });
    }
    headers = {};
    movetext = [];
    inMoves = false;
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const h = HEADER.exec(line);
    if (h) {
      if (inMoves) flush();
      headers[h[1]] = h[2].replace(/\\(.)/g, '$1');
    } else if (line) {
      inMoves = true;
      movetext.push(line);
    }
  }
  flush();
  return games;
}

export function parseMovetext(movetext: string): PgnNode {
  const root: PgnNode = { san: '', children: [] };
  const parent = new Map<PgnNode, PgnNode>();
  let cur = root;
  const stack: PgnNode[] = [];

  for (const tok of movetext.match(TOKEN) ?? []) {
    if (tok.startsWith('{')) {
      const { text, shapes } = parseComment(tok.slice(1, -1));
      if (text) cur.comment = cur.comment ? `${cur.comment} ${text}` : text;
      if (shapes.length) cur.shapes = [...(cur.shapes ?? []), ...shapes];
    } else if (tok === '(') {
      const p = parent.get(cur);
      if (!p) throw new Error('Variation with no move to vary from');
      stack.push(cur);
      cur = p;
    } else if (tok === ')') {
      const back = stack.pop();
      if (!back) throw new Error('Unbalanced ")" in PGN');
      cur = back;
    } else if (tok.startsWith('$') || MOVE_NUMBER.test(tok) || RESULT.test(tok)) {
      continue;
    } else {
      const node: PgnNode = { san: tok.replace(/[!?]+$/, ''), children: [] };
      cur.children.push(node);
      parent.set(node, cur);
      cur = node;
    }
  }
  if (stack.length) throw new Error('Unbalanced "(" in PGN');
  return root;
}

export function parsePgn(text: string): PgnGame[] {
  return splitGames(text).map((g) => ({ headers: g.headers, root: parseMovetext(g.movetext) }));
}
