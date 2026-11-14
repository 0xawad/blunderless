# Blunderless design system

The board is the brand. Everything that is not the board is neutral grey, set in one typeface, and the single action colour is taken from the dark squares of the board the player chose. Change the board and the whole app follows it.

Source of truth: `src/styles/tokens.css` (tokens), `base.css` (type and utilities), `shell.css` (navigation), `components.css` (shared components), `board.css` (the board stage), `system.css` (the layer described under "Review" below, loaded last). React helpers: `src/components/ui.tsx`, `src/components/Stage.tsx`. Page-specific layout: `src/styles/pages/<area>.css`. `polish.css` restyles screens still on older markup and shrinks as they are rebuilt; `legacy.css` is the old sheet they still depend on.

## Review against Apple's guidelines

The interface was reviewed with the apple-design skill (github.com/dickwu/apple-design-skill), which carries Apple's Human Interface Guidelines as reference pages. This is a web app, so the principles and foundations apply (accessibility, colour, type, layout, writing, motion, audio), and Apple's platform components do not. Pages opened for this review: the skill's five lenses, `playing-audio.md`, `motion.md`, `dark-mode.md`, `feedback.md`, `designing-for-games.md`.

**Verdict before the change: Needs work.** No accessibility failures, but the look was a template, and the skill names it exactly: "warm cream with a high-contrast serif and a terracotta accent" in light, "near-black with one ... accent" in dark. Nothing about a cream page, a serif title or an amber accent came from chess.

| Finding | Severity | Change |
|---|---|---|
| Templated palette and type pairing with no reason rooted in the product | High | Neutral greys; the tint comes from the player's board; the serif is gone |
| Brand colour used for decoration (logo, active tab, progress, current step) as well as "due" | Medium | Amber now means one thing: something is due. Selection, progress and the current step use the tint |
| Primary buttons were ink, indistinguishable from selected chips | Medium | Primary actions are filled with the tint; selection is a tinted wash |
| Phone body text 15px, controls 38px | High | 17px body and 44px controls on phones (skill, Lens 1: "mobile default 17 pt", "44 by 44 pt") |
| Theme toggle in the navigation | Medium | Removed from the sidebar. `dark-mode.md`: "Avoid offering an app-specific appearance setting." It stays in Settings and the phone menu, because on the web people expect to be able to override the system; that is a deliberate exception |
| Sounds were on or off, and would stop music on iPhone | Medium | Volume control; the audio session is "ambient" (`playing-audio.md`: sound that "isn't essential, and ... doesn't silence other audio", which "responds to the silence switch" and "mixes with other sounds") |
| No answer for increased contrast or reduced transparency | Medium | Stronger separators and text under `prefers-contrast: more`; blur removed under `prefers-reduced-transparency` |
| No haptics | Low | Short vibration patterns for moves, captures, checks and mistakes, with a setting (`designing-for-games.md`: "Support haptics to help players feel the action") |
| A piece dropped on an illegal square snapped back silently | Medium | A quiet double tap and a vibration (`feedback.md`: "Show people when a command can't be carried out") |

What was already right and is kept: the left sidebar that becomes a five-tab bar on phones, blur only on the floating bars, motion that is brief and optional, feedback in the interface instead of alerts, destructive actions that ask once in place.

**The one thing the design should be remembered by:** the app takes its colour from your board. **The one thing removed:** the display serif.

## Principles

1. **The board is first-class.** On any screen with a board, the board is as large as the viewport allows and nothing competes with it.
2. **Colour means something.** Tint is for actions and selection. Amber means due now. Green, yellow, orange, red and violet describe move quality or outcome, always with a glyph or a word as well.
3. **Lists over cards.** Type and space first, then a hairline, then a divided list. A bordered surface is for a tool or a form, and never nests.
4. **One primary action per view.** One tinted button. Everything else is ghost, quiet, or a link.
5. **Say it plainly.** Sentence case. No exclamation marks. The jokes live in `src/copy.ts`, in body copy, never in a label or a button.
6. **Motion confirms, it does not perform.** 120 to 320ms, ease-out, transform and opacity only, off under reduced motion.

## Tokens

| Group | Tokens | Notes |
|---|---|---|
| Neutrals | `--bg`, `--bg-2`, `--surface`, `--surface-2`, `--surface-3`, `--line`, `--line-strong` | Light page `#f5f5f4`, surface `#ffffff`. Dark page `#141415`, surface `#1e1e20`. |
| Text | `--text`, `--text-2`, `--muted` | Measured on the page: 15.8, 8.5 and 5.1 to 1 in light; 16.5, 11.1 and 6.8 in dark. |
| Tint | `--tint`, `--tint-hover`, `--tint-ink`, `--tint-text`, `--tint-soft` | Set per board on `:root[data-board=...]`. White on tint is 5.2 to 5.9 to 1 on every board; `--tint-text` on a surface is 6.3 to 7.4. |
| Ink | `--accent`, `--accent-ink`, `--accent-soft` | Neutral selection inside dense controls (current move, running clock, toasts). |
| Attention | `--brand`, `--brand-ink`, `--brand-soft`, `--brand-text` | Amber. Due counts and due badges only. |
| Outcome | `--good`, `--bad`, `--warn`, `--info` and `-soft` pairs; `--bad-ink` | Win and loss, success and error. |
| Move quality | `--q-best`, `--q-good`, `--q-book`, `--q-inaccuracy`, `--q-mistake`, `--q-blunder`, `--q-missed`, `--q-great`, `--q-brilliant` and `-fill` variants | Text variants pass 4.5 to 1 on a surface; `-fill` is for dots, badges and graph marks. |
| Radius | `--radius-xs` 6, `--radius-sm` 8, `--radius` 12, `--radius-lg` 16 | Buttons 10, groups 16, the board 6. |
| Space | `--s-1`..`--s-7` (4, 8, 12, 16, 24, 32, 48px) | |
| Layout | `--rail`, `--header`, `--tabbar`, `--content`, `--gutter` | Set per breakpoint; never hard-coded. |
| Motion | `--t-fast` 120ms, `--t-med` 200ms, `--t-slow` 320ms, `--ease-out` | |
| Layers | `--z-board-ui`, `--z-sticky`, `--z-sheet`, `--z-toast`, `--z-skip` | |

Board tints: Green `#3b7a3a`, Brown `#8a5a2c`, Stone `#6b655a`, Ocean `#47708a`, Rosewood `#9a5852`.

Themes follow the system. Dark values are defined twice in `tokens.css` (media query and attribute); change both together. The theme colours are repeated in `src/theme.ts`, `public/theme-init.js`, `index.html` and the manifest, and a test fails if they drift.

## Typography

- **One family:** Geist for everything, Geist Mono for moves, evaluations and clocks. Notation in mono is the product's own voice, the way a scoresheet looks.
- Titles: `h1` 28 to 34px, weight 700, tight tracking. `h2` 19px, 650. `h3` 15px, 600.
- Body: 15px on desktop, 17px on phones. Nothing below 12px.
- Body copy stays under about 60 characters a line. Tabular numerals everywhere.

## Layout

- **Desktop (above 1180px):** a 232px sidebar in three groups: Today; Train (Openings, Puzzles, Endgames); Play and review (Play, Games, Progress). The selected item is a tinted wash. Settings and the sound toggle sit at the bottom. No top bar, so the board gets the full height.
- **761 to 1180px:** the sidebar collapses to icons with tooltips.
- **Phones:** a top bar with the brand and a menu, and five tabs: Today, Openings, Puzzles, Games, Play. Training and review screens hide the tab bar so the board has the room; this is the one place tabs are hidden, and the back link is always on screen.
- Breakpoints: 1180 (sidebar), 900 (board stage stacks), 760 (phone shell), 560 (tight phone).

## Components

| Component | Class / helper | Use |
|---|---|---|
| Page header | `<PageHeader title kicker lead actions back>` | Top of every non-board page. |
| Section | `<Section title note action>` | A titled block under a hairline. |
| Rows | `ul.rows > li > .row-link` with `.row-main`, `.row-end` | Any list of things you can open. |
| Panel | `.panel` | Bordered surface for a form or a tool. Never nested. |
| Button | `.btn` + `.primary` (tint) / `.ghost` / `.quiet` / `.danger` / `.danger-solid`; `.small`, `.lg`, `.block`, `.icon` | One `.primary` per view. 44px tall on phones. |
| Segmented | `<Segmented>` | One choice of two to five. |
| Chips | `.chips > .chip` | Filters. Selected is a tinted wash. |
| Switch | `<Switch>` | Boolean settings. On is the tint. |
| Badge, dot, count | `.badge`, `.dot`, `.count` | Status words, quality markers, due numbers. |
| Stat | `<Stat>` in `.stats-row` | A number and what it counts. No box. |
| Callout | `<Callout tone>` | Inline notices. |
| Empty state | `<EmptyState>` | Every list has one, with the action that fills it. |
| Toast | `useToast()` | Transient confirmation. Errors stay until dismissed. |

### The board stage

Every screen with a board uses `<Stage>`, `<StageBoard>`, `<BoardRow>`, `<StageControls>` and `<StagePanel>` (`src/components/Stage.tsx`). The board is as tall as the viewport allows; the panel sits beside it on desktop and scrolls under it on phones. Move quality is always shown three ways together: colour, a glyph on the board square, and the word in the coach's note.

## Sound and touch

Sounds are synthesised (no audio files), short, and never essential: everything they say is also on screen.

| Event | Sound | Vibration |
|---|---|---|
| Your move | A wooden tap | 8ms |
| Their move | The same tap, lower and softer, so you can hear whose move it was | none |
| Capture | A heavier tap with a second knock | 14ms |
| Check, castle, promotion | Tap plus a bell; two taps; tap plus two rising bells | Short patterns |
| A drop on an illegal square | Two quiet dull taps | Two short pulses |
| Wrong answer | A falling thud | Two longer pulses |
| Right answer, win, loss, draw, low time, game start | Bells on one pentatonic scale, so cues never clash | Win and loss only |

Volume is a setting that scales the app's level only; the device volume has the last word. On iPhone and iPad the sounds obey the silent switch and mix with music that is already playing. Vibration has its own setting and works with sound muted.

## Do not

- Add gradients, glass blur on content, glows or coloured icon tiles.
- Use amber for anything except "due".
- Use colour alone for move quality or result.
- Use emoji or chess glyphs as icons in controls.
- Hard-code colours, radii, shadows or z-index outside `tokens.css`.
