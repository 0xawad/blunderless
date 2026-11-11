import { describe, expect, it } from 'vitest';
import { copy } from '../copy';
import { analysis, card, DAY, game, NOW } from './fixtures';
import type { MotifRecommendation } from './motifs';
import { buildPlan, DAILY_PUZZLES, dayOfYear, MAX_STEPS, MINUTES, OWN_PUZZLE_CAP, type Plan, type PlanContext } from './plan';
import type { Profile, Signal, SignalId } from './profile';
import type { PlanRepertoire } from './slim';

const c = copy.coach.plan;
const now = NOW.getTime();

const reps: PlanRepertoire[] = [
  { id: 'w1', title: 'The Italian', side: 'white', lines: [{ id: 'w1:a' }, { id: 'w1:b' }] },
  { id: 'w2', title: 'Anti lines', side: 'white', lines: [{ id: 'w2:a' }] },
  { id: 'b1', title: 'The Caro-Kann', side: 'black', lines: [{ id: 'b1:a' }, { id: 'b1:b' }] },
];
const endgames = [
  { id: 'kq', title: 'Queen mate' },
  { id: 'kr', title: 'Rook mate' },
  { id: 'lucena', title: 'Lucena' },
];
const fork: MotifRecommendation = { theme: 'fork', label: 'Forks', source: 'games', kind: 'fork', reason: 'You walked into a fork 5 times.', to: '/puzzles?theme=fork' };

function ctx(over: Partial<PlanContext> = {}): PlanContext {
  return {
    now: NOW,
    repertoires: reps,
    focus: ['w1', 'b1'],
    cards: [],
    games: [],
    reviewsToday: 0,
    puzzlesDue: 0,
    puzzlesReviewedToday: 0,
    attemptsToday: 0,
    sparredToday: false,
    endgameToday: false,
    endgames,
    endgamesWon: [],
    motif: null,
    profile: null,
    ...over,
  };
}

/** A returning player: every line learned and none due, newest game reviewed. Nothing is done yet today. */
function settled(over: Partial<PlanContext> = {}): PlanContext {
  return ctx({
    cards: ['w1:a', 'w1:b', 'b1:a', 'b1:b'].map((id) => card(id)),
    games: [game(1, { a: analysis() })],
    ...over,
  });
}

const signal = (id: SignalId, over: Partial<Signal> = {}): Signal => ({
  id,
  title: id,
  status: 'weak',
  value: 40,
  valueText: '',
  evidence: '',
  sample: 20,
  examples: [],
  action: { kind: 'review', to: '/games', label: '' },
  severity: 1.5,
  ...over,
});
const profileWith = (...top: Signal[]): Profile => ({
  signals: top,
  top,
  strengths: [],
  sample: { games: 30, analysed: 30, window: 30, stale: 0 },
  basisText: '',
  staleText: null,
  kinds: [],
  phases: { opening: { accuracy: null, moves: 0, games: 0 }, middlegame: { accuracy: null, moves: 0, games: 0 }, endgame: { accuracy: null, moves: 0, games: 0 } },
});

const ids = (p: Plan) => p.steps.map((s) => s.id);
const step = (p: Plan, id: string) => p.steps.find((s) => s.id === id)!;

describe('buildPlan: onboarding', () => {
  it('gives a brand-new player three steps: a line, their games, a game', () => {
    const p = buildPlan(ctx());
    expect(p.onboarding).toBe(true);
    expect(p.steps).toEqual([
      { id: 'learn', kind: 'learn', title: 'Learn your first line: The Italian', reason: c.learn.reason, to: '/learn/w1/0', minutes: MINUTES.learn, done: false },
      { id: 'import', kind: 'import', title: 'Import your games', reason: c.import.reason, to: '/games', minutes: MINUTES.import, done: false },
      { id: 'play', kind: 'play', title: 'Play a game', reason: c.play.reason, to: '/play', minutes: MINUTES.play, done: false },
    ]);
    expect(p.headline).toBe(c.headline.onboarding);
    expect(p).toMatchObject({ doneCount: 0, allDone: false, bonus: null, minutes: MINUTES.learn + MINUTES.import + MINUTES.play });
    expect(p.next?.id).toBe('learn');
  });

  it('starts from any repertoire when nothing is in focus', () => {
    expect(buildPlan(ctx({ focus: [] })).steps[0].to).toBe('/learn/w1/0');
    expect(buildPlan(ctx({ focus: ['b1'] })).steps[0]).toMatchObject({ to: '/learn/b1/0', title: 'Learn your first line: The Caro-Kann' });
  });

  it('is over as soon as there is a game or a line', () => {
    const withGame = buildPlan(ctx({ games: [game(1)] }));
    expect(withGame.onboarding).toBe(false);
    expect(ids(withGame)).toEqual(['learn', 'puzzles', 'review', 'spar', 'endgame']);

    const withLine = buildPlan(ctx({ cards: [card('w1:a', { due: now - 1 })] }));
    expect(withLine.onboarding).toBe(false);
    expect(ids(withLine)).toEqual(['drill', 'puzzles', 'import', 'spar', 'endgame']);
    expect(step(withLine, 'import').done).toBe(false);
  });
});

describe('buildPlan: opening lines', () => {
  it('asks you to drill what is due', () => {
    const p = buildPlan(settled({ cards: [card('w1:a', { due: now - 1 }), card('w1:b', { due: now }), card('b1:a')] }));
    expect(p.steps[0]).toEqual({ id: 'drill', kind: 'drill', title: 'Drill 2 due lines', reason: c.drill.due, to: '/drill', minutes: 2, count: 2, done: false });
    expect(p.headline).toBe('2 lines are due, so today starts with your openings.');
  });

  it('caps the time estimate for a long queue', () => {
    const cards = Array.from({ length: 40 }, (_, i) => card(`w1:${i}`, { due: now - 1 }));
    expect(buildPlan(settled({ cards })).steps[0]).toMatchObject({ title: 'Drill 40 due lines', minutes: MINUTES.drillMax });
  });

  it('is done when nothing is due, as on the old Home page', () => {
    const idle = buildPlan(settled());
    expect(idle.steps[0]).toMatchObject({ id: 'drill', done: true, title: 'No lines due', reason: c.drill.none, minutes: 0 });
    const drilled = buildPlan(settled({ reviewsToday: 3 }));
    expect(drilled.steps[0]).toMatchObject({ done: true, title: 'Lines drilled', reason: '3 lines drilled today, nothing left due.' });
  });

  it('says so when a real game showed you forgot a due line', () => {
    const slip = game(900, { at: now - DAY, book: { status: 'you-deviated', ply: 8, lineId: 'w1:a' } });
    const cards = [card('w1:a', { due: now - 1, lastReview: now - 5 * DAY }), card('w1:b', { due: now - 1 })];
    const p = buildPlan(settled({ cards, games: [slip] }));
    expect(p.steps[0].reason).toBe('You left one of these early in a real game and have not drilled it since.');
    expect(p.headline).toBe('Today starts with the line a real game showed you forgot.');

    const single = buildPlan(settled({ cards: [cards[0]], games: [slip] }));
    expect(single.steps[0].reason).toBe('You left this line early in a real game and have not drilled it since.');
  });

  it('does not call a line forgotten if you drilled or learned it after the game', () => {
    const slip = game(900, { at: now - 3 * DAY, book: { status: 'you-deviated', ply: 8, lineId: 'w1:a' } });
    const drilledSince = buildPlan(settled({ cards: [card('w1:a', { due: now - 1, lastReview: now - DAY })], games: [slip] }));
    expect(drilledSince.steps[0].reason).toBe(c.drill.due);
    const learnedSince = buildPlan(settled({ cards: [card('w1:a', { due: now - 1, lastReview: 0, addedAt: now - DAY })], games: [slip] }));
    expect(learnedSince.steps[0].reason).toBe(c.drill.due);
    // An opponent leaving book is not you forgetting.
    const theirs = game(901, { at: now - DAY, book: { status: 'they-deviated', ply: 8 } });
    expect(buildPlan(settled({ cards: [card('w1:a', { due: now - 1 })], games: [theirs] })).steps[0].reason).toBe(c.drill.due);
  });

  it('offers the first line when you have games but no lines', () => {
    const p = buildPlan(ctx({ games: [game(1, { a: analysis() })] }));
    expect(p.steps[0]).toMatchObject({ id: 'learn', kind: 'learn', to: '/learn/w1/0', done: false });
  });
});

describe('buildPlan: puzzles', () => {
  it('asks for ten themed puzzles when none of your own are due', () => {
    const p = buildPlan(settled());
    expect(ids(p)).not.toContain('mistakes');
    expect(step(p, 'puzzles')).toEqual({
      id: 'puzzles',
      kind: 'puzzles',
      title: 'Solve 10 mixed puzzles',
      reason: copy.coach.motifs.fallback,
      to: '/puzzles?theme=mixed',
      minutes: 5,
      count: DAILY_PUZZLES,
      done: false,
    });
  });

  it('carries the recommended theme in the title, reason and link', () => {
    expect(step(buildPlan(settled({ motif: fork })), 'puzzles')).toMatchObject({
      title: 'Solve 10 puzzles on forks',
      reason: fork.reason,
      to: '/puzzles?theme=fork',
    });
  });

  it('splits the ten between your own mistakes and the theme', () => {
    const many = buildPlan(settled({ puzzlesDue: 30, motif: fork }));
    expect(step(many, 'mistakes')).toEqual({
      id: 'mistakes',
      kind: 'mistakes',
      title: `Fix ${OWN_PUZZLE_CAP} of your own mistakes`,
      reason: '30 positions from your own games are due. You have met them before.',
      to: '/puzzles',
      minutes: 3,
      count: OWN_PUZZLE_CAP,
      done: false,
    });
    expect(step(many, 'puzzles')).toMatchObject({ count: DAILY_PUZZLES - OWN_PUZZLE_CAP, title: 'Solve 4 puzzles on forks' });

    const few = buildPlan(settled({ puzzlesDue: 3 }));
    expect(step(few, 'mistakes').count).toBe(3);
    expect(step(few, 'puzzles').count).toBe(7);
    expect(buildPlan(settled({ puzzlesDue: 1 })).steps.find((s) => s.id === 'mistakes')?.reason).toBe(
      '1 position from your own games is due. You have met it before.',
    );
  });

  it('counts down as you go', () => {
    const p = buildPlan(settled({ puzzlesDue: 28, puzzlesReviewedToday: 2, attemptsToday: 2 }));
    expect(step(p, 'mistakes')).toMatchObject({ count: 4, title: 'Fix 4 of your own mistakes', done: false });
    expect(step(p, 'puzzles')).toMatchObject({ count: 4, done: false });
  });

  it('ticks your own mistakes once the share is done or the queue is empty', () => {
    const share = buildPlan(settled({ puzzlesDue: 24, puzzlesReviewedToday: 6, attemptsToday: 6 }));
    expect(step(share, 'mistakes')).toMatchObject({ done: true, title: 'Own mistakes fixed', count: 0, minutes: 0 });
    expect(step(share, 'puzzles')).toMatchObject({ done: false, count: 4 });

    const cleared = buildPlan(settled({ puzzlesDue: 0, puzzlesReviewedToday: 3, attemptsToday: 3 }));
    expect(step(cleared, 'mistakes').done).toBe(true);
    expect(step(cleared, 'puzzles')).toMatchObject({ done: false, count: 7 });
  });

  it('ticks the themed puzzles once the rest of the ten are tried', () => {
    const p = buildPlan(settled({ puzzlesDue: 4, attemptsToday: 6 })); // six themed tries, four own still due
    expect(step(p, 'puzzles')).toMatchObject({ done: true, title: 'Puzzles done for today', reason: '6 puzzles tried today.' });
    expect(step(p, 'mistakes').done).toBe(false);

    expect(step(buildPlan(settled({ attemptsToday: 9 })), 'puzzles')).toMatchObject({ done: false, count: 1, title: 'Solve 1 mixed puzzle' });
    expect(step(buildPlan(settled({ attemptsToday: 10 })), 'puzzles').done).toBe(true);
  });

  it('counts ten attempts of any kind as the day’s puzzle work, as the old Home page did', () => {
    const p = buildPlan(settled({ puzzlesDue: 20, puzzlesReviewedToday: 10, attemptsToday: DAILY_PUZZLES }));
    expect(step(p, 'mistakes').done).toBe(true);
    expect(step(p, 'puzzles').done).toBe(true);
  });
});

describe('buildPlan: newest game', () => {
  it('links the newest game when it has not been reviewed', () => {
    const games = [game(4, { a: analysis() }), game(5, { result: 'loss', opp: 'Magnus' }), game(3)];
    const s = step(buildPlan(settled({ games })), 'review');
    expect(s).toEqual({
      id: 'review',
      kind: 'review',
      title: 'Review your latest game',
      reason: 'You lost to Magnus and have not looked at why yet.',
      to: '/games/g5',
      minutes: MINUTES.review,
      done: false,
    });
  });

  it('words the reason by result and encodes the id', () => {
    const won = step(buildPlan(settled({ games: [game(1, { id: 'https://lichess.org/abc', result: 'win', opp: '' })] })), 'review');
    expect(won.to).toBe('/games/https%3A%2F%2Flichess.org%2Fabc');
    expect(won.reason).toBe('You beat your opponent. Worth checking whether that was skill or their blunder.');
    expect(step(buildPlan(settled({ games: [game(1, { result: 'draw' })] })), 'review').reason).toBe('You drew with rival. One of you missed something.');
  });

  it('is done once the newest game has any review, as on the old Home page', () => {
    for (const newest of [game(9, { a: analysis() }), game(9, { review: 'stale' })]) {
      const s = step(buildPlan(settled({ games: [game(2), newest] })), 'review');
      expect(s).toMatchObject({ done: true, title: 'Latest game reviewed', to: '/games', minutes: 0 });
    }
  });

  it('skips a game whose PGN cannot be read', () => {
    const games = [game(9, { unreviewable: true }), game(8, { a: analysis() })];
    expect(step(buildPlan(settled({ games })), 'review').done).toBe(true);
    // Only unreadable games: nothing to review, nothing to nag about.
    expect(ids(buildPlan(settled({ games: [game(9, { unreviewable: true })] })))).not.toContain('review');
  });

  it('asks for an import when there are lines but no games', () => {
    const p = buildPlan(settled({ games: [] }));
    expect(step(p, 'import')).toMatchObject({ kind: 'import', to: '/games', done: false });
    expect(p.onboarding).toBe(false);
  });
});

describe('buildPlan: spar and endgame', () => {
  const focused = ['w1', 'b1'];
  const todays = reps.filter((r) => focused.includes(r.id))[dayOfYear(NOW) % focused.length];

  it('rotates the spar through the focus openings by day', () => {
    const s = step(buildPlan(settled()), 'spar');
    expect(s).toEqual({
      id: 'spar',
      kind: 'spar',
      title: `Spar one line: ${todays.title}`,
      reason: c.spar.reason,
      to: `/openings/${todays.id}/map?mode=spar`,
      minutes: MINUTES.spar,
      done: false,
    });
    const tomorrow = new Date(NOW.getTime() + DAY);
    expect(step(buildPlan(settled({ now: tomorrow })), 'spar').to).not.toBe(s.to);
    expect(dayOfYear(new Date(2026, 0, 1, 9))).toBe(1);
  });

  it('is done once you have sparred today, and absent without a focus opening', () => {
    expect(step(buildPlan(settled({ sparredToday: true })), 'spar')).toMatchObject({ done: true, reason: c.spar.done, minutes: 0 });
    expect(ids(buildPlan(settled({ focus: [] })))).not.toContain('spar');
  });

  it('spars the opening you keep leaving when that is a top weakness', () => {
    const other = reps.find((r) => focused.includes(r.id) && r.id !== todays.id)!;
    const profile = profileWith(signal('prep', { value: 41, subject: other.lines[0].id }));
    const s = step(buildPlan(settled({ profile })), 'spar');
    expect(s.to).toBe(`/openings/${other.id}/map?mode=spar`);
    expect(s.reason).toBe('You leave your prep first in 41% of games. Playing it from memory is the fix.');
  });

  it('picks the first endgame you have not won, then rotates', () => {
    expect(step(buildPlan(settled()), 'endgame')).toEqual({
      id: 'endgame',
      kind: 'endgame',
      title: 'Win one endgame: Queen mate',
      reason: c.endgame.fresh,
      to: '/endgames?eg=kq',
      minutes: MINUTES.endgame,
      done: false,
    });
    expect(step(buildPlan(settled({ endgamesWon: ['kq'] })), 'endgame').title).toBe('Win one endgame: Rook mate');
    const all = step(buildPlan(settled({ endgamesWon: ['kq', 'kr', 'lucena'] })), 'endgame');
    expect(all.title).toBe(`Win one endgame: ${endgames[dayOfYear(NOW) % 3].title}`);
    expect(all.reason).toBe(c.endgame.again);
  });

  it('is done after a win today, and absent with no endgames', () => {
    expect(step(buildPlan(settled({ endgameToday: true, endgamesWon: ['kq'] })), 'endgame')).toMatchObject({
      done: true,
      title: 'Endgame won',
      to: '/endgames',
      minutes: 0,
    });
    expect(ids(buildPlan(settled({ endgames: [] })))).not.toContain('endgame');
  });
});

describe('buildPlan: order and limits', () => {
  const busy = (over: Partial<PlanContext> = {}) =>
    settled({ cards: [card('w1:a', { due: now - 1 }), card('b1:a')], puzzlesDue: 12, games: [game(5)], motif: fork, ...over });

  it('keeps five steps in order of value and drops the endgame first', () => {
    const p = buildPlan(busy());
    expect(ids(p)).toEqual(['drill', 'mistakes', 'puzzles', 'review', 'spar']);
    expect(p.steps).toHaveLength(MAX_STEPS);
    expect(new Set(ids(p)).size).toBe(MAX_STEPS);
  });

  it('shows all of them when there are five or fewer', () => {
    expect(ids(buildPlan(busy({ puzzlesDue: 0 })))).toEqual(['drill', 'puzzles', 'review', 'spar', 'endgame']);
  });

  it('gives the last slot to an endgame when converting is a top weakness', () => {
    const p = buildPlan(busy({ profile: profileWith(signal('conversion', { value: 42 })) }));
    expect(ids(p)).toEqual(['drill', 'mistakes', 'puzzles', 'review', 'endgame']);
    expect(step(p, 'endgame').reason).toBe('42% of your winning positions got away. Technique is the fix.');

    const phase = buildPlan(busy({ profile: profileWith(signal('phase', { value: 14, subject: 'endgame' })) }));
    expect(ids(phase)).toContain('endgame');
    expect(step(phase, 'endgame').reason).toBe('Your endgame trails the rest of your game by 14 points.');
    // A weak middlegame is not an endgame problem.
    expect(ids(buildPlan(busy({ profile: profileWith(signal('phase', { subject: 'middlegame' })) })))).toContain('spar');
  });

  it('keeps the spar ahead when leaving prep is a top weakness too', () => {
    const profile = profileWith(signal('prep', { subject: 'w1:a' }), signal('conversion'));
    expect(ids(buildPlan(busy({ profile })))).toEqual(['drill', 'mistakes', 'puzzles', 'review', 'spar']);
  });

  it('adds up what is left', () => {
    const p = buildPlan(busy());
    // drill 1 line (1), six own mistakes (3), four themed (2), review (4), spar (3)
    expect(p.minutes).toBe(1 + 3 + 2 + MINUTES.review + MINUTES.spar);
    expect(p.doneCount).toBe(0);
    expect(p.next?.id).toBe('drill');

    const half = buildPlan(busy({ cards: [card('w1:a'), card('b1:a')], reviewsToday: 1, sparredToday: true }));
    expect(half.doneCount).toBe(2);
    expect(half.minutes).toBe(3 + 2 + MINUTES.review);
    expect(half.next?.id).toBe('mistakes');
    expect(half.allDone).toBe(false);
  });

  it('is all done when every step is, with something extra to do', () => {
    const done = settled({ reviewsToday: 2, attemptsToday: 10, sparredToday: true, endgameToday: true });
    const p = buildPlan(done);
    expect(ids(p)).toEqual(['drill', 'puzzles', 'review', 'spar', 'endgame']);
    expect(p).toMatchObject({ allDone: true, doneCount: 5, minutes: 0, next: null, headline: c.headline.allDone });
    // Every focus line is learned, so the extra is a game.
    expect(p.bonus).toEqual({ id: 'play', kind: 'play', title: 'Play a game', reason: c.play.bonus, to: '/play', minutes: MINUTES.play, done: false });

    // With a focus line still unlearned and nothing due, the extra is that line.
    const room = buildPlan({ ...done, cards: [card('w1:a'), card('b1:a')] });
    expect(room.bonus).toEqual({ id: 'learn', kind: 'learn', title: 'Learn the next line: The Italian', reason: c.learn.nextReason, to: '/learn/w1/1', minutes: MINUTES.learn, done: false });
    // Not while lines are due: finish those first.
    expect(buildPlan({ ...done, cards: [card('w1:a', { due: now - 1 })] }).bonus?.kind).toBe('play');
  });
});

describe('buildPlan: headline', () => {
  const weak = profileWith(signal('hung', { value: 0.8 }));

  it('leads with forgotten lines, then your worst weakness, then what is due', () => {
    const slip = game(900, { at: now - DAY, book: { status: 'you-deviated', ply: 8, lineId: 'w1:a' } });
    const dueCard = card('w1:a', { due: now - 1 });
    expect(buildPlan(settled({ cards: [dueCard], games: [slip], profile: weak })).headline).toBe(c.headline.forgot(1));
    expect(buildPlan(settled({ cards: [dueCard], profile: weak })).headline).toBe('Today is about keeping your pieces on the board: you hang 0.8 a game.');
    expect(buildPlan(settled({ cards: [dueCard] })).headline).toBe(c.headline.due(1));
    expect(buildPlan(settled({ puzzlesDue: 5 })).headline).toBe('5 of your own mistakes are due, so today is about not making them twice.');
    expect(buildPlan(settled()).headline).toBe(c.headline.steady);
  });

  it('has a sentence for every signal', () => {
    const cases: [Signal, string][] = [
      [signal('tactics', { value: 1.8 }), 'Today is about tactics: 1.8 a game are getting past you.'],
      [signal('mates', { value: 0.4 }), 'Today is about checkmates: 0.4 a game are being allowed or missed.'],
      [signal('clock', { value: 45 }), 'Today is about the clock: it is behind 45% of your mistakes.'],
      [signal('prep', { value: 41 }), 'Today is about your openings: you leave your prep first in 41% of games.'],
      [signal('conversion', { value: 38 }), 'Today is about finishing the job: 38% of your winning positions got away.'],
      [signal('phase', { value: 12, subject: 'endgame' }), 'Today is about your endgame: it trails the rest of your game by 12 points.'],
      [signal('colour', { value: 20, subject: 'black' }), 'Today is about playing Black: you score 20 points less with it.'],
    ];
    for (const [s, text] of cases) expect(buildPlan(settled({ profile: profileWith(s) })).headline).toBe(text);
  });

  it('writes plainly: no exclamation marks, no em dashes', () => {
    const plans = [buildPlan(ctx()), buildPlan(settled()), buildPlan(settled({ puzzlesDue: 9, motif: fork, profile: weak, cards: [card('w1:a', { due: now - 1 })] }))];
    for (const p of plans) {
      for (const text of [p.headline, ...p.steps.flatMap((s) => [s.title, s.reason]), p.bonus?.title ?? '', p.bonus?.reason ?? '']) {
        expect(text).not.toMatch(/[!—]/);
      }
      expect(p.steps.length).toBeLessThanOrEqual(MAX_STEPS);
      expect(p.steps.every((s) => s.to.startsWith('/') && s.title.length > 0 && s.reason.length > 0)).toBe(true);
    }
  });
});
