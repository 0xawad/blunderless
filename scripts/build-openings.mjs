// Builds public/openings.json from lichess-org/chess-openings (CC0).
// Keyed by the first 4 FEN fields -> "<eco>|<name>".
import { writeFileSync } from 'node:fs';
import { Chess } from 'chess.js';

const BASE = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master';
const out = {};

for (const letter of 'abcde') {
  const res = await fetch(`${BASE}/${letter}.tsv`);
  if (!res.ok) throw new Error(`${letter}.tsv: ${res.status}`);
  const rows = (await res.text()).split('\n').slice(1);
  for (const row of rows) {
    const [eco, name, pgn] = row.trim().split('\t');
    if (!eco || !name || !pgn) continue;
    const chess = new Chess();
    try {
      chess.loadPgn(pgn);
    } catch {
      console.warn('skip', eco, name);
      continue;
    }
    out[chess.fen().split(' ').slice(0, 4).join(' ')] = `${eco}|${name}`;
  }
}

writeFileSync('public/openings.json', JSON.stringify(out));
console.log(`wrote ${Object.keys(out).length} openings`);
