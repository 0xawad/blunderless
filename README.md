# ♞ blunderless

Fewer blunders. Better openings. Some light roasting.

A local-first chess trainer for improving club players. It runs entirely in the browser: no accounts, no backend.

## What it does

- **Today's plan.** Four small daily targets on the home page (due lines, puzzles, review your last game, one endgame) with a streak. Consistency is what moves rating.
- **Openings.** A small repertoire with the plans explained (130 lines, arrows and highlights on the key moves, a "what now" plan at the end of every chapter).
  - **Think first:** each of your moves is hidden until you play it on the board; two misses reveal it. Opponent moves play themselves.
  - Drill with spaced repetition (FSRS) until you play it on autopilot. Moves you keep forgetting are listed per opening as weak spots.
  - Each opening shows your real results from imported games: games, score, how deep you stay in book, and who leaves book first.
  - "Play it out" starts a game against Stockfish from the end of any line.
- **Games.** Imports your last 3 months from Chess.com.
  - Every game gets a book report: where you left your prep, or where your opponent did. Lines you had already learned and then got wrong go back into your drill queue.
  - Stockfish 19 (lite WASM, multi-threaded when cross-origin isolated) reviews every move.
  - **Review:** opening name (ECO, from the Lichess openings database), accuracy for both sides, per-phase accuracy, a clickable eval graph, key moments, and the game's "decided at" move.
  - Every mistake gets a plain-language explanation built from the engine line: what your move allowed ("After Qxg5 you lose the knight") and what the better move does.
  - **Retry** any mistake on the board; the engine grades your attempt. **Explore** any position: move pieces and the top three engine lines follow you.
  - Mistakes are classified with Lichess's win% thresholds (plus "missed win" and "book") and bucketed by cause: hung a piece, allowed mate, missed mate, walked into a fork, missed a tactic, walked into a tactic.
- **Endgames.** Thirteen must-know endings (mates, pawn endings, rook endings) played out against full-strength Stockfish from set positions, each with a one-line technique tip. Every position was checked with Stockfish.
- **Puzzles.**
  - Every mistake from your analyzed games becomes a spaced-repetition puzzle.
  - Themed sets (forks, pins, mates, free pieces and more) come from the Lichess puzzle database, rated 500–1500, with an adaptive puzzle rating.
  - Themed puzzles you miss join your review queue.
- **Play.** Play Stockfish at five levels, with two optional training aids:
  - **Guard rails** warn you before you hang a piece, make a losing trade, or allow mate in one. No engine is involved; it's a static check.
  - **Checks/Captures/Threats** makes you tick all three before every move.

  Finished games go straight to review.
- **Stats.** Lines known, drill streak, puzzle accuracy, blunders per game, average accuracy, and the mistake you keep making.
- **Offline.** It's an installable PWA. `src/sw.js` is emitted at build time with a per-build cache name, so each deploy drops the old cache. It caches the shell, assets, engine and puzzle packs.

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

- A strict CSP: no inline scripts. Scripts come only from `'self'` (plus `'wasm-unsafe-eval'` for Stockfish) and Cloudflare Web Analytics' `static.cloudflareinsights.com`. `connect-src` is limited to `'self'`, `api.chess.com` and `cloudflareinsights.com`. The analytics beacon sends `Cross-Origin-Resource-Policy: cross-origin`, so it works under COEP.
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
