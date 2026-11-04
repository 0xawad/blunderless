# ♞ blunderless

Fewer blunders. Better openings. Some light roasting.

A local-first chess trainer: learn a small opening repertoire with the plans explained, then drill it with spaced repetition (FSRS) until your hands play it on autopilot. Game import and blunder review from Chess.com come next.

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

Vite + React + TypeScript · [chessground](https://github.com/lichess-org/chessground) · [chess.js](https://github.com/jhlywa/chess.js) · [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) · Dexie (IndexedDB)

All progress stays in the browser. You can export and import a JSON backup from Settings.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm test
npm run build
```

## Deploy (Cloudflare Pages)

Connect the GitHub repo in Cloudflare Pages with these settings:

- Framework preset: none
- Build command: `npm run build`
- Build output: `dist`
- Environment variable: `NODE_VERSION=22`

`public/_headers` ships a strict CSP (no inline scripts, no third-party origins except `api.chess.com`), COOP/COEP for cross-origin isolation (needed for multi-threaded Stockfish later), HSTS, and a locked-down Permissions-Policy. With no `404.html`, Pages falls back to the SPA's `index.html`.

## Licence

GPL-3.0-or-later. chessground is GPL-3, and so is Stockfish, which arrives in phase 2.
