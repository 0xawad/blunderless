// A year of blitz is thousands of games. These bounds are loose on purpose
// (a slow CI machine must not fail them); they exist to catch an accidental
// quadratic loop, not to benchmark.
import { describe, expect, it } from 'vitest';
import { ANALYSIS_VERSION } from '../games/analyze';
import type { GameRow, MoveReview } from '../srs/types';
import { analysis, card, game, NOW } from './fixtures';
import { buildMotifs } from './motifs';
import { buildPlan } from './plan';
import { buildProfile } from './profile';
import { slimGame, type CoachAttempt, type CoachGame } from './slim';
import { buildTrends } from './trends';

const FAMILIES = ['Italian Game', 'Caro-Kann Defense', 'Sicilian Defense', 'French Defense', "Queen's Gambit Declined", 'London System', 'Scandinavian Defense', 'Ruy Lopez'];
const KINDS = ['hung-piece', 'missed-tactic', 'walked-into-tactic', 'fork', 'allowed-mate', 'missed-mate'] as const;

function manyGames(n: number): CoachGame[] {
  return Array.from({ length: n }, (_, i) =>
    game(i, {
      family: FAMILIES[i % FAMILIES.length],
      timeClass: i % 5 ? 'blitz' : 'rapid',
      result: i % 3 === 0 ? 'loss' : i % 7 === 0 ? 'draw' : 'win',
      book: { status: i % 4 === 0 ? 'you-deviated' : 'they-deviated', ply: 6 + (i % 5), lineId: `rep:${i % 30}` },
      a:
        i % 2 === 0
          ? analysis({
              kinds: [KINDS[i % 6], KINDS[(i + 2) % 6], KINDS[(i + 3) % 6]],
              clock: { low: i % 2, hasty: i % 3 ? 0 : 1, endedLow: i % 4 === 0 },
              phases: { opening: { accuracy: 92, moves: 9 }, middlegame: { accuracy: 78, moves: 22 }, endgame: { accuracy: 81, moves: i % 3 ? 12 : 0 } },
              winningTurns: i % 5,
              lastWinningPly: 30,
            })
          : undefined,
    }),
  );
}

describe('coach performance', () => {
  it('builds the profile, trends, motifs and plan for ten thousand games quickly', () => {
    const games = manyGames(10_000).reverse(); // newest first, as the hook supplies them
    const attempts: CoachAttempt[] = Array.from({ length: 5000 }, (_, i) => ({
      puzzleId: `p${i}`,
      theme: ['fork', 'pin', 'mateIn1', 'hung-piece'][i % 4],
      source: i % 4 === 3 ? 'mine' : 'lichess',
      solved: i % 3 !== 0,
      at: NOW.getTime() - i * 60_000,
    }));
    const cards = Array.from({ length: 80 }, (_, i) => card(`rep:${i}`, { due: NOW.getTime() - (i % 2) * 1000 }));

    const t0 = performance.now();
    const profile = buildProfile({ games, cards });
    const trends = buildTrends(games);
    const motifs = buildMotifs(attempts, profile);
    const plan = buildPlan({
      now: NOW,
      repertoires: [{ id: 'rep', title: 'Rep', side: 'white', lines: Array.from({ length: 120 }, (_, i) => ({ id: `rep:${i}` })) }],
      focus: ['rep'],
      cards,
      games,
      reviewsToday: 0,
      puzzlesDue: 40,
      puzzlesReviewedToday: 0,
      attemptsToday: 0,
      sparredToday: false,
      endgameToday: false,
      endgames: [{ id: 'kq', title: 'Queen mate' }],
      endgamesWon: [],
      motif: motifs.recommended,
      profile,
    });
    const ms = performance.now() - t0;

    expect(profile.sample.analysed).toBe(5000);
    expect(trends.totals.games).toBe(10_000);
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(750);
  });

  it('slims two thousand full game rows quickly', () => {
    const move = (i: number): MoveReview => ({
      cls: i % 11 === 0 ? 'blunder' : 'good',
      drop: i % 11 === 0 ? 35 : 1.2,
      best: 'g1f3',
      pv: ['g1f3', 'b8c6', 'f1c4', 'f8c5', 'c2c3', 'g8f6'],
      kind: i % 22 === 0 ? 'missed-tactic' : undefined,
      left: 120 - i,
      spent: 2.5,
    });
    const pgn = Array.from({ length: 40 }, (_, i) => `${i + 1}. Nf3 {[%clk 0:02:59.9]} Nc6 {[%clk 0:02:58.1]}`).join(' ');
    const rows: GameRow[] = Array.from({ length: 2000 }, (_, i) => ({
      id: `g${i}`,
      source: 'chesscom',
      pgn,
      white: 'me',
      black: 'them',
      userColor: i % 2 ? 'black' : 'white',
      result: 'win',
      timeClass: 'blitz',
      endTime: new Date(NOW.getTime() - i * 3_600_000),
      opening: { eco: 'C50', name: 'Italian Game: Giuoco Pianissimo' },
      book: { status: 'they-deviated', ply: 7, played: 'h6' },
      analysis: {
        version: ANALYSIS_VERSION,
        depth: 12,
        evals: Array.from({ length: 81 }, (_, k) => (k % 9) * 60 - 200),
        moves: Array.from({ length: 80 }, (_, k) => move(k)),
        accuracy: 80,
        blunders: 2,
        mistakes: 1,
        phases: { opening: { accuracy: 95, moves: 8 }, middlegame: { accuracy: 77, moves: 25 }, endgame: { accuracy: 82, moves: 7 } },
        time: { base: 180, inc: 0, lowTimeErrors: 1, hastyErrors: 0, openingSecs: 20, totalSecs: 170, endedLow: true },
        analyzedAt: NOW,
      },
    }));

    const t0 = performance.now();
    const slim = rows.map(slimGame);
    const ms = performance.now() - t0;

    expect(slim).toHaveLength(2000);
    expect(slim[0].a?.errors.length).toBeGreaterThan(0);
    // Each slim game is a small fraction of the row it came from.
    expect(JSON.stringify(slim[0]).length).toBeLessThan(JSON.stringify(rows[0]).length / 8);
    expect(ms).toBeLessThan(750);
  });
});
