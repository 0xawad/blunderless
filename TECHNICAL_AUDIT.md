# Technical audit

Audit of the code at `92baa3e` (before the takeover), and what the `redesign/takeover` branch did about it. Sixty-nine findings were raised across six areas; an independent pass re-read the code for each one and confirmed 65 and refuted 4. Only confirmed findings are counted below.

## Architecture

- **No backend.** React 19, Vite, TypeScript. Data is in IndexedDB (Dexie, database `blunderless`: cards, reviews, settings, games, puzzles, attempts) and three localStorage keys (`prefs`, `theme`, `play-game`).
- **Engine.** Stockfish 19 lite (WASM) in one Web Worker, threaded when the page is cross-origin isolated. Every search is serialised on one promise chain in `src/engine/engine.ts`. The background review queue lives outside React in `src/games/queue.ts`.
- **Integrations.** Chess.com public API and, new, the Lichess game export (`src/chesscom.ts`, `src/lichess.ts`, shared polite fetch in `src/net.ts`). Themed puzzles are static packs built from the Lichess puzzle database; nothing is fetched from Lichess at solve time.
- **Repertoire.** Bundled PGNs compiled at module load into lines; drill scheduling is FSRS.
- **Coach.** New in this branch: `src/coach/` turns stored reviews, attempts and drill history into a weakness profile, trends, puzzle-motif stats and the daily plan. Pure functions, 2,000 lines of tests.
- **Hosting.** Cloudflare Pages, strict CSP and COOP/COEP in `public/_headers`. No secrets, no environment variables.

## Findings and status

| Area | Confirmed | Fixed | Open |
|---|---|---|---|
| Engine wrapper | 4 | 4 | 0 |
| Chess.com import, game store, analysis, queue, explanations | 12 | 11 | 1 |
| Game review and games list | 9 | 9 | 0 |
| Play | 12 | 8 | 4 |
| Openings, drill, endgames, puzzles | 7 | 3 | 4 |
| Backup and reset | 4 | 4 | 0 |
| Shell, styles, service worker, accessibility | 17 | 16 | 1 |

### Fixed, by severity

High:

- Stopping an analysis that had already finished killed the shared engine five seconds later, which also failed any background review in progress.
- Engine boot could hang forever if the worker stalled between `uciok` and `readyok`.
- One failed month discarded a whole Chess.com import. Imports now save month by month, retry with backoff, and report which months failed.
- Arrow keys during a retry in game review could land the engine's verdict on the wrong move and crash the page.
- In Play, undo while the coach was grading made the engine play your move; undo with one ply on the board left the game stuck on the engine's turn.
- Themed puzzle packs had no error handling: offline or a failed request left a blank trainer.
- The service worker served unhashed files (openings table, puzzle packs, engine) from the previous build's cache after a deploy.
- The board was invisible to keyboard and screen-reader users. It now has a text description, a live region and a typed-move field.
- The review board collapsed on short viewports (32px wide on a landscape phone). The new board stage has a floor.
- Home rendered blank forever for anyone who skipped the username at onboarding (found while walking the app, not in the audit).

Medium and low (selection): engine watchdog killed a slow search silently; games with no moves scored 100% accuracy; even trades were explained as losing a piece; non-engine failures were counted as reviewed; Stop did not stop the current game; re-analysis left stale puzzles; unknown game ids rendered blank; stale engine lines after stepping; an alternative mating move was judged wrong in retry; deep links from puzzles opened at move zero; the games list re-rendered every row on each engine tick; restore ran with no confirmation; reset left puzzle rating and endgame wins behind; two theme states drifted apart; route changes moved neither focus nor the page title; focus ring removed from sliders and checkboxes; white text on the dark-theme danger colour failed contrast; top navigation overflowed on tablets; the theme flashed on first paint; error toasts vanished after three seconds; piece animation ignored reduced motion; the welcome form saved an unknown username and auto-advanced.

### Open

| Finding | Severity | Why it is open |
|---|---|---|
| A line's id is its full move path, so editing a bundled PGN orphans that line's drill history | High | Needs a prefix-match migration with tests. No bundled PGN was changed in this branch, so no user is affected yet. Do this before the next repertoire edit. |
| Weak-spots list is an all-time count that never decays | Medium | Needs a recent-window rule in `weakSpots` (`src/srs/db.ts`). |
| Opening page replays every stored game during render | Medium | Should reuse the shared report cache that the openings index uses. |
| Play: coach and prepare searches run on the engine's clock | Low | Verifier rated the impact low; needs the clock accounting reworked. |
| Play: saved-game validation accepts a partially corrupt save | Medium | Resume should refuse a save that does not replay fully. |
| Play: the page is still one large component | Maintainability | The races were fixed in place with position checks after each await; extracting a tested state machine is the proper follow-up. |
| Endgame trainer dead-ends when an engine search fails | Low | Needs the same Retry state Play now has. |
| Analysis results are not persisted per position | Low | An in-memory cache covers retries within a tab; persisting needs a new table for little gain. |
| Dark palette is defined twice in `tokens.css` | Low | `light-dark()` would remove the duplication; tests fail if the two copies or the theme-init script drift. |

## Security

- No secrets in the repository or the bundle. No environment variables are needed.
- CSP stays `default-src 'none'` with `connect-src` limited to self, `api.chess.com`, `lichess.org` and Cloudflare Insights. `lichess.org` was added for the game import.
- Usernames are validated before they reach a URL. Imported PGNs are size-capped and parsed by chess.js; nothing from either site is rendered as HTML.
- Backup files are validated field by field before anything is written, and a game `url` is kept only when it points at chess.com or lichess.org (tested).
- The service worker never caches cross-origin responses.
- **Piece-set licences.** Several bundled piece sets, including the default Staunty, are CC BY-NC-SA; others are GPL or AGPL. That is compatible with a free, non-commercial, open-source app with attribution (`public/pieces/LICENSES.md`), and not with commercial use. Not changed; flagged for a decision.

## Performance

- Baseline bundle: 368 kB main JS (118 kB gzip), 72 kB CSS. Now: 397 kB (127 kB gzip) and 105 kB CSS (22 kB gzip, including a legacy sheet that still carries rules for screens not yet rebuilt). The growth is the coach, the Lichess importer and the second font.
- The games list maps rows to a slim shape inside the query, renders 60 at a time, memoises rows, and subscribes to engine progress in one cell.
- Imports parse PGNs in chunks that yield to the event loop.
- The coach reads slim projections and computes about 10 ms for 10,000 games (measured in tests on a desktop; not measured on a phone).
- A batch review reuses evaluations for positions it has already searched.

## Not verified

- **Live Chess.com and Lichess imports.** The development machine intercepts TLS, so neither API could be called. Both importers are tested against fixtures written from the official API documentation. Test both with a real username before merging.
- **Service worker and CSP in production.** Tested in a Node simulation and by reading the built output; not exercised on a deployed preview.
- **Screen readers.** The board's accessibility output is unit tested but has not been heard in assistive technology.
- **Visual review.** The browser pane could not take screenshots for most of the work, so layout was checked by measuring elements and reading rendered text at 1360px and 390px, not by eye.
