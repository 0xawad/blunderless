// The weakness profile: a handful of plainly named signals, each with the
// player's own numbers, a minimum sample before it says anything, and one
// thing to do about it inside the app.
import { copy } from '../copy';
import type { BlunderKind } from '../srs/types';
import { KIND_THEMES, puzzlesUrl, themeLabel } from './motifs';
import {
  PHASES,
  newestFirst,
  ownMovesBefore,
  type CoachCard,
  type CoachGame,
  type CoachLine,
  type Phase,
  type PlanRepertoire,
} from './slim';

const c = copy.coach;

// ---------------------------------------------------------------------------
// Thresholds. Rates are per analysed game; a "mistake" here is a move the
// review classed as a mistake, a blunder or a missed win (20+ points of win
// probability), so these are large errors, not inaccuracies. The numbers are
// judgment calls from how often each one decides a club game. They are named
// so they can be tuned against real data without touching the rules.
// ---------------------------------------------------------------------------

/**
 * The profile reads your most recent analysed games, this many at most.
 * Thirty is a couple of weeks of regular blitz: recent enough to describe
 * how you play now, long enough that one bad evening does not move it.
 */
export const PROFILE_WINDOW = 30;

/**
 * Below this many games nothing is called weak or fine. With fewer, one
 * game moves a per-game rate by more than the gap between "fine" and "weak".
 */
export const MIN_GAMES = 8;

/** Calling something a strength needs more games than calling it fine: eight clean games can be luck. */
export const MIN_GAMES_STRONG = 15;

/** A rate also needs this many actual events to be weak. Two can be one bad game; three is a habit. */
export const MIN_EVENTS = 3;

/**
 * Hung pieces per game. A hung piece usually decides the game on its own, so
 * one every second game (0.5) means it is settling a large share of your
 * results. One in five games (0.2) is about what the top of this app's
 * audience manages.
 */
export const HUNG = { weak: 0.5, strong: 0.2 } as const;

/**
 * Tactics missed or walked into, per game (forks included). This is the
 * catch-all bucket, so it runs higher than the others for everyone: weak
 * starts at three every two games, and solid is a little over one every two.
 */
export const TACTICS = { weak: 1.5, strong: 0.6 } as const;

/**
 * Mates allowed or missed, per game. Each one flips a result outright, so
 * the bar is lower: roughly one game in three is weak, one in ten is solid.
 */
export const MATES = { weak: 0.3, strong: 0.1 } as const;

/**
 * Share of your mistakes made in time trouble or played in under 3 seconds.
 * 40% is the bar the old Stats page used for "a big share of your mistakes
 * are about the clock"; it is kept. A share over fewer than ten mistakes
 * moves 10 points per mistake, so it is not read before that.
 */
export const CLOCK = { weak: 0.4, strong: 0.15, minGames: MIN_GAMES, minErrors: 10 } as const;

/**
 * Leaving your prep first, as a share of recent games that followed your
 * repertoire for at least two of your own moves (one move is not "following
 * prep": it is just 1.e4). Book reports do not need analysis, so this reads
 * your last `window` games rather than the analysed ones. Club opponents
 * leave book early and often, so being the one who leaves in a third of
 * games is a lot; under 15% is solid.
 */
export const PREP = { weak: 0.35, strong: 0.15, minGames: MIN_GAMES, window: 60, minOwnMoves: 2 } as const;

/**
 * Share of games you did not win after being clearly winning on at least
 * `turns` of your own turns (two, so a single missed shot is a tactic, not a
 * thrown game). Even strong players let about one in ten slip; three in ten
 * is points handed back every week. Read only once there are six such games.
 */
export const CONVERSION = { weak: 0.3, strong: 0.1, minGames: 6, minGamesStrong: 10, turns: 2 } as const;

/**
 * Accuracy gap, in points, between your weakest phase and the rest of the
 * game. Book moves cost nothing, so the opening scores a few points higher
 * for everyone and the middlegame normally trails the rest by 5 to 7. Ten
 * clears that built-in gap. A phase is compared only with 60 of your moves
 * across at least five games behind it.
 */
export const PHASE_GAP = { weakGap: 10, minMoves: 60, minGames: 5 } as const;

/**
 * Score gap between White and Black over your last `window` games. It is
 * reported only when it is at least `minGap` points and at least two
 * standard errors of the difference, so a run of luck with one colour is
 * not called a weakness. Under 15 games a side there is nothing to compare.
 */
export const COLOUR = { minGap: 12, sigmas: 2, minGames: 15, window: 200 } as const;

// ---------------------------------------------------------------------------

export type SignalId = 'hung' | 'tactics' | 'mates' | 'prep' | 'conversion' | 'clock' | 'phase' | 'colour';
export type SignalStatus = 'weak' | 'ok' | 'strong' | 'insufficient';

export interface SignalAction {
  kind: 'drill' | 'puzzles' | 'play' | 'endgames' | 'review' | 'openings';
  /** In-app URL. */
  to: string;
  label: string;
}

/** A spot to look at: /games/<gameId>?ply=<ply> shows the position before that move. */
export interface SignalExample {
  gameId: string;
  ply: number;
}

export interface Signal {
  id: SignalId;
  title: string;
  status: SignalStatus;
  /** The measured number: a per-game rate, a share (0-100) or a gap in points. 0 when insufficient. */
  value: number;
  valueText: string;
  /** What a good number looks like. */
  baselineText?: string;
  /** One plain sentence with the player's own numbers. */
  evidence: string;
  /** How many games the number is based on. */
  sample: number;
  /** Up to 3, most recent first. */
  examples: SignalExample[];
  action: SignalAction;
  /** How far past the "weak" line this is (1 = on it). 0 unless weak. Orders `top`. */
  severity: number;
  /** What it points at: a blunder kind, a phase, a colour or a line id. */
  subject?: string;
}

export interface KindCount {
  kind: BlunderKind;
  count: number;
  perGame: number;
}

export interface PhaseAccuracy {
  /** Move-weighted accuracy 0-100; null when the phase was never reached. */
  accuracy: number | null;
  moves: number;
  games: number;
}

export interface Profile {
  /** Every signal, in a fixed order. The colour gap is listed only when it is clearly there. */
  signals: Signal[];
  /** Up to 3 weak signals, worst first. */
  top: Signal[];
  strengths: Signal[];
  sample: {
    /** All stored games. */
    games: number;
    /** Games analysed by the current analysis version. */
    analysed: number;
    /** How many of those the profile read (at most PROFILE_WINDOW). */
    window: number;
    /** Games with an older analysis, left out until re-analysed. */
    stale: number;
  };
  /** "Based on your last 30 analysed games." */
  basisText: string;
  /** "12 older reviews are left out until re-analysed.", or null when there are none. */
  staleText: string | null;
  /** Your mistakes in the window by kind, commonest first. */
  kinds: KindCount[];
  phases: Record<Phase, PhaseAccuracy>;
}

export interface ProfileInput {
  games: readonly CoachGame[];
  /** Lines in the drill queue, to tell "drill it" from "learn it". */
  cards?: readonly CoachCard[];
  /** Repertoire lines by id, to name and link the line you keep leaving. */
  lines?: ReadonlyMap<string, CoachLine>;
  repertoires?: readonly Pick<PlanRepertoire, 'id' | 'title' | 'side'>[];
  focus?: readonly string[];
}

const KINDS: readonly BlunderKind[] = ['hung-piece', 'allowed-mate', 'missed-mate', 'fork', 'missed-tactic', 'walked-into-tactic'];
const ORDER: readonly SignalId[] = ['hung', 'tactics', 'mates', 'prep', 'conversion', 'clock', 'phase', 'colour'];
const GROUP: Record<BlunderKind, 'hung' | 'tactics' | 'mates'> = {
  'hung-piece': 'hung',
  'allowed-mate': 'mates',
  'missed-mate': 'mates',
  fork: 'tactics',
  'missed-tactic': 'tactics',
  'walked-into-tactic': 'tactics',
};

/** "0.5", "1.8"; two decimals only when one would round a real rate down to nothing. */
export function fmtRate(x: number): string {
  if (x <= 0) return '0';
  return x < 0.1 ? x.toFixed(2) : x.toFixed(1);
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const moveNo = (ply: number) => Math.floor(ply / 2) + 1;
const points = (g: CoachGame) => (g.result === 'win' ? 1 : g.result === 'draw' ? 0.5 : 0);

/** Deep link to an example: the game review, opened on the position before that move. */
export const exampleUrl = (e: SignalExample): string => `/games/${encodeURIComponent(e.gameId)}?ply=${e.ply}`;

function rateStatus(rate: number, events: number, games: number, t: { weak: number; strong: number }): SignalStatus {
  if (games < MIN_GAMES) return 'insufficient';
  if (rate >= t.weak && events >= MIN_EVENTS) return 'weak';
  if (rate <= t.strong && games >= MIN_GAMES_STRONG) return 'strong';
  return 'ok';
}

const puzzleAction = (theme: string): SignalAction => ({
  kind: 'puzzles',
  to: puzzlesUrl(theme),
  label: c.practise(themeLabel(theme).toLowerCase()),
});

/** The commonest of `kinds`; the first one listed when none has happened. */
function mainKind(counts: Record<BlunderKind, number>, kinds: readonly BlunderKind[]): BlunderKind {
  return kinds.reduce((best, k) => (counts[k] > counts[best] ? k : best), kinds[0]);
}

export function buildProfile(input: ProfileInput): Profile {
  const games = newestFirst(input.games);

  // The profile window: your most recent games analysed by the current version.
  const recent: CoachGame[] = [];
  let analysed = 0;
  let stale = 0;
  for (const g of games) {
    if (g.a) {
      analysed++;
      if (recent.length < PROFILE_WINDOW) recent.push(g);
    } else if (g.review === 'stale') stale++;
  }
  const n = recent.length;

  // One pass over the window collects everything the analysis-based signals read.
  const counts = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<BlunderKind, number>;
  const examples: Record<SignalId, SignalExample[]> = { hung: [], tactics: [], mates: [], prep: [], conversion: [], clock: [], phase: [], colour: [] };
  const push = (id: SignalId, gameId: string, ply: number) => {
    if (examples[id].length < 3) examples[id].push({ gameId, ply });
  };
  const phaseAcc = { opening: { sum: 0, moves: 0, games: 0 }, middlegame: { sum: 0, moves: 0, games: 0 }, endgame: { sum: 0, moves: 0, games: 0 } };
  const clock = { games: 0, errors: 0, low: 0, hasty: 0, endedLow: 0 };
  const conv = { winning: 0, lost: 0, drawn: 0, sudden: 0 };

  for (const g of recent) {
    const a = g.a!;
    const seen = { hung: false, tactics: false, mates: false, clock: false };
    for (const e of a.errors) {
      if (!(e.kind in counts)) continue;
      counts[e.kind]++;
      const group = GROUP[e.kind];
      // One example per game, so three examples are three different games.
      if (!seen[group]) {
        seen[group] = true;
        push(group, g.id, e.ply);
      }
      if (e.clock && !seen.clock) {
        seen.clock = true;
        push('clock', g.id, e.ply);
      }
    }
    if (a.clock) {
      clock.games++;
      clock.errors += a.blunders + a.mistakes;
      clock.low += a.clock.low;
      clock.hasty += a.clock.hasty;
      if (a.clock.endedLow) clock.endedLow++;
    }
    if (a.winningTurns >= CONVERSION.turns) {
      conv.winning++;
      if (g.result !== 'win') {
        if (g.result === 'loss') conv.lost++;
        else conv.drawn++;
        // Thrown in one move (the review's "missed win"), as opposed to drifting away.
        if (a.errors.some((e) => e.missedWin)) conv.sudden++;
        push('conversion', g.id, Math.max(0, a.lastWinningPly));
      }
    }
    if (a.phases) {
      for (const ph of PHASES) {
        const p = a.phases[ph];
        if (p.moves > 0) {
          phaseAcc[ph].sum += p.accuracy * p.moves;
          phaseAcc[ph].moves += p.moves;
          phaseAcc[ph].games++;
        }
      }
    }
  }

  const need = (): string => c.needGames(n, MIN_GAMES);
  const signals: Signal[] = [];

  // --- hung pieces -----------------------------------------------------------
  {
    const events = counts['hung-piece'];
    const rate = n ? events / n : 0;
    const status = rateStatus(rate, events, n, HUNG);
    signals.push({
      id: 'hung',
      title: c.signals.hung.title,
      status,
      value: status === 'insufficient' ? 0 : round1(rate),
      valueText: status === 'insufficient' ? c.noValue : c.perGame(fmtRate(rate)),
      baselineText: c.rateBaseline(fmtRate(HUNG.strong), fmtRate(HUNG.weak)),
      evidence: status === 'insufficient' ? need() : c.signals.hung.evidence(events, n),
      sample: n,
      examples: examples.hung,
      action: puzzleAction(KIND_THEMES['hung-piece'][0]),
      severity: status === 'weak' ? rate / HUNG.weak : 0,
      subject: 'hung-piece',
    });
  }

  // --- tactics ---------------------------------------------------------------
  {
    const missed = counts['missed-tactic'];
    const into = counts['walked-into-tactic'] + counts.fork;
    const events = missed + into;
    const rate = n ? events / n : 0;
    const status = rateStatus(rate, events, n, TACTICS);
    const kind = mainKind(counts, ['missed-tactic', 'walked-into-tactic', 'fork']);
    signals.push({
      id: 'tactics',
      title: c.signals.tactics.title,
      status,
      value: status === 'insufficient' ? 0 : round1(rate),
      valueText: status === 'insufficient' ? c.noValue : c.perGame(fmtRate(rate)),
      baselineText: c.rateBaseline(fmtRate(TACTICS.strong), fmtRate(TACTICS.weak)),
      evidence: status === 'insufficient' ? need() : c.signals.tactics.evidence(missed, into, n),
      sample: n,
      examples: examples.tactics,
      action: puzzleAction(KIND_THEMES[kind][0]),
      severity: status === 'weak' ? rate / TACTICS.weak : 0,
      subject: kind,
    });
  }

  // --- mates -----------------------------------------------------------------
  {
    const allowed = counts['allowed-mate'];
    const missed = counts['missed-mate'];
    const events = allowed + missed;
    const rate = n ? events / n : 0;
    const status = rateStatus(rate, events, n, MATES);
    const kind = mainKind(counts, ['allowed-mate', 'missed-mate']);
    signals.push({
      id: 'mates',
      title: c.signals.mates.title,
      status,
      value: status === 'insufficient' ? 0 : round1(rate),
      valueText: status === 'insufficient' ? c.noValue : c.perGame(fmtRate(rate)),
      baselineText: c.rateBaseline(fmtRate(MATES.strong), fmtRate(MATES.weak)),
      evidence: status === 'insufficient' ? need() : c.signals.mates.evidence(allowed, missed, n),
      sample: n,
      examples: examples.mates,
      action: puzzleAction(KIND_THEMES[kind][0]),
      severity: status === 'weak' ? rate / MATES.weak : 0,
      subject: kind,
    });
  }

  signals.push(prepSignal(games, input));

  // --- converting winning positions ------------------------------------------
  {
    const notWon = conv.lost + conv.drawn;
    const share = conv.winning ? notWon / conv.winning : 0;
    let status: SignalStatus = 'ok';
    if (conv.winning < CONVERSION.minGames) status = 'insufficient';
    else if (share >= CONVERSION.weak && notWon >= MIN_EVENTS) status = 'weak';
    else if (share <= CONVERSION.strong && conv.winning >= CONVERSION.minGamesStrong) status = 'strong';
    const pct = Math.round(share * 100);
    signals.push({
      id: 'conversion',
      title: c.signals.conversion.title,
      status,
      value: status === 'insufficient' ? 0 : pct,
      valueText: status === 'insufficient' ? c.noValue : c.signals.conversion.value(pct),
      baselineText: c.shareBaseline(Math.round(CONVERSION.strong * 100), Math.round(CONVERSION.weak * 100)),
      evidence:
        status === 'insufficient'
          ? c.signals.conversion.need(conv.winning, CONVERSION.minGames)
          : c.signals.conversion.evidence(conv.winning, notWon, conv.lost, conv.drawn, conv.sudden),
      sample: conv.winning,
      examples: examples.conversion,
      action: { kind: 'endgames', to: '/endgames', label: c.signals.conversion.action },
      severity: status === 'weak' ? share / CONVERSION.weak : 0,
    });
  }

  // --- clock -----------------------------------------------------------------
  {
    const clockErrors = Math.min(clock.errors, clock.low + clock.hasty);
    const share = clock.errors ? clockErrors / clock.errors : 0;
    let status: SignalStatus = 'ok';
    if (clock.games < CLOCK.minGames || clock.errors < CLOCK.minErrors) status = 'insufficient';
    else if (share >= CLOCK.weak) status = 'weak';
    else if (share <= CLOCK.strong && clock.games >= MIN_GAMES_STRONG) status = 'strong';
    const pct = Math.round(share * 100);
    signals.push({
      id: 'clock',
      title: c.signals.clock.title,
      status,
      value: status === 'insufficient' ? 0 : pct,
      valueText: status === 'insufficient' ? c.noValue : c.signals.clock.value(pct),
      baselineText: c.shareBaseline(Math.round(CLOCK.strong * 100), Math.round(CLOCK.weak * 100)),
      evidence:
        status !== 'insufficient'
          ? c.signals.clock.evidence(clockErrors, clock.errors, clock.endedLow, clock.games)
          : clock.games === 0
            ? c.signals.clock.none
            : c.signals.clock.need(clock.games, CLOCK.minGames, CLOCK.minErrors),
      sample: clock.games,
      examples: examples.clock,
      action: { kind: 'play', to: '/play', label: c.signals.clock.action },
      severity: status === 'weak' ? share / CLOCK.weak : 0,
    });
  }

  // --- weakest phase ---------------------------------------------------------
  const phases = Object.fromEntries(
    PHASES.map((ph) => {
      const p = phaseAcc[ph];
      return [ph, { accuracy: p.moves ? Math.round(p.sum / p.moves) : null, moves: p.moves, games: p.games }];
    }),
  ) as Record<Phase, PhaseAccuracy>;
  {
    const usable = PHASES.filter((ph) => phaseAcc[ph].moves >= PHASE_GAP.minMoves && phaseAcc[ph].games >= PHASE_GAP.minGames);
    const acc = (ph: Phase) => phaseAcc[ph].sum / phaseAcc[ph].moves;
    const mainTheme = KIND_THEMES[mainKind(counts, KINDS)][0];
    const actions: Record<Phase, SignalAction> = {
      opening: { kind: 'openings', to: '/openings', label: c.signals.phase.actions.opening },
      middlegame: { kind: 'puzzles', to: puzzlesUrl(mainTheme), label: c.signals.phase.actions.middlegame },
      endgame: { kind: 'endgames', to: '/endgames', label: c.signals.phase.actions.endgame },
    };
    if (n < MIN_GAMES || usable.length < 2) {
      signals.push({
        id: 'phase',
        title: c.signals.phase.title,
        status: 'insufficient',
        value: 0,
        valueText: c.noValue,
        baselineText: c.signals.phase.baseline(PHASE_GAP.weakGap),
        evidence: n < MIN_GAMES ? need() : c.signals.phase.need,
        sample: n,
        examples: [],
        action: actions.middlegame,
        severity: 0,
      });
    } else {
      const weakest = usable.reduce((w, ph) => (acc(ph) < acc(w) ? ph : w));
      const others = usable.filter((ph) => ph !== weakest);
      const rest = others.reduce((s, ph) => s + phaseAcc[ph].sum, 0) / others.reduce((s, ph) => s + phaseAcc[ph].moves, 0);
      const gap = Math.max(0, Math.round(rest - acc(weakest)));
      const status: SignalStatus = gap >= PHASE_GAP.weakGap ? 'weak' : 'ok';
      signals.push({
        id: 'phase',
        title: c.signals.phase.title,
        status,
        value: gap,
        valueText: c.signals.phase.value(gap),
        baselineText: c.signals.phase.baseline(PHASE_GAP.weakGap),
        evidence: c.signals.phase.evidence(c.signals.phase.names[weakest], Math.round(acc(weakest)), Math.round(rest)),
        sample: phaseAcc[weakest].games,
        examples: [],
        action: actions[weakest],
        severity: status === 'weak' ? gap / PHASE_GAP.weakGap : 0,
        subject: weakest,
      });
    }
  }

  const colour = colourSignal(games, input);
  if (colour) signals.push(colour);

  const top = signals
    .filter((s) => s.status === 'weak')
    .sort((a, b) => b.severity - a.severity || ORDER.indexOf(a.id) - ORDER.indexOf(b.id))
    .slice(0, 3);

  return {
    signals,
    top,
    strengths: signals.filter((s) => s.status === 'strong'),
    sample: { games: games.length, analysed, window: n, stale },
    basisText: n ? c.basis(n) : c.basisNone,
    staleText: stale ? c.stale(stale) : null,
    kinds: KINDS.map((kind) => ({ kind, count: counts[kind], perGame: n ? round1(counts[kind] / n) : 0 }))
      .filter((k) => k.count > 0)
      .sort((a, b) => b.count - a.count),
    phases,
  };
}

/** How often you are the one who leaves your prep, and on which line. Reads book reports, so it needs no analysis. */
function prepSignal(games: readonly CoachGame[], input: ProfileInput): Signal {
  let inPrep = 0;
  let left = 0;
  let moveSum = 0;
  const byLine = new Map<string, number>();
  const examples: SignalExample[] = [];
  const end = Math.min(games.length, PREP.window);
  for (let i = 0; i < end; i++) {
    const g = games[i];
    if (!g.book || ownMovesBefore(g.book.ply, g.color) < PREP.minOwnMoves) continue;
    inPrep++;
    if (g.book.status !== 'you-deviated') continue;
    left++;
    moveSum += moveNo(g.book.ply);
    if (g.book.lineId) byLine.set(g.book.lineId, (byLine.get(g.book.lineId) ?? 0) + 1);
    if (examples.length < 3) examples.push({ gameId: g.id, ply: g.book.ply });
  }

  // The line you leave most. Map order is first seen, and games are newest first, so ties go to the most recent.
  let topLine: string | undefined;
  let topCount = 0;
  for (const [id, count] of byLine) {
    if (count > topCount) {
      topLine = id;
      topCount = count;
    }
  }
  const line = topLine ? input.lines?.get(topLine) : undefined;
  const learned = !!topLine && !!input.cards?.some((card) => card.lineId === topLine);

  const share = inPrep ? left / inPrep : 0;
  let status: SignalStatus = 'ok';
  if (inPrep < PREP.minGames) status = 'insufficient';
  else if (share >= PREP.weak && left >= MIN_EVENTS) status = 'weak';
  else if (share <= PREP.strong && inPrep >= MIN_GAMES_STRONG) status = 'strong';

  let action: SignalAction = { kind: 'openings', to: '/openings', label: c.signals.prep.open };
  if (line && learned) action = { kind: 'drill', to: `/drill?line=${encodeURIComponent(line.id)}`, label: c.signals.prep.drill };
  else if (line) action = { kind: 'openings', to: `/learn/${encodeURIComponent(line.repId)}/${line.index}`, label: c.signals.prep.learn };

  const pct = Math.round(share * 100);
  return {
    id: 'prep',
    title: c.signals.prep.title,
    status,
    value: status === 'insufficient' ? 0 : pct,
    valueText: status === 'insufficient' ? c.noValue : c.signals.prep.value(pct),
    baselineText: c.shareBaseline(Math.round(PREP.strong * 100), Math.round(PREP.weak * 100)),
    evidence:
      status === 'insufficient'
        ? c.signals.prep.need(inPrep, PREP.minGames)
        : c.signals.prep.evidence(left, inPrep, left ? Math.round(moveSum / left) : 0, line?.name ?? '', c.times(topCount)),
    sample: inPrep,
    examples,
    action,
    severity: status === 'weak' ? share / PREP.weak : 0,
    subject: topLine,
  };
}

/** The colour gap, or null when the two colours are not clearly different. */
function colourSignal(games: readonly CoachGame[], input: ProfileInput): Signal | null {
  const side = { white: { n: 0, pts: 0 }, black: { n: 0, pts: 0 } };
  const end = Math.min(games.length, COLOUR.window);
  for (let i = 0; i < end; i++) {
    const g = games[i];
    side[g.color].n++;
    side[g.color].pts += points(g);
  }
  const { white, black } = side;
  if (white.n < COLOUR.minGames || black.n < COLOUR.minGames) return null;
  const scoreW = (white.pts / white.n) * 100;
  const scoreB = (black.pts / black.n) * 100;
  const gap = Math.abs(scoreW - scoreB);
  // Standard error of the difference between two score rates, at its widest (p = 0.5).
  const needed = Math.max(COLOUR.minGap, COLOUR.sigmas * 100 * Math.sqrt(0.25 / white.n + 0.25 / black.n));
  if (gap < needed) return null;

  const weak = scoreW < scoreB ? 'white' : 'black';
  const other = weak === 'white' ? 'black' : 'white';
  const examples: SignalExample[] = [];
  for (let i = 0; i < end && examples.length < 3; i++) {
    const g = games[i];
    if (g.color === weak && g.result === 'loss') examples.push({ gameId: g.id, ply: 0 });
  }
  const reps = (input.repertoires ?? []).filter((r) => r.side === weak);
  const rep = reps.find((r) => input.focus?.includes(r.id)) ?? reps[0];
  const score = (s: 'white' | 'black') => Math.round((side[s].pts / side[s].n) * 100);
  return {
    id: 'colour',
    title: c.signals.colour.title(weak),
    status: 'weak',
    value: Math.round(gap),
    valueText: c.signals.colour.value(Math.round(gap)),
    baselineText: c.signals.colour.baseline(COLOUR.minGap),
    evidence: c.signals.colour.evidence(weak, score(weak), side[weak].n, score(other), side[other].n),
    sample: white.n + black.n,
    examples,
    action: {
      kind: 'openings',
      to: rep ? `/openings/${encodeURIComponent(rep.id)}` : '/openings',
      label: c.signals.colour.action(weak),
    },
    severity: gap / needed,
    subject: weak,
  };
}
