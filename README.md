# ♞ blunderless

Fewer blunders. Better openings. Some light roasting.

A local-first chess trainer for improving club players. It runs entirely in the browser: no accounts, no backend.

## What it does

- **Openings.** A small repertoire with the plans explained (130 lines). Learn each line move by move, then drill it with spaced repetition (FSRS) until you play it on autopilot. "Play it out" starts a game against Stockfish from the end of any line.
- **Games.** Imports your last 3 months from Chess.com.
  - Every game gets a book report: where you left your prep, or where your opponent did. Lines you had already learned and then got wrong go back into your drill queue.
  - Stockfish 19 (lite WASM, multi-threaded when cross-origin isolated) reviews every move.
  - Mistakes are classified with Lichess's win% thresholds and bucketed by cause: hung a piece, allowed mate, missed mate, walked into a fork, missed a tactic, walked into a tactic.
- **Puzzles.**
  - Every mistake from your analyzed games becomes a spaced-repetition puzzle.
  - Themed sets (forks, pins, mates, free pieces and more) come from the Lichess puzzle database, rated 500–1500, with an adaptive puzzle rating.
  - Themed puzzles you miss join your review queue.
- **Play.** Play Stockfish at five levels, with two optional training aids:
  - **Guard rails** warn you before you hang a piece, make a losing trade, or allow mate in one. No engine is involved; it's a static check.
  - **Checks/Captures/Threats** makes you tick all three before every move.

  Finished games go straight to review.
- **Stats.** Lines known, drill streak, puzzle accuracy, blunders per game, average accuracy, and the mistake you keep making.
- **Offline.** It's an installable PWA. The service worker caches the shell, assets, engine and puzzle packs.

All jokes live in `src/copy.ts`.

## Repertoire

| File | Side | Covers |
|---|---|---|
| `white-italian.pgn` | White | Giuoco Pianissimo, Two Knights (4.d3), Blackburne Shilling, Philidor, Petroff, Damiano |
| `white-anti.pgn` | White | Alapin vs Sicilian, Advance vs French and Caro-Kann, Scandinavian, Pirc/Modern, Alekhine, odd first moves |
| `black-caro.pgn` | Black | Caro-Kann: Advance, Exchange/Panov, Classical, Two Knights and sidelines |
| `black-slav.pgn` | Black | Slav vs 2.c4, the ...c6/...Bf5 setup vs the London, flank openings |

Lines are plain PGN in `src/repertoire/pgn/`. Edit them in any chess GUI or by hand. The test suite replays every move through chess.js and fails if:

- a move is illegal, or
- a position (including transpositions, across files for the same side) asks for two different moves.

Editing a line changes its id, so its drill progress starts over.

## Stack

- Vite + React + TypeScript
- [chessground](https://github.com/lichess-org/chessground)
- [chess.js](https://github.com/jhlywa/chess.js)
- [Stockfish.js](https://github.com/nmrugg/stockfish.js)
- [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)
- Dexie (IndexedDB)

All data stays in the browser. Settings can export and import a JSON backup of drill progress, puzzles and attempts; games re-import from Chess.com.

## Develop

```bash
npm install
npm run dev        # copies the engine into public/engine, then starts Vite
npm test
npm run build
npm run puzzles    # optional: rebuild public/puzzles from the Lichess database
```

`npm run puzzles` streams the Lichess puzzle CSV and stops once each theme has 400 puzzles, after about 185k rows and 20 s. The output is committed, so builds don't need the network.

## Deploy (Cloudflare Pages)

Connect the GitHub repo in Cloudflare Pages with these settings:

- Framework preset: none
- Build command: `npm run build`
- Build output: `dist`
- Environment variable: `NODE_VERSION=24`

### Security headers

`public/_headers` sets:

- A strict CSP: `script-src 'self' 'wasm-unsafe-eval'`, no inline scripts, and `connect-src` limited to `'self'` and `api.chess.com`.
- COOP/COEP for cross-origin isolation, which multi-threaded Stockfish needs.
- HSTS, `nosniff`, `no-referrer`, and a locked-down Permissions-Policy.

### Untrusted input

Untrusted input is validated before use:

- Chess.com API responses: shape, sizes, archive URL allowlist, and link targets.
- PGN data: only ever rendered as text.
- Backup files: schema-checked, all-or-nothing import.

With no `404.html`, Pages falls back to the SPA's `index.html`.

## Licence

GPL-3.0-or-later, because chessground and Stockfish are GPL-3; Stockfish's licence ships at `/engine/COPYING.txt`. The puzzles come from the [Lichess puzzle database](https://database.lichess.org/#puzzles), which is CC0.
