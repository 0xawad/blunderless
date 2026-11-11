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
