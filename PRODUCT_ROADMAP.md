# Blunderless product roadmap

Blunderless is a local-first chess trainer for club players (roughly 600-1800). It has no backend and no accounts: games, drills and puzzles live in the browser. This document records what the product is for, what the takeover changed, and what comes next.

## What the product is for

Help a player lose fewer games to the same mistakes. In practice that is three things at this level: hanging pieces, missing one- and two-move tactics, and leaving the opening they meant to play. The product closes one loop:

1. Import your games (Chess.com or Lichess).
2. Stockfish reviews them and names what went wrong.
3. Each mistake becomes practice: a deviation puts the opening line back in your drill queue, a tactical mistake becomes a puzzle on a spaced-repetition schedule, and your weakest motif steers the themed puzzles you get.
4. Today tells you what to do, in order, in about fifteen minutes.
5. Progress shows whether your real games are getting better.

Other products own one part of this loop each (Chessable: move recall; Chessbook: repertoire coverage; Chess.com: game review; Lichess: learn from your mistakes and the puzzle dashboard; Aimchess: weakness plans). None joins them for one player without a subscription. That join is the reason to use Blunderless.

## Findings from discovery

Strengths kept as they were: the FSRS drill scheduler, the explained repertoire, own-mistake puzzles, the plain-language move explanations, the engine-free blunder guard, offline support, and the voice in `src/copy.ts`.

Weaknesses addressed:

- **The features did not talk to each other.** Home listed five fixed tasks; Stats showed numbers without telling you what to do about them; puzzles ignored what your games said about you.
- **Navigation hid things.** Endgames and Stats were small icons on phones; Drill and Learn lit no nav item; the top bar overflowed on tablets.
- **Card-on-card layouts.** Every screen was a stack of bordered boxes, and the board shared the stage with them.
- **Only Chess.com.** Lichess players had no way in.
- **Fragile edges.** A fresh user who skipped the username saw a blank home page. One failed month lost a whole import. See `TECHNICAL_AUDIT.md`.

## Decisions

| Area | Decision | Why |
|---|---|---|
| Navigation | Left rail on desktop grouped as Today / Train / Play and review; five tabs plus a More menu on phones; focus mode on training screens | The board needs the height; the groups mirror the loop. |
| Today | An ordered plan with reasons and one Start button, built from your data | A training app's home should answer "what now", not show tiles. |
| Coach | A small rules engine (`src/coach/`) that turns analysed games, puzzle attempts and drill reviews into a weakness profile, trends and recommendations, with minimum-sample gates | Five to seven plainly named signals with evidence beat an insights explorer. |
| Progress | Replaces Stats: trends over your last games, results by opening, colour and time control, the weakness profile, puzzle motifs | Shows whether real games improve, and links each weakness to practice. |
| Puzzles | Motif accuracy, a recommended theme from your games, a clearer solving flow, failure states | Tactics practice should follow what you actually miss. |
| Game review | Board-first layout, quality badges on the board, key moments first, a "practise this" block per game | Explanations and next steps over engine numbers. |
| Lichess import | Added next to Chess.com, same pipeline | The public API allows anonymous, CORS-enabled NDJSON export; it doubles the audience at low cost. |
| Opening explorer stats | Not added | The Lichess explorer now requires a login token; a no-backend app cannot depend on it. Opening names stay bundled. |
| Custom repertoires (PGN upload) | Deferred | The most-requested trainer feature elsewhere, but it needs the repertoire registry to become async and user-editable. Next milestone, done properly, not squeezed in. |
| Accounts, sync, social, leagues, XP | Not planned | They need a backend and do not make a single player better. |
| Lesson content | Not planned | Spaced repetition trains concrete answers; the repertoire notes and move explanations already carry the ideas. |

## Shipped in this takeover

- New design system and shell (`DESIGN_SYSTEM.md`).
- Today plan, coach engine, Progress page.
- Lichess game import; hardened Chess.com import.
- Redesigned openings, drill, explore/spar, puzzles, endgames, play, games and review screens on one board stage.
- Engineering and reliability fixes listed in `TECHNICAL_AUDIT.md` and `IMPLEMENTATION_NOTES.md`.

## Next

1. **Your own repertoire.** Import PGN or build lines in the explorer; store them in IndexedDB beside the bundled ones; stable line ids.
2. **Play from here.** Start a game against the engine from any mistake position or the end of any line, with a result that feeds the same schedule.
3. **Move-level scheduling.** Schedule the specific move you keep missing, not the whole line.
4. **More endgames in the scheduler.** Thirty to fifty must-know positions on spaced repetition.
5. **Keyboard command palette** for jumping to an opening, a game or the next task.
6. **Backups to a file handle** (File System Access API) so the fortnightly nudge can become automatic.
