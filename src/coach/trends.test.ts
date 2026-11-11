import { describe, expect, it } from 'vitest';
import { copy } from '../copy';
import { analysed, analysis, game } from './fixtures';
import { PROFILE_WINDOW } from './profile';
import type { CoachGame } from './slim';
import { buildTrends, DELTA_WINDOW, MIN_DELTA_WINDOW, ROLLING_WINDOW, SERIES_CAP } from './trends';

const c = copy.coach.trends;

describe('buildTrends: series', () => {
  it('is empty without games', () => {
    const t = buildTrends([]);
    expect(t.series).toEqual([]);
    expect(t.summary).toBeNull();
    expect(t.deltas).toBeNull();
    expect(t.deltasText).toBe(c.deltaNeed(0, MIN_DELTA_WINDOW * 2));
    expect(t.byOpening).toEqual([]);
    expect(t.byColour).toEqual([]);
    expect(t.byTimeClass).toEqual([]);
    expect(t.totals).toEqual({ games: 0, analysed: 0, score: 0 });
  });

  it('lists analysed games oldest first with a rolling mean', () => {
    const games = analysed(12, (i) => ({ accuracy: 60 + i, blunders: i % 3, mistakes: 1 }));
    const t = buildTrends([...games].reverse()); // newest first, as the hook supplies them
    expect(t.series.map((p) => p.gameId)).toEqual(games.map((g) => g.id));
    expect(t.series[0]).toEqual({
      gameId: 'g0',
      at: games[0].at,
      result: 'win',
      color: 'white',
      accuracy: 60,
      blunders: 0,
      mistakes: 1,
      accuracyAvg: 60,
      blundersAvg: 0,
      mistakesAvg: 1,
    });
    expect(t.series[3].accuracyAvg).toBe(61.5); // 60..63
    // From the eleventh game on the mean covers the last ROLLING_WINDOW games only.
    expect(ROLLING_WINDOW).toBe(10);
    expect(t.series[11].accuracyAvg).toBe(66.5); // 62..71
    expect(t.series[11].blundersAvg).toBe(1.1); // 2,0,1,2,0,1,2,0,1,2
  });

  it('takes games in any order', () => {
    const games = analysed(6, (i) => ({ accuracy: 70 + i }));
    const shuffled = [games[3], games[0], games[5], games[1], games[4], games[2]];
    expect(buildTrends(shuffled)).toEqual(buildTrends(games));
  });

  it('skips games without a current analysis', () => {
    const games: CoachGame[] = [game(0), game(1, { review: 'stale' }), game(2, { a: analysis({ accuracy: 77 }) })];
    const t = buildTrends(games);
    expect(t.series.map((p) => p.gameId)).toEqual(['g2']);
    expect(t.totals).toEqual({ games: 3, analysed: 1, score: 100 });
  });

  it('caps the series but still averages across the cut', () => {
    const t = buildTrends(analysed(SERIES_CAP + 20, (i) => ({ accuracy: i % 2 ? 90 : 70 })));
    expect(t.series).toHaveLength(SERIES_CAP);
    expect(t.series[0].gameId).toBe('g20');
    expect(t.series[0].accuracyAvg).toBe(80); // ten games back, five of each
  });

  it('summarises the same window the profile reads', () => {
    const games = [...analysed(10, () => ({ accuracy: 50, blunders: 4, mistakes: 2 }), 0, () => ({ result: 'loss' })), ...analysed(PROFILE_WINDOW, () => ({ accuracy: 81, blunders: 1, mistakes: 0.5 }), 10)];
    expect(buildTrends(games).summary).toEqual({ games: PROFILE_WINDOW, accuracy: 81, blunders: 1, mistakes: 0.5, score: 100 });
  });
});

describe('buildTrends: last ten against the ten before', () => {
  const halves = (n: number, older: [number, number, CoachGame['result']], newer: [number, number, CoachGame['result']]) =>
    analysed(
      n,
      (i) => ({ accuracy: (i < n / 2 ? older : newer)[0], blunders: (i < n / 2 ? older : newer)[1], mistakes: 1 }),
      0,
      (i) => ({ result: (i < n / 2 ? older : newer)[2] }),
    );

  it('needs five games a side', () => {
    const t = buildTrends(analysed(MIN_DELTA_WINDOW * 2 - 1));
    expect(t.deltas).toBeNull();
    expect(t.deltasText).toBe(c.deltaNeed(9, 10));
  });

  it('compares smaller halves until there are twenty games', () => {
    const t = buildTrends(halves(12, [70, 2, 'loss'], [80, 1, 'win']));
    expect(t.deltas?.window).toBe(6);
    expect(t.deltasText).toBe(c.delta(6));
  });

  it('reports better when accuracy rises and blunders fall', () => {
    const t = buildTrends(halves(20, [70, 2, 'loss'], [80, 1, 'win']));
    expect(t.deltas?.window).toBe(DELTA_WINDOW);
    expect(t.deltas?.items).toEqual([
      { metric: 'accuracy', label: 'Accuracy', recent: 80, previous: 70, delta: 10, trend: 'better', trendLabel: 'Better' },
      { metric: 'blunders', label: 'Blunders per game', recent: 1, previous: 2, delta: -1, trend: 'better', trendLabel: 'Better' },
      { metric: 'mistakes', label: 'Mistakes per game', recent: 1, previous: 1, delta: 0, trend: 'flat', trendLabel: 'Steady' },
      { metric: 'score', label: 'Score', recent: 100, previous: 0, delta: 100, trend: 'better', trendLabel: 'Better' },
    ]);
  });

  it('reports worse the other way round', () => {
    const items = buildTrends(halves(20, [80, 1, 'win'], [70, 2, 'loss'])).deltas!.items;
    expect(items.map((d) => d.trend)).toEqual(['worse', 'worse', 'flat', 'worse']);
    expect(items[1].delta).toBe(1);
  });

  it('calls a small wobble steady', () => {
    // 1 accuracy point, 0.2 blunders and one result out of ten: all inside the noise.
    const games = analysed(
      20,
      (i) => ({ accuracy: i < 10 ? 79 : 80, blunders: i < 10 ? 1 : i < 12 ? 2 : 1, mistakes: 0 }),
      0,
      (i) => ({ result: i === 19 ? 'loss' : 'win' }),
    );
    expect(buildTrends(games).deltas!.items.map((d) => d.trend)).toEqual(['flat', 'flat', 'flat', 'flat']);
  });

  it('only looks at the most recent twenty', () => {
    // Five ancient disasters must not leak into "the ten before".
    const games = [...analysed(5, () => ({ accuracy: 10, blunders: 9 })), ...analysed(20, () => ({ accuracy: 80, blunders: 1 }), 5)];
    const [acc, blunders] = buildTrends(games).deltas!.items;
    expect(acc).toMatchObject({ recent: 80, previous: 80, trend: 'flat' });
    expect(blunders).toMatchObject({ recent: 1, previous: 1 });
  });
});

describe('buildTrends: breakdowns', () => {
  const games: CoachGame[] = [
    game(0, { color: 'white', family: 'Italian Game', result: 'win', timeClass: 'blitz', a: analysis({ accuracy: 80, blunders: 1 }) }),
    game(1, { color: 'black', family: 'Caro-Kann Defense', result: 'loss', timeClass: 'blitz', a: analysis({ accuracy: 60, blunders: 3 }) }),
    game(2, { color: 'white', family: 'Italian Game', result: 'draw', timeClass: 'rapid' }),
    game(3, { color: 'black', family: 'Caro-Kann Defense', result: 'win', timeClass: 'hyperbullet' }),
    game(4, { color: 'white', result: 'win', timeClass: 'blitz', a: analysis({ accuracy: 90, blunders: 0 }) }),
  ];
  const t = buildTrends(games);

  it('splits by opening family and colour', () => {
    expect(t.byOpening).toEqual([
      { key: 'black|Caro-Kann Defense', label: 'Caro-Kann Defense', side: 'black', games: 2, wins: 1, draws: 0, losses: 1, score: 50, analysed: 1, accuracy: 60, blunders: 3 },
      { key: 'white|Italian Game', label: 'Italian Game', side: 'white', games: 2, wins: 1, draws: 1, losses: 0, score: 75, analysed: 1, accuracy: 80, blunders: 1 },
    ]);
  });

  it('splits by colour, White first', () => {
    expect(t.byColour).toEqual([
      { key: 'white', label: 'As White', side: undefined, games: 3, wins: 2, draws: 1, losses: 0, score: 83, analysed: 2, accuracy: 85, blunders: 0.5 },
      { key: 'black', label: 'As Black', side: undefined, games: 2, wins: 1, draws: 0, losses: 1, score: 50, analysed: 1, accuracy: 60, blunders: 3 },
    ]);
  });

  it('splits by time class, most played first, with unknown speeds together', () => {
    expect(t.byTimeClass.map((r) => [r.key, r.label, r.games, r.score, r.accuracy])).toEqual([
      ['blitz', 'Blitz', 3, 67, 77],
      ['other', 'Other', 1, 100, null],
      ['rapid', 'Rapid', 1, 50, null],
    ]);
    expect(t.totals).toEqual({ games: 5, analysed: 3, score: 70 });
  });

  it('counts unanalysed games in the score but not in accuracy', () => {
    const rapid = t.byTimeClass.find((r) => r.key === 'rapid')!;
    expect(rapid).toMatchObject({ games: 1, analysed: 0, accuracy: null, blunders: null });
  });

  it('names practice games against Stockfish', () => {
    expect(buildTrends([game(0, { timeClass: 'training' })]).byTimeClass[0].label).toBe('Practice games');
  });
});
