// Today's plan: at most five steps, in order of value, each with a reason
// taken from the player's own data and a done-condition the app can check.
import { copy } from '../copy';
import { themeLabel, type MotifRecommendation } from './motifs';
import { fmtRate, type Profile, type Signal } from './profile';
import type { CoachCard, CoachGame, PlanRepertoire } from './slim';

const c = copy.coach.plan;

/** A plan is about fifteen minutes. Five steps is what fits. */
export const MAX_STEPS = 5;

/** Ten puzzle attempts a day completes the day's puzzle work. Carried over from the old Home page. */
export const DAILY_PUZZLES = 10;

/**
 * Of those ten, your own due mistakes get at most this many. They come
 * first because they cost you real games, but capping them leaves at least
 * four for the theme your games point at, so a long review queue cannot
 * crowd it out for good.
 */
export const OWN_PUZZLE_CAP = 6;

/** Rough minutes per unit of work, for the "about N minutes" estimate. */
export const MINUTES = { learn: 4, drillPerLine: 0.75, drillMax: 8, puzzle: 0.5, review: 4, import: 2, spar: 3, endgame: 2, play: 10 } as const;

/**
 * Base value of each step. Opening lines that are due go first (forgetting
 * them undoes work already done), then your own mistakes, then puzzles on
 * your weakest motif, then the newest game, then a spar and an endgame.
 * With more than five candidates the lowest drops out.
 */
const VALUE = { drill: 100, mistakes: 90, puzzles: 80, review: 70, spar: 60, endgame: 50 } as const;
/** A spar moves up when leaving your prep is one of your top weaknesses, but stays behind the game review. */
const PREP_BOOST = 8;
/** An endgame moves ahead of the spar when converting or the endgame itself is a top weakness. */
const ENDGAME_BOOST = 15;

export type PlanKind = 'drill' | 'learn' | 'spar' | 'mistakes' | 'puzzles' | 'review' | 'endgame' | 'import' | 'play';

export interface PlanStep {
  /** Stable within a day: 'drill', 'learn', 'mistakes', 'puzzles', 'review', 'import', 'spar', 'endgame' or 'play'. */
  id: string;
  kind: PlanKind;
  title: string;
  /** Why this step, from the player's own data. */
  reason: string;
  /** In-app URL. */
  to: string;
  /** Estimated minutes still to spend on it; 0 once done. */
  minutes: number;
  /** How many items the step covers (lines, puzzles), when that makes sense. */
  count?: number;
  done: boolean;
}

export interface Plan {
  steps: PlanStep[];
  doneCount: number;
  /** Estimated minutes left across the steps that are not done. */
  minutes: number;
  allDone: boolean;
  /** One sentence: what today is about and why. */
  headline: string;
  /** The first step that is not done: what the Start button opens. */
  next: PlanStep | null;
  /** Something extra for when the plan is finished: the next new line, or a game. Not counted in doneCount. */
  bonus: PlanStep | null;
  /** True for a brand-new user with no lines and no games. */
  onboarding: boolean;
}

export interface PlanContext {
  now: Date;
  /** Every repertoire, in display order. */
  repertoires: readonly PlanRepertoire[];
  /** Ids of the focus repertoires. */
  focus: readonly string[];
  /** Lines in the drill queue whose line still exists. */
  cards: readonly CoachCard[];
  games: readonly CoachGame[];
  /** Lines drilled today. */
  reviewsToday: number;
  /** Puzzles in the review queue that are due now. */
  puzzlesDue: number;
  /** Queue puzzles already reviewed today. */
  puzzlesReviewedToday: number;
  /** Every puzzle attempt today, queue or themed. */
  attemptsToday: number;
  /** The 'lastSpar' setting equals today. */
  sparredToday: boolean;
  /** Some value in the 'endgameWins' setting equals today. */
  endgameToday: boolean;
  endgames: readonly { id: string; title: string }[];
  /** Ids of endgames ever won. */
  endgamesWon: readonly string[];
  motif?: MotifRecommendation | null;
  profile?: Profile | null;
}

interface Candidate extends PlanStep {
  value: number;
}

/** Same rotation the old Home page used for the daily spar. */
export function dayOfYear(now: Date): number {
  return Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86_400_000);
}

function firstNewLine(reps: readonly PlanRepertoire[], have: ReadonlySet<string>) {
  for (const rep of reps) {
    const index = rep.lines.findIndex((l) => !have.has(l.id));
    if (index >= 0) return { rep, index };
  }
  return null;
}

function signalHeadline(s: Signal): string {
  const sig = copy.coach.signals;
  switch (s.id) {
    case 'hung':
      return sig.hung.headline(fmtRate(s.value));
    case 'tactics':
      return sig.tactics.headline(fmtRate(s.value));
    case 'mates':
      return sig.mates.headline(fmtRate(s.value));
    case 'clock':
      return sig.clock.headline(s.value);
    case 'prep':
      return sig.prep.headline(s.value);
    case 'conversion':
      return sig.conversion.headline(s.value);
    case 'phase':
      return sig.phase.headline(sig.phase.names[s.subject ?? ''] ?? s.subject ?? '', s.value);
    case 'colour':
      return sig.colour.headline(s.subject ?? 'white', s.value);
  }
}

export function buildPlan(ctx: PlanContext): Plan {
  const now = ctx.now.getTime();
  const day = dayOfYear(ctx.now);
  const top = ctx.profile?.top ?? [];

  const started = ctx.cards.length;
  const dueCards = ctx.cards.filter((card) => card.due <= now);
  const due = dueCards.length;
  const have = new Set(ctx.cards.map((card) => card.lineId));
  const focused = ctx.repertoires.filter((r) => ctx.focus.includes(r.id));

  // One pass over the games: the newest one you can review, and when each line last went wrong for real.
  let newest: CoachGame | undefined;
  const lastSlip = new Map<string, number>();
  for (const g of ctx.games) {
    if (!g.unreviewable && (!newest || g.at > newest.at)) newest = g;
    const lineId = g.book?.status === 'you-deviated' ? g.book.lineId : undefined;
    if (lineId && g.at > (lastSlip.get(lineId) ?? 0)) lastSlip.set(lineId, g.at);
  }
  // Forgotten: due, and a real game left the line after you last drilled (or learned) it.
  const forgotten = dueCards.filter((card) => (lastSlip.get(card.lineId) ?? 0) > Math.max(card.addedAt, card.lastReview)).length;

  const learnStep = (found: { rep: PlanRepertoire; index: number }, first: boolean): Candidate => ({
    id: 'learn',
    kind: 'learn',
    title: first ? c.learn.title(found.rep.title) : c.learn.next(found.rep.title),
    reason: first ? c.learn.reason : c.learn.nextReason,
    to: `/learn/${found.rep.id}/${found.index}`,
    minutes: MINUTES.learn,
    done: false,
    value: VALUE.drill,
  });
  const playStep = (reason: string): Candidate => ({
    id: 'play',
    kind: 'play',
    title: c.play.title,
    reason,
    to: '/play',
    minutes: MINUTES.play,
    done: false,
    value: 0,
  });
  const importStep: Candidate = {
    id: 'import',
    kind: 'import',
    title: c.import.title,
    reason: c.import.reason,
    to: '/games',
    minutes: MINUTES.import,
    done: false,
    value: VALUE.review,
  };

  const onboarding = started === 0 && ctx.games.length === 0;
  const candidates: Candidate[] = [];

  if (onboarding) {
    // Nothing to go on yet: one line, your games, one game.
    const first = firstNewLine(focused.length ? focused : ctx.repertoires, have);
    if (first) candidates.push(learnStep(first, true));
    candidates.push(importStep, playStep(c.play.reason));
  } else {
    // --- openings: learn the first line, or drill what is due -----------------
    if (started === 0) {
      const first = firstNewLine(focused.length ? focused : ctx.repertoires, have);
      if (first) candidates.push(learnStep(first, true));
    } else if (due > 0) {
      candidates.push({
        id: 'drill',
        kind: 'drill',
        title: c.drill.title(due),
        reason: forgotten ? c.drill.forgot(forgotten, due) : c.drill.due,
        to: '/drill',
        minutes: Math.min(MINUTES.drillMax, Math.max(1, Math.ceil(due * MINUTES.drillPerLine))),
        count: due,
        done: false,
        value: VALUE.drill,
      });
    } else {
      candidates.push({
        id: 'drill',
        kind: 'drill',
        title: ctx.reviewsToday ? c.drill.titleDone : c.drill.titleNone,
        reason: ctx.reviewsToday ? c.drill.done(ctx.reviewsToday) : c.drill.none,
        to: '/drill',
        minutes: 0,
        count: 0,
        done: true,
        value: VALUE.drill,
      });
    }

    // --- puzzles: ten a day, your own due mistakes first, the rest on the recommended theme ---
    const reviewed = ctx.puzzlesReviewedToday;
    const ownTarget = Math.min(ctx.puzzlesDue + reviewed, OWN_PUZZLE_CAP);
    const themedTarget = DAILY_PUZZLES - ownTarget;
    const themedToday = Math.max(0, ctx.attemptsToday - reviewed);
    const puzzleDayDone = ctx.attemptsToday >= DAILY_PUZZLES;

    if (ownTarget > 0) {
      const done = puzzleDayDone || ctx.puzzlesDue === 0 || reviewed >= ownTarget;
      const left = Math.min(ctx.puzzlesDue, Math.max(0, ownTarget - reviewed));
      candidates.push({
        id: 'mistakes',
        kind: 'mistakes',
        title: done ? c.mistakes.titleDone : c.mistakes.title(left),
        reason: done ? c.mistakes.done : c.mistakes.reason(ctx.puzzlesDue),
        to: '/puzzles',
        minutes: done ? 0 : Math.ceil(left * MINUTES.puzzle),
        count: done ? 0 : left,
        done,
        value: VALUE.mistakes,
      });
    }
    {
      const done = puzzleDayDone || themedToday >= themedTarget;
      const left = Math.max(0, themedTarget - themedToday);
      const theme = ctx.motif?.theme ?? 'mixed';
      candidates.push({
        id: 'puzzles',
        kind: 'puzzles',
        title: done
          ? c.puzzles.titleDone
          : theme === 'mixed'
            ? c.puzzles.titleMixed(left)
            : c.puzzles.title(left, themeLabel(theme).toLowerCase()),
        reason: done ? c.puzzles.done(ctx.attemptsToday) : (ctx.motif?.reason ?? copy.coach.motifs.fallback),
        to: ctx.motif?.to ?? '/puzzles?theme=mixed',
        minutes: done ? 0 : Math.ceil(left * MINUTES.puzzle),
        count: done ? 0 : left,
        done,
        value: VALUE.puzzles,
      });
    }

    // --- the newest game ------------------------------------------------------
    if (ctx.games.length === 0) {
      candidates.push(importStep);
    } else if (newest) {
      const reviewedGame = newest.review !== 'none';
      const opp = newest.opp || c.review.opponent;
      candidates.push({
        id: 'review',
        kind: 'review',
        title: reviewedGame ? c.review.titleDone : c.review.title,
        reason: reviewedGame ? c.review.done : c.review[newest.result](opp),
        to: reviewedGame ? '/games' : `/games/${encodeURIComponent(newest.id)}`,
        minutes: reviewedGame ? 0 : MINUTES.review,
        done: reviewedGame,
        value: VALUE.review,
      });
    }

    // --- one spar: the opening you keep leaving if there is one, else today's in the rotation ---
    const prep = top.find((s) => s.id === 'prep');
    const prepRep = prep?.subject ? focused.find((r) => r.lines.some((l) => l.id === prep.subject)) : undefined;
    const sparRep = prepRep ?? (focused.length ? focused[day % focused.length] : undefined);
    if (sparRep) {
      candidates.push({
        id: 'spar',
        kind: 'spar',
        title: c.spar.title(sparRep.title),
        reason: ctx.sparredToday ? c.spar.done : prep ? c.spar.prep(prep.value) : c.spar.reason,
        to: `/openings/${sparRep.id}/map?mode=spar`,
        minutes: ctx.sparredToday ? 0 : MINUTES.spar,
        done: ctx.sparredToday,
        value: VALUE.spar + (prep ? PREP_BOOST : 0),
      });
    }

    // --- one endgame: the first you have not won, else today's in the rotation ---
    if (ctx.endgames.length) {
      const won = new Set(ctx.endgamesWon);
      const fresh = ctx.endgames.find((e) => !won.has(e.id));
      const pick = fresh ?? ctx.endgames[day % ctx.endgames.length];
      const conversion = top.find((s) => s.id === 'conversion');
      const endPhase = top.find((s) => s.id === 'phase' && s.subject === 'endgame');
      candidates.push({
        id: 'endgame',
        kind: 'endgame',
        title: ctx.endgameToday ? c.endgame.titleDone : c.endgame.title(pick.title),
        reason: ctx.endgameToday
          ? c.endgame.done
          : conversion
            ? c.endgame.conversion(conversion.value)
            : endPhase
              ? c.endgame.phase(endPhase.value)
              : fresh
                ? c.endgame.fresh
                : c.endgame.again,
        to: ctx.endgameToday ? '/endgames' : `/endgames?eg=${encodeURIComponent(pick.id)}`,
        minutes: ctx.endgameToday ? 0 : MINUTES.endgame,
        done: ctx.endgameToday,
        value: VALUE.endgame + (conversion || endPhase ? ENDGAME_BOOST : 0),
      });
    }
  }

  // Array.prototype.sort is stable, so equal values keep the order above.
  const steps: PlanStep[] = (onboarding ? candidates : [...candidates].sort((a, b) => b.value - a.value))
    .slice(0, MAX_STEPS)
    .map(({ value: _value, ...step }) => step);

  const doneCount = steps.filter((s) => s.done).length;
  const allDone = steps.length > 0 && doneCount === steps.length;
  const next = steps.find((s) => !s.done) ?? null;

  // After the plan: a new line if nothing is due and one is waiting, otherwise a game.
  let bonus: PlanStep | null = null;
  if (!onboarding) {
    const nextLine = started > 0 && due === 0 ? firstNewLine(focused, have) : null;
    const { value: _value, ...step } = nextLine ? learnStep(nextLine, false) : playStep(c.play.bonus);
    bonus = step;
  }

  const mistakes = steps.find((s) => s.id === 'mistakes' && !s.done);
  const headline = onboarding
    ? c.headline.onboarding
    : allDone
      ? c.headline.allDone
      : forgotten > 0
        ? c.headline.forgot(forgotten)
        : top[0]
          ? signalHeadline(top[0])
          : due > 0
            ? c.headline.due(due)
            : mistakes
              ? c.headline.mistakes(ctx.puzzlesDue)
              : c.headline.steady;

  return {
    steps,
    doneCount,
    minutes: steps.reduce((n, s) => n + (s.done ? 0 : s.minutes), 0),
    allDone,
    headline,
    next,
    bonus,
    onboarding,
  };
}
