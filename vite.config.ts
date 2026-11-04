import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Same isolation headers as production (public/_headers) so Stockfish's
// SharedArrayBuffer behaves identically in dev.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [react()],
  server: { headers: isolation },
  preview: { headers: isolation },
  build: { target: 'es2022' },
  test: { environment: 'node' },
});
