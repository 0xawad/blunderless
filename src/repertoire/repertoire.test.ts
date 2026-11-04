import { describe, expect, it } from 'vitest';
import { parseMovetext } from './pgn';
import { buildRepertoire, formatLine } from './build';
import { allLines, repertoires } from './index';

describe('pgn parser', () => {
  it('reads variations and comments', () => {
    const root = parseMovetext('{intro} 1. e4 {a} e5 ( 1... c5 2. c3 ) 2. Nf3 *');
    expect(root.comment).toBe('intro');
    const e4 = root.children[0];
    expect(e4.san).toBe('e4');
    expect(e4.comment).toBe('a');
    expect(e4.children.map((c) => c.san)).toEqual(['e5', 'c5']);
    expect(e4.children[1].children[0].san).toBe('c3');
    expect(e4.children[0].children[0].san).toBe('Nf3');
  });

  it('rejects unbalanced variations', () => {
    expect(() => parseMovetext('1. e4 ( 1. d4')).toThrow();
    expect(() => parseMovetext('1. e4 )')).toThrow();
  });

  it('fails loudly on an illegal move', () => {
    const pgn = '[Repertoire "x"]\n[Side "white"]\n\n1. e4 e5 2. Ke3 *';
    expect(() => buildRepertoire(pgn)).toThrow(/illegal move 2\.Ke3/);
  });
});

describe('bundled repertoires', () => {
  it('loads all four', () => {
    expect(repertoires.map((r) => r.id)).toEqual([
      'white-italian',
      'white-anti',
      'black-caro',
      'black-slav',
    ]);
    for (const r of repertoires) expect(r.lines.length).toBeGreaterThan(3);
  });

  it('has unique line ids', () => {
    const ids = allLines.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The drill expects exactly one "right" move whenever it's your turn,
  // including across transpositions and across files for the same side.
  it('never asks for two different moves in the same position', () => {
    for (const side of ['white', 'black'] as const) {
      const seen = new Map<string, { san: string; where: string }>();
      for (const r of repertoires.filter((x) => x.side === side)) {
        for (const line of r.lines) {
          line.plies.forEach((p, i) => {
            if ((p.color === 'w') !== (side === 'white')) return;
            const key = p.fenBefore.split(' ').slice(0, 4).join(' ');
            const where = `${r.id}: ${formatLine(line.plies.slice(0, i + 1))}`;
            const prev = seen.get(key);
            if (prev && prev.san !== p.san) {
              throw new Error(`Conflict: "${prev.where}" vs "${where}"`);
            }
            seen.set(key, { san: p.san, where });
          });
        }
      }
    }
  });
});
