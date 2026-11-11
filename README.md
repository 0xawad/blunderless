# ♞ blunderless

Fewer blunders. Better openings. Some light roasting.

A local-first chess trainer for improving club players. It runs entirely in the browser: no accounts, no backend.

## What it does

- **Today's plan.** Five small daily targets on the home page (due lines, one spar of a focus opening, puzzles, review your last game, one endgame) with a streak. Consistency is what moves rating.
- **Openings.** A small repertoire with the plans explained (130 lines, arrows and highlights on the key moves, a "what now" plan at the end of every chapter). Pick **focus** openings (Italian and Caro-Kann by default); they lead the Openings page, Home and the daily plan.
  - **Explore:** the whole repertoire as one move tree. Every position shows your move, the replies you need to know, and why. Play moves on the board or click through.
  - **Spar:** play the opening from memory like a game. The app picks the opponent's replies, leaning toward lines that are due, new or weak; finishing a line updates its drill schedule.
  - **Learn** with think first: each of your moves is hidden until you play it on the board; two misses reveal it. Lines that share moves with earlier ones start where they branch.
  - Drill with spaced repetition (FSRS) until you play it on autopilot. Moves you keep forgetting are listed per opening as weak spots.
  - Each opening shows how it holds up in real games: how often you actually play it when you could, your score, who leaves book first, the replies that take you out of prep, and where you drift off it yourself.
  - "What you actually play" lists every opening family in your imported games with your score.
  - "Play it out" starts a game against Stockfish from the end of any line.
- **Games.** Imports 1 to 12 months from Chess.com and Lichess, then only new games after that. Filter by result and speed.
  - Every game gets a book report: where you left your prep, or where your opponent did. Lines you had already learned and then got wrong go back into your drill queue.
  - Stockfish 19 (lite WASM, multi-threaded when cross-origin isolated) reviews every move in a background queue that keeps running while you use the rest of the app.
  - **Review:** opening name (ECO, from the Lichess openings database), Lichess-style accuracy for both sides (volatility-weighted plus harmonic mean), per-phase accuracy, a clickable eval graph, key moments, the game's "decided at" move, and jump-to-next-mistake.
  - **Clock:** time spent per move from the PGN clocks, time used in the opening, and how many of your mistakes came in time trouble or in a rush with time left.
  - When your opponent leaves book, the review shows the engine's reply.
  - Every mistake gets a plain-language explanation built from the engine line: what your move allowed ("After Qxg5 you lose the knight") and what the better move does or wins. Quiet moves are named, not dressed up.
  - **Retry** any mistake on the board; the engine grades your attempt. **Explore** any position: move pieces and the top three engine lines follow you.
  - Mistakes are classified with Lichess's win% thresholds (plus "missed win" and "book") and bucketed by cause: hung a piece, allowed mate, missed mate, walked into a fork, missed a tactic, walked into a tactic.
- **Endgames.** Thirteen must-know endings (mates, pawn endings, rook endings) played out against full-strength Stockfish from set positions, each with a one-line technique tip. Every position was checked with Stockfish.
- **Puzzles.**
  - Every mistake from your analyzed games becomes a spaced-repetition puzzle. Any move about as good as the engine's (within 5% win chance) also solves it.
  - Themed sets (forks, pins, mates, free pieces and more, or all mixed) come from the Lichess puzzle database with an adaptive puzzle rating. `npm run puzzles` builds packs spread over 100-point bands from 500 to 2200.
  - Themed puzzles you miss join your review queue.
- **Play.** Play Stockfish at six levels (rough ~400/~700/~1000, then calibrated 1400/1700/2000 via UCI_Elo), timed or untimed, with player bars and clocks, an opening name as the game develops, hints (piece first, then the move), undo in untimed games, a game that survives leaving the page (resume from Play or Home), a live coach that grades every move you play with the better move when there was one, and two optional training aids:
  - **Guard rails** warn you before you hang a piece, make a losing trade, or allow mate in one. No engine is involved; it's a static check.
  - **Checks/Captures/Threats** makes you tick all three before every move.

  Finished games go straight to review.
- **Stats.** Lines known, training streak, puzzle accuracy, blunders per game, accuracy overall and by phase, clock trouble, and the mistake you keep making.
- **Feel.** Ten piece sets (Staunty default; see `public/pieces/LICENSES.md`), five board colour schemes, a resizable board, light/dark app theme, a promotion picker, premoves, result cards on the board, adjustable piece animation, and synthesized sound effects (move, capture, check, castle, promote, right/wrong, win/lose), all generated with Web Audio so nothing is downloaded.
- **Offline.** It's an installable PWA. `src/sw.js` is emitted at build time with a per-build cache name, so each deploy drops the old cache. It caches the shell, assets, engine, puzzle packs, piece sets and the openings table, keeps the previous build's cache so an open tab keeps working through a deploy, and reloads if a chunk from an old build is gone.
- **Your data.** The app asks the browser for persistent storage so it isn't evicted, and Home reminds you to save a backup file every couple of weeks once you have real progress.

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

All data stays in the browser. Settings can export and import a JSON backup of drill progress, puzzles, attempts and games (with their analyses); Chess.com games can also be re-imported.

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
- Environment variable: `NODE_VERSION=22`

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
