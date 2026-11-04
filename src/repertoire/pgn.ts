// Minimal PGN reader: headers, movetext, {comments} and (variations).
// It doesn't check legality; build.ts replays every move through chess.js.

export interface PgnNode {
  san: string;
  comment?: string;
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
      const text = tok.slice(1, -1).replace(/\s+/g, ' ').trim();
      cur.comment = cur.comment ? `${cur.comment} ${text}` : text;
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
