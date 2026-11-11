# Blunderless design system

The interface is a quiet instrument: warm paper-and-ink neutrals, one serif for titles, and a board that is the only loud thing on screen. Colour is reserved for meaning. Every screen answers "what do I do next" with one primary action.

Source of truth: `src/styles/tokens.css` (tokens), `base.css` (type and utilities), `shell.css` (navigation), `components.css` (shared components), `board.css` (the board stage). React helpers live in `src/components/ui.tsx` and `src/components/Stage.tsx`. Page-specific layout goes in `src/styles/pages/<area>.css`, imported by the page that uses it.

## Principles

1. **The board is first-class.** On any screen with a board, the board is as large as the viewport height allows and nothing competes with it. Panels sit beside it (desktop) or scroll under it (phone).
2. **Lists over cards.** Use type and space first, then a hairline, then a divided list. A bordered surface (`.panel`) is for tools and forms only, and never nests.
3. **One primary action per view.** One ink-filled button. Everything else is ghost, quiet, or a text link.
4. **Colour means something.** Ink is for actions. Amber is the brand and "needs you now" (due counts, the current step). Green, yellow, orange, red and violet describe move quality or outcome and are never decoration.
5. **Say it plainly.** Sentence case. No exclamation marks. Numbers come with what they count. The jokes stay in `src/copy.ts`, in body copy, never in labels or buttons a user needs to scan.
6. **Motion confirms, it does not perform.** 120-320ms, ease-out, transform and opacity only. Everything respects `prefers-reduced-motion`.

## Tokens

| Group | Tokens | Notes |
|---|---|---|
| Neutrals | `--bg`, `--bg-2`, `--surface`, `--surface-2`, `--surface-3`, `--line`, `--line-strong` | One warm family. `--bg` is the page, `--bg-2` the rail, `--surface` a raised panel, `--surface-2/3` fills and hovers. |
| Text | `--text`, `--text-2`, `--muted` | All pass 4.5:1 on `--bg` and `--surface` in both themes. |
| Action | `--accent`, `--accent-hover`, `--accent-ink`, `--accent-soft` | Ink in light, paper in dark. |
| Brand | `--brand`, `--brand-ink`, `--brand-soft`, `--brand-text` | Amber. `--brand-text` is the text-safe variant. |
| Outcome | `--good`, `--bad`, `--warn`, `--info` and `-soft` pairs | Win/loss, success/error. Text on its own soft background passes AA. |
| Move quality | `--q-best`, `--q-good`, `--q-book`, `--q-inaccuracy`, `--q-mistake`, `--q-blunder`, `--q-missed` and `-fill` variants | Text variants for move lists, `-fill` for dots, graph marks and badges. Always pair with a glyph or label (WCAG 1.4.1). |
| Radius | `--radius-xs` 6, `--radius-sm` 8, `--radius` 12, `--radius-lg` 16 | Controls 8, panels 12-16, the board 6. |
| Space | `--s-1`..`--s-7` (4, 8, 12, 16, 24, 32, 48px) | Use the scale; avoid one-off rems. |
| Layout | `--rail`, `--header`, `--tabbar`, `--content`, `--gutter` | Set per breakpoint in `tokens.css`; never hard-code their values. |
| Elevation | `--shadow-soft`, `--shadow-pop`, `--shadow-board` | Soft for the active nav item and segmented thumb, pop for overlays and menus only. |
| Motion | `--t-fast` 120ms, `--t-med` 200ms, `--t-slow` 320ms, `--ease-out` | |
| Layers | `--z-board-ui`, `--z-sticky`, `--z-sheet`, `--z-toast`, `--z-skip` | No ad-hoc z-index. |

Themes: light and dark, following the system unless the user picks one (`data-theme` on `<html>`). Dark values are defined twice in `tokens.css` (media query and attribute); change both together.

## Typography

- **Display:** Fraunces (variable, optical size). Page titles (`h1`) and the brand only; also `.display` for a rare hero number.
- **Text:** Geist. Everything else. Weights 400, 500, 600.
- **Mono:** Geist Mono. Moves, evals, clocks, counts in tables (`.num`).
- Scale: `--fs-xs` 12, `--fs-sm` 13, `--fs-base` 15, `--fs-md` 17, `--fs-lg` 20, `--fs-xl` 26, `--fs-2xl` fluid 30-42.
- `h1` display 500, tight; `h2` 18px 600; `h3` 15px 600; `h4` 13px 600 muted.
- Body copy maxes at about 60 characters (`.lead` does this). Tabular numerals are on globally.
- Labels are sentence case. No uppercase tracking labels.

## Layout

- **Desktop (above 1180px):** a 232px left rail with labelled items in three groups: Today; Train (Openings, Puzzles, Endgames); Play and review (Play, Games, Progress). Settings and the sound/theme toggles sit at the bottom. No top bar, so the board gets the full height.
- **761-1180px:** the rail collapses to 68px icons with tooltips.
- **Phones (760px and below):** a 52px top bar (brand, More menu) and five bottom tabs: Today, Openings, Puzzles, Games, Play. Endgames, Progress and Settings are in the More menu. Training and review routes hide the tab bar (focus mode).
- Content column: `--content` (1160px) centred, `--gutter` side padding.
- Breakpoints in use: 1180 (rail), 900 (board stage stacks), 760 (phone shell), 560 (tight phone).

## Components

Use the React helper where one exists.

| Component | Class / helper | Use |
|---|---|---|
| Page header | `<PageHeader title kicker lead actions back>` | Top of every non-board page. One `h1` per page. |
| Section | `<Section title note action>` | A titled block under a hairline. Default way to group content. |
| Rows | `ul.rows > li > a.row-link` with `.row-main`, `.row-end`, `.chev` | Any list of things you can open: games, lines, tasks. |
| Panel | `.panel` (`.tight`, `.flush`) | Bordered surface for a form, a tool, a chart. Never nested. `.card` is the legacy alias; prefer `.panel` or no surface. |
| Button | `.btn` + `.primary` / `.ghost` / `.quiet` / `.danger` / `.danger-solid`, sizes `.small` `.lg`, `.block`, `.icon` | One `.primary` per view. |
| Text link | `.linklike` or a plain `<a>` | Tertiary actions. |
| Segmented | `<Segmented value onChange options label>` (`.seg`) | One choice of 2-5: tabs inside a panel, modes. |
| Chips | `.chips > .chip` (`.on`) | Filters and many-of-many choices. |
| Switch | `<Switch checked onChange label>` | Boolean settings. |
| Badge | `.badge` + `.due` / `.learning` / `.known` / `.good` / `.bad` / `.warn` | Status words. Square-ish, sentence case. |
| Dot | `.dot` + quality class | Move quality or status marker next to text. |
| Count | `.count` | Amber pill for "due now" numbers in navigation. |
| Stat | `<Stat value label unit delta>` in `.stats-row` | A number that matters plus what it is. No box around it. |
| Meter | `<LineMeter>` / `.meter`, `.progress` | Progress through a set. |
| Callout | `<Callout tone icon actions>` | Inline notices: nudges, errors, success. `tone="brand"` for the one thing that needs attention. |
| Empty state | `<EmptyState icon title actions center>` | Every list and tool has one, with the action that fills it. |
| Skeleton | `.skeleton > span` | Shaped like what is loading. `.spinner` only inside buttons. |
| Toast | `useToast()` | Transient confirmation. Errors stay until dismissed. |

### The board stage

Every screen with a board uses the same structure (`src/components/Stage.tsx`, `src/styles/board.css`):

```tsx
<Stage bars controls>            {/* bars: player bars; controls: a row under the board */}
  <StageBoard>
    <PlayerBar ... />
    <BoardRow>
      <EvalBar whitePct text orientation />   {/* review and analysis only */}
      <Board ... />
    </BoardRow>
    <PlayerBar ... />
    <StageControls> stepper, flip, hints </StageControls>
  </StageBoard>
  <StagePanel head={...} foot={...}> scrollable body </StagePanel>
</Stage>
```

- The panel head holds a kicker (where am I), the title, and at most one segmented control. The body scrolls. The foot pins the primary action.
- Inside the panel use `.panel-section` (hairline-separated blocks with a small `h3`), `.comment` (the coach's note, amber rule on the left), `.feedback` (right/wrong after a move), `.movelist` / `.moves-grid` (moves), `.engine-lines`.
- Move quality is shown three ways, always together: colour, a glyph (`<SquareBadge>` on the board, `?!`, `?`, `??` in lists), and the word in the explanation.
- On phones the board column is sticky under the top bar and the panel scrolls beneath it; the panel foot sticks to the bottom.

## Interaction

- Every interactive element has hover, active (1px press), focus-visible (2px ink outline) and disabled states. Touch targets are at least 40px on phones.
- Keyboard: arrows step through moves on board screens; `Esc` closes menus and cancels; shortcuts are shown next to the control they trigger (`<kbd>`).
- Loading: skeletons for pages, inline progress for engine work with a way to stop it. Never a blank screen: distinguish "loading" from "nothing here".
- Errors: say what failed and what to do, inline where the action was taken. Network failures always offer Retry.
- Destructive actions ask once, in place, and say exactly what is removed.

## Do not

- Add gradients, glass blur on content, glows, or coloured icon tiles.
- Put a card inside a card, or build a page from a grid of equal cards.
- Use colour alone for move quality or result.
- Use emoji or chess glyphs as icons in controls (chess piece glyphs are fine as content, e.g. figurine notation).
- Hard-code colours, radii, shadows or z-index outside `tokens.css`.
