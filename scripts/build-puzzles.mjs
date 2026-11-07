// Builds public/puzzles/*.json from the Lichess puzzle database (CC0).
// Streams the .zst and stops as soon as every theme bucket is full, so it
// never downloads the whole file. Re-run to refresh: npm run puzzles
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const URL = 'https://database.lichess.org/lichess_db_puzzle.csv.zst';
// Spread evenly over 100-point rating bands so the adaptive rating finds
// puzzles near you anywhere from beginner to ~2200.
const MIN_RATING = 500;
const MAX_RATING = 2200;
const BAND = 100;
const PER_BAND = 36;
const BANDS = Math.ceil((MAX_RATING - MIN_RATING) / BAND);
const PER_THEME = PER_BAND * BANDS;
const THEMES = [
  'hangingPiece', 'fork', 'pin', 'skewer', 'discoveredAttack',
  'mateIn1', 'mateIn2', 'backRankMate', 'trappedPiece', 'defensiveMove',
];
const SKIPPABLE = 0x184d2a50;

// pzstd output: each zstd frame is preceded by a skippable frame holding its
// compressed size. Node's streaming decoder stops after the first frame, so
// split frames ourselves and decompress them one at a time.
async function* lines() {
  const res = await fetch(URL);
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`);
  const reader = res.body.getReader();
  let buf = Buffer.alloc(0);
  let tail = '';
  const need = async (n) => {
    while (buf.length < n) {
      const { value, done } = await reader.read();
      if (done) return false;
      buf = Buffer.concat([buf, value]);
    }
    return true;
  };
  try {
    while (await need(12)) {
      if (buf.readUInt32LE(0) !== SKIPPABLE) throw new Error('expected a pzstd skippable frame');
      const skipLen = buf.readUInt32LE(4);
      const frameLen = buf.readUInt32LE(8);
      if (!(await need(8 + skipLen + frameLen))) break;
      const frame = buf.subarray(8 + skipLen, 8 + skipLen + frameLen);
      buf = buf.subarray(8 + skipLen + frameLen);
      const parts = (tail + zlib.zstdDecompressSync(frame).toString('utf8')).split('\n');
      tail = parts.pop();
      yield* parts;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

const buckets = Object.fromEntries(THEMES.map((t) => [t, []]));
const bands = Object.fromEntries(THEMES.map((t) => [t, new Array(BANDS).fill(0)]));
const bandOf = (r) => Math.min(BANDS - 1, Math.floor((r - MIN_RATING) / BAND));
// High bands fill slowly for some themes; stop after a fixed scan budget too.
const MAX_ROWS = 3_000_000;
const full = () => seen > MAX_ROWS || THEMES.every((t) => buckets[t].length >= PER_THEME);

let seen = 0;
for await (const line of lines()) {
  if (seen++ === 0) continue; // header
  // PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
  const [id, fen, moves, rating, rd, pop, plays, themes] = line.split(',');
  const r = Number(rating);
  if (r < MIN_RATING || r > MAX_RATING || Number(rd) > 90 || Number(pop) < 85 || Number(plays) < 300) continue;
  if (!/^[a-zA-Z0-9]{5,8}$/.test(id) || !/^([a-h][1-8][a-h][1-8][qrbn]? ?)+$/.test(moves)) continue;
  for (const t of themes.split(' ')) {
    const b = bandOf(r);
    if (buckets[t] && bands[t][b] < PER_BAND) {
      bands[t][b]++;
      buckets[t].push([id, fen, moves, r]);
      break; // each puzzle lands in one bucket only
    }
  }
  if (full()) break;
  if (seen % 500_000 === 0) console.log(`scanned ${seen}`);
}

const out = path.resolve('public/puzzles');
fs.mkdirSync(out, { recursive: true });
for (const t of THEMES) {
  buckets[t].sort((a, b) => a[3] - b[3]);
  fs.writeFileSync(path.join(out, `${t}.json`), JSON.stringify(buckets[t]));
}
fs.writeFileSync(
  path.join(out, 'index.json'),
  JSON.stringify(Object.fromEntries(THEMES.map((t) => [t, buckets[t].length]))),
);
console.log(`scanned ${seen} rows`, Object.fromEntries(THEMES.map((t) => [t, buckets[t].length])));
