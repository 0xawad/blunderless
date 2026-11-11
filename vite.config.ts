import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Same isolation headers as production (public/_headers) so Stockfish's
// SharedArrayBuffer behaves identically in dev.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

/** Emits src/sw.js with a per-build cache name so old caches get dropped. */
function stampServiceWorker(): Plugin {
  return {
    name: 'stamp-sw',
    apply: 'build',
    generateBundle() {
      const raw = readFileSync(resolve('src/sw.js'), 'utf8');
      // Without the placeholder every build would share one cache and never drop stale files.
      if (!raw.includes("'blunderless-__BUILD__'")) this.error('src/sw.js lost its __BUILD__ cache name; restore it or update stampServiceWorker()');
      const source = raw.replaceAll('__BUILD__', Date.now().toString(36));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

/**
 * chessground animates with a symmetric cubic ease-in-out: a move starts
 * sluggishly, rushes through the middle and creeps into the square. Big
 * sites move the piece off its square at once and let it settle (ease-out).
 * The easing isn't configurable, so swap it at build time. `t` is the share
 * of the distance still to go, so t^3 is a cubic ease-out in time.
 */
function chessgroundEaseOut(): Plugin {
  const from = 'const easing = (t) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1);';
  return {
    name: 'chessground-ease-out',
    enforce: 'pre',
    transform(code, id) {
      if (!/chessground[\\/]dist[\\/]anim\.js$/.test(id.split('?')[0])) return;
      if (!code.includes(from)) this.error('chessground easing changed; update chessgroundEaseOut()');
      return code.replace(from, 'const easing = (t) => t * t * t;');
    },
  };
}

export default defineConfig({
  plugins: [react(), stampServiceWorker(), chessgroundEaseOut()],
  // Let the plugin above see chessground in dev too (pre-bundled deps skip transforms).
  optimizeDeps: { exclude: ['chessground'] },
  server: { headers: isolation },
  preview: { headers: isolation },
  build: { target: 'es2022' },
  test: { environment: 'node' },
});
