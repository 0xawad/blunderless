import { buildRepertoire, type Line, type Repertoire } from './build';

const files = import.meta.glob<string>('./pgn/*.pgn', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const ORDER = ['white-italian', 'white-anti', 'black-caro', 'black-slav'];

export const repertoires: Repertoire[] = Object.values(files)
  .map(buildRepertoire)
  .sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));

export const allLines: Line[] = repertoires.flatMap((r) => r.lines);

const lineById = new Map(allLines.map((l) => [l.id, l]));
const repById = new Map(repertoires.map((r) => [r.id, r]));

export const getLine = (id: string) => lineById.get(id);
export const getRepertoire = (id: string) => repById.get(id);

export * from './build';
