// Copies the Stockfish lite builds next to the app so they're served from 'self'.
// Not committed: regenerated on every dev/build from node_modules.
//
// The file names are also hardcoded in src/engine/engine.ts. They include the
// engine's major version, so a stockfish upgrade that renames them stops here
// with a message that says what to change, not a bare ENOENT.
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
const licence = path.resolve('node_modules/stockfish/Copying.txt');

const missing = [...files.map((f) => path.join(src, f)), licence].filter((f) => !fs.existsSync(f));
if (missing.length) {
  const have = fs.existsSync(src) ? fs.readdirSync(src).filter((f) => /lite/.test(f)).join(', ') || 'no lite builds' : 'the folder does not exist; run npm install';
  console.error(
    [
      'engine: cannot copy Stockfish, these files are missing:',
      ...missing.map((f) => `  ${path.relative(process.cwd(), f)}`),
      `Found in node_modules/stockfish/bin: ${have}.`,
      'If the stockfish package was upgraded, update the names in scripts/copy-engine.mjs and src/engine/engine.ts together.',
    ].join('\n'),
  );
  process.exit(1);
}

fs.mkdirSync(out, { recursive: true });
for (const f of files) fs.copyFileSync(path.join(src, f), path.join(out, f));
fs.copyFileSync(licence, path.join(out, 'COPYING.txt'));
console.log(`engine: copied ${files.length} files to public/engine`);
