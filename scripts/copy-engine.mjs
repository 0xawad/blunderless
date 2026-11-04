// Copies the Stockfish lite builds next to the app so they're served from 'self'.
// Not committed: regenerated on every dev/build from node_modules.
import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve('node_modules/stockfish/bin');
const out = path.resolve('public/engine');
const files = [
  'stockfish-19-lite.js',
  'stockfish-19-lite.wasm',
  'stockfish-19-lite-single.js',
  'stockfish-19-lite-single.wasm',
];

fs.mkdirSync(out, { recursive: true });
for (const f of files) fs.copyFileSync(path.join(src, f), path.join(out, f));
fs.copyFileSync(path.resolve('node_modules/stockfish/Copying.txt'), path.join(out, 'COPYING.txt'));
console.log(`engine: copied ${files.length} files to public/engine`);
