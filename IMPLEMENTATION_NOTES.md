# Implementation notes

Running record of the takeover on branch `redesign/takeover`. Nothing here is on `main`.

## Milestones

| # | Milestone | Done when | Status |
|---|---|---|---|
| 1 | Baseline and audit | Tests and build green on a new branch; findings verified | Done (86 tests, clean build; 65 confirmed findings) |
| 2 | Design foundation | Tokens, shell, shared components, board stage render on desktop and phone | Done |
| 3 | Platform, data layer, coach | Theme store, service worker fix, board accessibility; hardened imports plus Lichess; coach rules with tests | Done (421 tests) |
| 4a | Today and Progress on the coach | Both pages render for a new user; plan steps link to working deep links | Done |
| 4b | Games, Welcome, Settings, backup | Two-source sync, account form, confirmed restore, full reset; backup tests | Done (424 tests) |
| 4c | Board screens | One board layout everywhere; confirmed review, puzzle, play and opening bugs fixed | Done for layout and bugs; panel content not yet rebuilt (see below) |
| 5 | Integration | `tsc`, `vitest`, `npm run build` clean | Done (30 files, 424 tests, build clean) |
| 6 | Visual QA | Every route checked at desktop and phone widths, light and dark | Partial: measured and read, not seen. Screenshots were unavailable |
| 7 | Docs and handover | Audit, roadmap, design system, these notes | Done |

## Architecture findings (short)

- No backend. Data is IndexedDB (Dexie, db `blunderless`) plus a few localStorage keys (`prefs`, `theme`, `play-game`).
- One Stockfish worker, all jobs serialised on a promise chain (`src/engine/engine.ts`). The background analysis queue lives outside React (`src/games/queue.ts`).
- Repertoires are bundled PGNs compiled at module load; a line's id is its full move path, so editing a PGN orphans its drill card. A prefix-match migration is still open (see `TECHNICAL_AUDIT.md`).
- Styles were one 800-line global sheet. Now: `src/styles/tokens.css`, `base.css`, `shell.css`, `components.css`, `board.css`, page CSS under `src/styles/pages/`, and `legacy.css` for anything not yet moved.
- CSP is strict (`public/_headers`); anything new must be same-origin except `api.chess.com` and `lichess.org` for imports.

## Changes so far

- New shell in `src/App.tsx`: left rail (labels above 1180px, icons below), phone top bar with a More menu and five bottom tabs, a proper not-found page, `/progress` alias for `/stats`.
- Shared primitives in `src/components/ui.tsx` and the board stage in `src/components/Stage.tsx`.
- Fixed: Home rendered blank for users with no username.
- Fixed: focus ring was removed from sliders and checkboxes; white text on the dark-theme danger colour failed contrast (`--bad-ink`).
- Added dependency: `@fontsource-variable/fraunces` (self-hosted, titles only).
- `.claude/` added to `.gitignore`.

## What changed after the foundations

- **Today** (`src/pages/Home.tsx`): the coach's plan as numbered steps with reasons and minutes, one Start/Continue button, "What your games say", focus openings as rows.
- **Progress** (`src/pages/Stats.tsx`, `src/components/charts.tsx`): headline stats with last-10 deltas, an accuracy and blunders chart, the weakness profile, results by colour, time control and opening, puzzle motifs with a recommended theme.
- **Games** (`src/pages/Games.tsx`): one Sync for every connected account with progress, cancel and per-month failure messages; inline account form; chips for result, speed and site; search; 60 rows at a time.
- **Accounts** (`src/components/AccountForm.tsx`): shared by Welcome, Games and Settings. An unknown name is never saved without the user choosing to.
- **Backup** (`src/srs/backup.ts`): accepts Lichess games and the Lichess account; restore is staged and confirmed; reset clears progress-bearing settings and keeps accounts.
- **Board screens**: the older `.play`/`.side` markup now gets the stage layout from `board.css`, so every board is as tall as the viewport allows with the panel beside it, and pinned above the panel on phones. Game review uses the shared eval bar on a win-probability scale and shows a quality badge on the destination square.
- **Deep links**: `/games/<id>?ply=N`, `/puzzles?theme=<id>`, `/endgames?eg=<id>`.

## Known gaps

- Openings index, opening page, Learn, Drill, Explore/Spar, Puzzles, Endgames, the Play setup screen and the review side panel keep their previous markup. They pick up the new tokens, type, buttons and board layout, but their panels have not been rebuilt on `<Stage>`/`<Section>` and still use `src/styles/legacy.css`. That file can be deleted once they are.
- Open engineering items are listed in `TECHNICAL_AUDIT.md`.

## Migrations and compatibility

- No Dexie schema change. New optional fields on games (`unanalysable`, `openingChecked`) and new settings (`lichessUsername`, `importedLichess`). Existing data reads unchanged.
- All routes kept. `/progress` redirects to `/stats`.
- localStorage keys unchanged. Reduced-motion users with no saved animation choice now default to no piece animation.
- New dependency: `@fontsource-variable/fraunces`. No environment variables, no new services.

## Working rules for the rest of the job

- No further repository-wide scans: the verified audit is the source for what to fix.
- No new agent fan-outs after the current implementation run; QA and fixes are done directly, file by file.
- Each milestone is closed by a command result or a browser check, recorded in the table above.

## Game review pass (after going live)

- Tested on the live site with real Chess.com games: sync of 73 games, then a 73-game review batch, completed with no errors.
- `src/games/story.ts`: two-sentence game verdict and labelled key moments, from stored analysis only.
- `src/games/explain.ts`: opponent moves say "they"; best and good moves are described when there is something concrete; recaptures are not "free pieces"; forks must hit the king, a bigger piece or an undefended one; missed mates are read from the stored evals (`mateFor`).
- `src/games/analyze.ts`: second pass re-searches up to 12 positions around suspected errors at depth 15. Reviews made before this keep their depth-12 verdicts until re-analysed; no version bump, so nothing is marked stale.
- `GameAnalysis.finalPv` (optional): lets the last move of a game be explained. Older reviews do not have it.
- Game review: coach note for the current move on every tab, hint inside a retry, `?ply=N` waits for the game to load.
- Fixed: connecting an account on the welcome screen did not leave the screen.
- Not measured: review speed with the second pass on a phone. On this desktop the first pass alone ran about 15 games a minute.

## Labels, UI sweep and open items

- **Great and brilliant moves** (`MoveReview.merit`, optional). A played move that matched the engine gets one extra depth-10 search with that move excluded (`searchmoves`), which gives the second-best evaluation. Great: every alternative costs at least 20 points of win chance, the position was not already won (under 90%), and the move is not an obvious capture. Brilliant: a sacrifice that is still clearly best. On 14 real games this produced five great moves and no brilliants; the first version, without the capture rule, labelled "taking a hanging queen" as great and was rejected.
- **Review cost.** With the second pass and the merit pass a game took about 9 to 12 seconds on a desktop in a possibly throttled pane; the first pass alone was about 4.
- **UI sweep** at 1360px and 390px with real data. Endgames is now rows under sections; the opening page and Play setup lost their boxed cards (`src/styles/polish.css`, to be deleted as those pages are rebuilt); on phones the review's coach note sits directly under the board.
- **Not a bug:** plan steps that looked invisible in screenshots were the test browser freezing CSS animations while its pane was hidden.
- Existing reviews do not have merit labels or `finalPv` until the game is reviewed again.

## Play pass

- The game screen is on the shared board stage: player bars, board, a control row (step through moves, flip, hint, undo), and a panel with the opponent and opening in its head, the status, coach verdict and move list in its body, and the actions pinned in its foot.
- Rematch (same opponent and clock, colours swapped) from the result overlay and the panel. "New game" is not offered mid-game: resign ends a game, and before the first move the button reads "Change setup".
- Offer draw: considered after 30 plies, accepted when your winning chance is at least 50%.
- "Play from here" in game review opens Play from the position on the board.
- Checked in the browser by script (the app window was hidden, so no screenshots): a move, the verdict, the engine's reply, resign with confirmation, the result overlay, rematch as Black with the engine moving first; no page scroll at 1360x850; no horizontal overflow at 390px.

## Play pass 2

- **Your openings** (`src/play/opening.ts`, setup option, on by default): while a game is inside your repertoire for the colour you are playing, the engine's reply comes from the repertoire, weighted by how many lines pass through each move. Out of book it searches as before. Checked in the browser: 1.e4 e5 2.Nf3 f6 as White (a line in the Italian repertoire); 1.d4 from the engine when playing Black.
- **Draw rule** moved to the same module and tested (too early, accept, decline).
- **Phones:** a game in progress hides the tab bar. A dragged piece is lifted above the finger and enlarged on touch screens (`pointer: coarse`); with a mouse it still follows the pointer exactly. The lift is confirmed to apply under phone emulation and has not been tried on a real phone.
