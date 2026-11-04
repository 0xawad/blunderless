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
      const source = readFileSync(resolve('src/sw.js'), 'utf8').replaceAll('__BUILD__', Date.now().toString(36));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  plugins: [react(), stampServiceWorker()],
  server: { headers: isolation },
  preview: { headers: isolation },
  build: { target: 'es2022' },
  test: { environment: 'node' },
});
