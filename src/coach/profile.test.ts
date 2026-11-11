import { describe, expect, it } from 'vitest';
import { copy } from '../copy';
import { analysed, card, game } from './fixtures';
import {
  buildProfile,
  CLOCK,
  COLOUR,
  CONVERSION,
  exampleUrl,
  fmtRate,
  HUNG,
  MATES,
  MIN_GAMES,
  MIN_GAMES_STRONG,
  PHASE_GAP,
  PREP,
  PROFILE_WINDOW,
  TACTICS,
  type Profile,
  type Signal,
  type SignalId,
} from './profile';
import { indexLines, type CoachGame } from './slim';

const sig = (p: Profile, id: SignalId): Signal => p.signals.find((s) => s.id === id)!;
const c = copy.coach;

const lines = indexLines([
  {
    id: 'rep-w',
    title: 'The Italian',
    side: 'white',
    lines: [
      { id: 'rep-w:a', chapterTitle: 'Slow', label: 'Main line' },
      { id: 'rep-w:b', chapterTitle: 'Slow', label: 'vs 4...d6' },
    ],
  },
]);

describe('buildProfile: empty and gated', () => {
  it('says nothing with no data', () => {
    const p = buildProfile({ games: [] });
    expect(p.signals.map((s) => s.id)).toEqual(['hung', 'tactics', 'mates', 'prep', 'conversion', 'clock', 'phase']);
    expect(p.signals.every((s) => s.status === 'insufficient')).toBe(true);
    expect(p.signals.every((s) => s.value === 0 && s.valueText === c.noValue && s.severity === 0)).toBe(true);
    expect(p.signals.every((s) => s.evidence.length > 0 && s.action.to.startsWith('/') && s.action.label.length > 0)).toBe(true);
    expect(p.top).toEqual([]);
    expect(p.strengths).toEqual([]);
    expect(p.kinds).toEqual([]);
    expect(p.sample).toEqual({ games: 0, analysed: 0, window: 0, stale: 0 });
    expect(p.basisText).toBe(c.basisNone);
  });

  it('does not call anything weak below the minimum sample', () => {
    const awful = (n: number) => analysed(n, () => ({ kinds: ['hung-piece', 'hung-piece', 'allowed-mate', 'missed-tactic', 'missed-tactic'] }));
    const few = buildProfile({ games: awful(MIN_GAMES - 1) });
    for (const id of ['hung', 'tactics', 'mates'] as const) {
      expect(sig(few, id).status).toBe('insufficient');
      expect(sig(few, id).evidence).toBe(c.needGames(MIN_GAMES - 1, MIN_GAMES));
    }
    expect(few.top).toEqual([]);

    const enough = buildProfile({ games: awful(MIN_GAMES) });
    for (const id of ['hung', 'tactics', 'mates'] as const) expect(sig(enough, id).status).toBe('weak');
  });

  it('reads only the most recent analysed games and says how many', () => {
    // Ten old games full of hung pieces, then thirty clean ones.
    const games = [...analysed(10, () => ({ kinds: ['hung-piece', 'hung-piece'] })), ...analysed(PROFILE_WINDOW, () => ({}), 10)];
    const p = buildProfile({ games });
    expect(p.sample).toMatchObject({ games: 40, analysed: 40, window: PROFILE_WINDOW });
    expect(p.basisText).toBe(c.basis(PROFILE_WINDOW));
    expect(sig(p, 'hung').value).toBe(0);
    expect(sig(p, 'hung').status).toBe('strong');
    expect(sig(p, 'hung').sample).toBe(PROFILE_WINDOW);
  });

  it('gives the same answer whatever order the games arrive in', () => {
    const games = analysed(12, (i) => ({ kinds: i % 2 ? ['hung-piece'] : [] }));
    const a = buildProfile({ games });
    const b = buildProfile({ games: [...games].reverse() });
    expect(b).toEqual(a);
  });

  it('leaves out games analysed by an older version', () => {
    const stale: CoachGame[] = Array.from({ length: 5 }, (_, k) => game(100 + k, { review: 'stale' }));
    const p = buildProfile({ games: [...analysed(MIN_GAMES), ...stale] });
    expect(p.sample).toEqual({ games: 13, analysed: MIN_GAMES, window: MIN_GAMES, stale: 5 });
    expect(p.staleText).toBe('5 older reviews are left out until re-analysed.');
    expect(buildProfile({ games: analysed(MIN_GAMES) }).staleText).toBeNull();
  });
});

describe('buildProfile: hung pieces, tactics, mates', () => {
  it('draws the hung-piece line at one every second game', () => {
    const withHung = (n: number, hung: number) => buildProfile({ games: analysed(n, (i) => ({ kinds: i < hung ? ['hung-piece'] : [] })) });
    const weak = sig(withHung(8, 4), 'hung');
    expect(weak.status).toBe('weak');
    expect(weak.value).toBe(HUNG.weak);
    expect(weak.valueText).toBe('0.5 per game');
    expect(weak.evidence).toBe('You left 4 pieces hanging in your last 8 games.');
    expect(weak.severity).toBe(1);
    expect(weak.action).toEqual({ kind: 'puzzles', to: '/puzzles?theme=hangingPiece', label: 'Practise free pieces' });
    expect(weak.subject).toBe('hung-piece');

    expect(sig(withHung(8, 3), 'hung').status).toBe('ok');
    expect(sig(withHung(8, 3), 'hung').severity).toBe(0);
  });

  it('needs more games to call something a strength than to call it fine', () => {
    const clean = (n: number) => buildProfile({ games: analysed(n) });
    expect(sig(clean(MIN_GAMES_STRONG - 1), 'hung').status).toBe('ok');
    const p = clean(MIN_GAMES_STRONG);
    expect(sig(p, 'hung').status).toBe('strong');
    expect(sig(p, 'hung').evidence).toBe(`No pieces left hanging in your last ${MIN_GAMES_STRONG} games.`);
    expect(p.strengths.map((s) => s.id)).toEqual(expect.arrayContaining(['hung', 'tactics', 'mates']));
    // exactly on the "solid" line still counts
    const onLine = buildProfile({ games: analysed(15, (i) => ({ kinds: i < 3 ? ['hung-piece'] : [] })) });
    expect(sig(onLine, 'hung').value).toBe(HUNG.strong);
    expect(sig(onLine, 'hung').status).toBe('strong');
  });

  it('counts forks and walked-into tactics together and points at the main kind', () => {
    const games = analysed(8, (i) => ({ kinds: ['walked-into-tactic', 'walked-into-tactic', ...(i < 2 ? (['fork', 'missed-tactic'] as const) : [])] }));
    const s = sig(buildProfile({ games }), 'tactics');
    expect(s.value).toBe(2.5); // (16 + 2 + 2) / 8
    expect(s.value).toBeGreaterThanOrEqual(TACTICS.weak);
    expect(s.status).toBe('weak');
    expect(s.evidence).toBe('You missed 2 tactics and walked into 18 in your last 8 games.');
    expect(s.subject).toBe('walked-into-tactic');
    expect(s.action.to).toBe('/puzzles?theme=defensiveMove');
    expect(s.action.label).toBe('Practise defensive moves');
  });

  it('keeps tactics fine under three every two games', () => {
    const games = analysed(10, (i) => ({ kinds: i < 9 ? ['missed-tactic'] : [] })); // 0.9 per game
    expect(sig(buildProfile({ games }), 'tactics').status).toBe('ok');
  });

  it('flags mates from about one game in three', () => {
    const p = buildProfile({ games: analysed(10, (i) => ({ kinds: i < 3 ? ['allowed-mate'] : i === 3 ? ['missed-mate'] : [] })) });
    const s = sig(p, 'mates');
    expect(s.value).toBe(0.4);
    expect(s.value).toBeGreaterThanOrEqual(MATES.weak);
    expect(s.status).toBe('weak');
    expect(s.evidence).toBe('You allowed 3 mates and missed 1 of your own in your last 10 games.');
    expect(s.subject).toBe('allowed-mate');
    expect(s.action.to).toBe('/puzzles?theme=backRankMate');

    const two = buildProfile({ games: analysed(10, (i) => ({ kinds: i < 2 ? ['missed-mate'] : [] })) });
    expect(sig(two, 'mates').status).toBe('ok');
    expect(sig(two, 'mates').action.to).toBe('/puzzles?theme=mateIn1');
  });

  it('gives up to three examples, most recent first, one per game', () => {
    const hung = new Set([2, 5, 7, 9]);
    const games = analysed(10, (i) => ({ kinds: hung.has(i) ? ['hung-piece', 'hung-piece'] : [] }));
    const s = sig(buildProfile({ games }), 'hung');
    expect(s.examples).toEqual([
      { gameId: 'g9', ply: 10 },
      { gameId: 'g7', ply: 10 },
      { gameId: 'g5', ply: 10 },
    ]);
    expect(exampleUrl(s.examples[0])).toBe('/games/g9?ply=10');
  });

  it('lists the kinds of mistake, commonest first', () => {
    const p = buildProfile({ games: analysed(8, (i) => ({ kinds: i < 2 ? ['fork'] : ['missed-tactic', 'hung-piece', 'missed-tactic'] })) });
    expect(p.kinds).toEqual([
      { kind: 'missed-tactic', count: 12, perGame: 1.5 },
      { kind: 'hung-piece', count: 6, perGame: 0.8 },
      { kind: 'fork', count: 2, perGame: 0.3 },
    ]);
  });
});

describe('buildProfile: clock', () => {
  const timed = (n: number, low: number, hasty = 0) =>
    analysed(n, (i) => ({
      kinds: ['missed-tactic', 'walked-into-tactic'],
      clock: { low: i < low ? 1 : 0, hasty: i < hasty ? 1 : 0, endedLow: i < 3 },
    }));

  it('stays quiet without clock data', () => {
    const s = sig(buildProfile({ games: analysed(12, () => ({ kinds: ['missed-tactic', 'missed-tactic'] })) }), 'clock');
    expect(s.status).toBe('insufficient');
    expect(s.evidence).toBe(c.signals.clock.none);
    expect(s.sample).toBe(0);
  });

  it('needs enough timed games and enough mistakes', () => {
    const fewGames = sig(buildProfile({ games: [...timed(CLOCK.minGames - 1, 7), ...analysed(5, () => ({}), 50)] }), 'clock');
    expect(fewGames.status).toBe('insufficient');
    expect(fewGames.evidence).toBe(c.signals.clock.need(CLOCK.minGames - 1, CLOCK.minGames, CLOCK.minErrors));

    // Eight timed games but only nine mistakes between them.
    const fewErrors = analysed(8, (i) => ({ kinds: i === 0 ? ['fork', 'fork'] : ['fork'], clock: { low: 1, hasty: 0, endedLow: false } }));
    expect(sig(buildProfile({ games: fewErrors }), 'clock').status).toBe('insufficient');
  });

  it('is weak when 40% of mistakes are about the clock', () => {
    const s = sig(buildProfile({ games: timed(8, 4, 3) }), 'clock'); // 7 of 16
    expect(s.value).toBe(44);
    expect(s.status).toBe('weak');
    expect(s.valueText).toBe('44% of mistakes');
    expect(s.evidence).toBe('7 of your 16 mistakes came with the clock low or in under 3 seconds, and you finished 3 of 8 games short on time.');
    expect(s.action).toEqual({ kind: 'play', to: '/play', label: 'Play a timed game' });
    expect(s.severity).toBeCloseTo(7 / 16 / CLOCK.weak);

    expect(sig(buildProfile({ games: timed(8, 4) }), 'clock').status).toBe('ok'); // 4 of 16 = 25%
  });

  it('is a strength only with a small share over enough games', () => {
    expect(sig(buildProfile({ games: timed(15, 3) }), 'clock').status).toBe('strong'); // 3 of 30
    expect(sig(buildProfile({ games: timed(14, 2) }), 'clock').status).toBe('ok');
  });

  it('links to mistakes made on the clock', () => {
    const games = analysed(8, (i) => ({
      kinds: ['missed-tactic', 'walked-into-tactic'],
      clock: { low: 1, hasty: 0, endedLow: false },
      errors: [
        { ply: 20, kind: 'missed-tactic', missedWin: false },
        { ply: 30 + i, kind: 'walked-into-tactic', missedWin: false, clock: 'low' },
      ],
      blunders: 2,
    }));
    expect(sig(buildProfile({ games }), 'clock').examples).toEqual([
      { gameId: 'g7', ply: 37 },
      { gameId: 'g6', ply: 36 },
      { gameId: 'g5', ply: 35 },
    ]);
  });
});

describe('buildProfile: opening prep', () => {
  // White deviating on ply 6 has played three book moves; Black on ply 5 has played two.
  const inBook = (i: number, left: boolean, lineId = 'rep-w:b'): CoachGame =>
    game(i, {
      color: 'white',
      book: left ? { status: 'you-deviated', ply: 6, lineId } : { status: i % 3 ? 'they-deviated' : 'end-of-prep', ply: 9 },
    });

  it('ignores games that never followed the prep', () => {
    const games = [
      ...Array.from({ length: 20 }, (_, i) => game(i, { color: 'white', book: { status: 'you-deviated', ply: 0, lineId: 'rep-w:a' } })),
      ...Array.from({ length: 20 }, (_, i) => game(100 + i, { color: 'black', book: { status: 'you-deviated', ply: 3, lineId: 'x' } })),
      ...Array.from({ length: 20 }, (_, i) => game(200 + i, { color: 'white', book: { status: 'end-of-prep', ply: 1 } })),
    ];
    const s = sig(buildProfile({ games }), 'prep');
    expect(s.status).toBe('insufficient');
    expect(s.sample).toBe(0);
    expect(s.evidence).toBe(c.signals.prep.need(0, PREP.minGames));
  });

  it('needs eight games in book', () => {
    const games = Array.from({ length: PREP.minGames - 1 }, (_, i) => inBook(i, true));
    expect(sig(buildProfile({ games }), 'prep').status).toBe('insufficient');
  });

  it('reports how often you leave first, when, and on which line', () => {
    const games = Array.from({ length: 10 }, (_, i) => inBook(i, i < 4, i === 0 ? 'rep-w:a' : 'rep-w:b'));
    const s = sig(buildProfile({ games, lines, cards: [card('rep-w:b')] }), 'prep');
    expect(s.value).toBe(40);
    expect(s.status).toBe('weak');
    expect(s.valueText).toBe('40% of games');
    expect(s.evidence).toBe(
      'You left your prep first in 4 of your last 10 games in book, on average at move 4, most often in The Italian, Slow, vs 4...d6 (3 times).',
    );
    expect(s.subject).toBe('rep-w:b');
    expect(s.action).toEqual({ kind: 'drill', to: '/drill?line=rep-w%3Ab', label: 'Drill this line' });
    expect(s.examples).toEqual([
      { gameId: 'g3', ply: 6 },
      { gameId: 'g2', ply: 6 },
      { gameId: 'g1', ply: 6 },
    ]);
    expect(s.severity).toBeCloseTo(0.4 / PREP.weak);
  });

  it('sends you to learn a line that is not in your drills, or to the repertoire when the line is unknown', () => {
    const games = Array.from({ length: 10 }, (_, i) => inBook(i, i < 4));
    expect(sig(buildProfile({ games, lines }), 'prep').action).toEqual({ kind: 'openings', to: '/learn/rep-w/1', label: 'Learn this line' });
    expect(sig(buildProfile({ games }), 'prep').action).toEqual({ kind: 'openings', to: '/openings', label: 'Open your repertoire' });
  });

  it('is fine in between and a strength when you rarely leave first', () => {
    const some = Array.from({ length: 10 }, (_, i) => inBook(i, i < 3)); // 30%
    expect(sig(buildProfile({ games: some }), 'prep').status).toBe('ok');
    const rare = Array.from({ length: 20 }, (_, i) => inBook(i, i < 2)); // 10%
    const s = sig(buildProfile({ games: rare }), 'prep');
    expect(s.status).toBe('strong');
    const never = Array.from({ length: 20 }, (_, i) => inBook(i, false));
    expect(sig(buildProfile({ games: never }), 'prep').evidence).toBe('You did not leave your prep first in any of your last 20 games in book.');
  });

  it('reads recent games only, and does not need them analysed', () => {
    // 10 old games where you left book, then a full window where you did not.
    const games = [...Array.from({ length: 10 }, (_, i) => inBook(i, true)), ...Array.from({ length: PREP.window }, (_, i) => inBook(100 + i, false))];
    const s = sig(buildProfile({ games }), 'prep');
    expect(s.sample).toBe(PREP.window);
    expect(s.value).toBe(0);
    expect(games.every((g) => !g.a)).toBe(true);
  });
});

describe('buildProfile: converting winning positions', () => {
  const won = (n: number, results: CoachGame['result'][], turns = 3) =>
    analysed(
      n,
      () => ({ winningTurns: turns, lastWinningPly: 40 }),
      0,
      (i) => ({ result: results[i] ?? 'win' }),
    );

  it('needs six games where you were clearly winning', () => {
    const s = sig(buildProfile({ games: [...won(CONVERSION.minGames - 1, ['loss', 'loss', 'loss']), ...analysed(10, () => ({}), 50)] }), 'conversion');
    expect(s.status).toBe('insufficient');
    expect(s.evidence).toBe(c.signals.conversion.need(5, CONVERSION.minGames));
  });

  it('does not count a single winning turn as a winning game', () => {
    const s = sig(buildProfile({ games: won(12, ['loss', 'loss', 'loss', 'loss'], 1) }), 'conversion');
    expect(s.status).toBe('insufficient');
    expect(s.sample).toBe(0);
  });

  it('needs three thrown games, not two, before it is weak', () => {
    expect(sig(buildProfile({ games: won(6, ['loss', 'draw']) }), 'conversion').status).toBe('ok'); // 33%, but two games
    const s = sig(buildProfile({ games: won(8, ['loss', 'draw', 'loss']) }), 'conversion');
    expect(s.status).toBe('weak');
    expect(s.value).toBe(38);
    expect(s.valueText).toBe('38% not won');
    expect(s.evidence).toBe('You were clearly winning in 8 games and did not win 3 of them (2 lost, 1 drawn).');
    expect(s.examples).toEqual([
      { gameId: 'g2', ply: 40 },
      { gameId: 'g1', ply: 40 },
      { gameId: 'g0', ply: 40 },
    ]);
    expect(s.action).toEqual({ kind: 'endgames', to: '/endgames', label: 'Practise endgames' });
  });

  it('says how many were thrown away in a single move', () => {
    const games = analysed(
      8,
      (i) => ({ winningTurns: 3, lastWinningPly: 40, errors: i < 2 ? [{ ply: 40, kind: 'hung-piece', missedWin: true }] : [] }),
      0,
      (i) => ({ result: i < 3 ? 'loss' : 'win' }),
    );
    expect(sig(buildProfile({ games }), 'conversion').evidence).toBe(
      'You were clearly winning in 8 games and did not win 3 of them (3 lost, 0 drawn); 2 went in a single move.',
    );
  });

  it('is a strength at one in ten or better over ten games', () => {
    expect(sig(buildProfile({ games: won(10, ['loss']) }), 'conversion').status).toBe('strong');
    expect(sig(buildProfile({ games: won(9, []) }), 'conversion').status).toBe('ok');
    expect(sig(buildProfile({ games: won(10, []) }), 'conversion').evidence).toBe('You were clearly winning in 10 games and won every one of them.');
  });
});

describe('buildProfile: weakest phase', () => {
  const phased = (n: number, o: [number, number], m: [number, number], e: [number, number]) =>
    analysed(n, () => ({
      phases: { opening: { accuracy: o[0], moves: o[1] }, middlegame: { accuracy: m[0], moves: m[1] }, endgame: { accuracy: e[0], moves: e[1] } },
    }));

  it('flags a phase ten points behind the rest of the game', () => {
    const p = buildProfile({ games: phased(8, [92, 10], [80, 20], [60, 10]) });
    const s = sig(p, 'phase');
    expect(s.status).toBe('weak');
    expect(s.subject).toBe('endgame');
    expect(s.value).toBe(24); // rest = (92*80 + 80*160) / 240 = 84
    expect(s.valueText).toBe('24 points behind');
    expect(s.evidence).toBe('Your endgame accuracy is 60%, against 84% for the rest of the game.');
    expect(s.action).toEqual({ kind: 'endgames', to: '/endgames', label: 'Practise endgames' });
    expect(s.severity).toBeCloseTo(24 / PHASE_GAP.weakGap);
    expect(p.phases).toEqual({
      opening: { accuracy: 92, moves: 80, games: 8 },
      middlegame: { accuracy: 80, moves: 160, games: 8 },
      endgame: { accuracy: 60, moves: 80, games: 8 },
    });
  });

  it('treats the usual middlegame dip as normal', () => {
    const s = sig(buildProfile({ games: phased(8, [90, 10], [82, 20], [88, 10]) }), 'phase');
    expect(s.subject).toBe('middlegame');
    expect(s.value).toBe(7);
    expect(s.status).toBe('ok');
    expect(s.action.kind).toBe('puzzles');
  });

  it('sends an opening problem to the openings', () => {
    const s = sig(buildProfile({ games: phased(8, [70, 10], [85, 20], [86, 10]) }), 'phase');
    expect(s.subject).toBe('opening');
    expect(s.status).toBe('weak');
    expect(s.action).toEqual({ kind: 'openings', to: '/openings', label: 'Work on your openings' });
  });

  it('leaves out a phase without enough moves behind it', () => {
    // Endgames barely reached: 40 moves in all, however bad they look.
    const s = sig(buildProfile({ games: phased(8, [90, 10], [84, 20], [30, 5]) }), 'phase');
    expect(s.subject).toBe('middlegame');
    expect(s.value).toBe(6);
    expect(s.status).toBe('ok');
  });

  it('needs two comparable phases', () => {
    const s = sig(buildProfile({ games: phased(8, [90, 5], [70, 20], [0, 0]) }), 'phase');
    expect(s.status).toBe('insufficient');
    expect(s.evidence).toBe(c.signals.phase.need);
  });
});

describe('buildProfile: colour gap', () => {
  /** `n` games a side; White wins `w` of them, Black wins `b` (the rest are losses). */
  const split = (n: number, w: number, b: number): CoachGame[] =>
    Array.from({ length: n * 2 }, (_, i) => {
      const k = Math.floor(i / 2);
      return game(i, { result: (i % 2 === 0 ? k < w : k < b) ? 'win' : 'loss' });
    });

  it('is not listed when the colours are close', () => {
    expect(sig(buildProfile({ games: split(50, 30, 23) }), 'colour')).toBeUndefined(); // 60% v 46%
  });

  it('is not listed on a small sample, however big the gap', () => {
    expect(sig(buildProfile({ games: split(COLOUR.minGames - 1, 14, 0) }), 'colour')).toBeUndefined();
    // 20 a side needs about 32 points: 30 is still inside the noise.
    expect(sig(buildProfile({ games: split(20, 14, 8) }), 'colour')).toBeUndefined();
  });

  it('is listed as a weakness when the gap is clear', () => {
    const reps = [
      { id: 'w', title: 'W', side: 'white' as const },
      { id: 'b1', title: 'B1', side: 'black' as const },
      { id: 'b2', title: 'B2', side: 'black' as const },
    ];
    const p = buildProfile({ games: split(50, 35, 20), repertoires: reps, focus: ['w', 'b2'] });
    const s = sig(p, 'colour');
    expect(s.status).toBe('weak');
    expect(s.title).toBe('Results as Black');
    expect(s.subject).toBe('black');
    expect(s.value).toBe(30);
    expect(s.evidence).toBe('You score 40% as Black over 50 games and 70% as White over 50.');
    expect(s.action).toEqual({ kind: 'openings', to: '/openings/b2', label: 'Work on your Black openings' });
    expect(s.sample).toBe(100);
    expect(s.examples).toEqual([
      { gameId: 'g99', ply: 0 },
      { gameId: 'g97', ply: 0 },
      { gameId: 'g95', ply: 0 },
    ]);
    expect(p.signals[p.signals.length - 1].id).toBe('colour');
    expect(p.top.map((x) => x.id)).toEqual(['colour']);
  });

  it('works the other way round and without a repertoire to point at', () => {
    const s = sig(buildProfile({ games: split(50, 15, 35) }), 'colour');
    expect(s.title).toBe('Results as White');
    expect(s.action.to).toBe('/openings');
  });
});

describe('buildProfile: top and strengths', () => {
  it('orders the top three by how far past the line they are', () => {
    const games = analysed(10, () => ({
      kinds: ['hung-piece', 'allowed-mate', 'missed-tactic', 'walked-into-tactic'],
      clock: { low: 4, hasty: 0, endedLow: true },
    }));
    const p = buildProfile({ games });
    // mates 1.0/0.3, clock 100%/40%, hung 1.0/0.5, tactics 2.0/1.5
    expect(p.signals.filter((s) => s.status === 'weak').map((s) => s.id)).toEqual(['hung', 'tactics', 'mates', 'clock']);
    expect(p.top.map((s) => s.id)).toEqual(['mates', 'clock', 'hung']);
    expect(p.top[0].severity).toBeGreaterThan(p.top[1].severity);
  });

  it('keeps strengths and weaknesses apart', () => {
    const p = buildProfile({ games: analysed(20, () => ({ kinds: ['hung-piece'] })) });
    expect(p.top.map((s) => s.id)).toEqual(['hung']);
    expect(p.strengths.map((s) => s.id)).toEqual(['tactics', 'mates']);
  });

  it('writes plainly: no exclamation marks, no em dashes', () => {
    const games = [
      ...analysed(20, () => ({
        kinds: ['hung-piece', 'allowed-mate', 'missed-tactic'],
        clock: { low: 1, hasty: 1, endedLow: true },
        winningTurns: 3,
        lastWinningPly: 30,
        phases: { opening: { accuracy: 90, moves: 10 }, middlegame: { accuracy: 70, moves: 20 }, endgame: { accuracy: 85, moves: 10 } },
      })),
    ];
    for (const s of buildProfile({ games }).signals) {
      for (const text of [s.title, s.valueText, s.baselineText ?? '', s.evidence, s.action.label]) {
        expect(text).not.toMatch(/[!—]/);
        expect(text.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('fmtRate', () => {
  it('keeps small rates visible', () => {
    expect(fmtRate(0)).toBe('0');
    expect(fmtRate(0.04)).toBe('0.04');
    expect(fmtRate(0.5)).toBe('0.5');
    expect(fmtRate(1.8)).toBe('1.8');
  });
});
