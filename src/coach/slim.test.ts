import { describe, expect, it } from 'vitest';
import { ANALYSIS_VERSION } from '../games/analyze';
import type { GameAnalysis, GameRow, MoveReview } from '../srs/types';
import { game } from './fixtures';
import { familyOf, indexLines, newestFirst, ownMovesBefore, slimAttempt, slimGame, startOfDay } from './slim';

const move = (over: Partial<MoveReview> = {}): MoveReview => ({ cls: 'good', drop: 0, best: 'e2e4', pv: ['e2e4', 'e7e5'], ...over });

/** Six plies. White is winning with the move at positions 2 and 4, then throws it away on ply 4. */
const analysis = (over: Partial<GameAnalysis> = {}): GameAnalysis => ({
  version: ANALYSIS_VERSION,
  depth: 12,
  evals: [0, 20, 500, 480, 520, -300, -400],
  moves: [
    move({ cls: 'book' }),
    move(),
    move({ cls: 'best' }),
    move(),
    move({ cls: 'missed-win', drop: 60, kind: 'hung-piece', left: 5, spent: 1 }),
    move({ cls: 'blunder', drop: 40 }), // the opponent's: no kind
  ],
  accuracy: 71,
  blunders: 1,
  mistakes: 0,
  phases: { opening: { accuracy: 95, moves: 1 }, middlegame: { accuracy: 60, moves: 2 }, endgame: { accuracy: 0, moves: 0 } },
  time: { base: 180, inc: 0, lowTimeErrors: 1, hastyErrors: 0, openingSecs: 10, totalSecs: 100, endedLow: true },
  analyzedAt: new Date(2026, 0, 3),
  ...over,
});

const row = (over: Partial<GameRow> = {}): GameRow => ({
  id: 'g1',
  source: 'chesscom',
  pgn: '1. e4 e5 2. Nf3 Nc6 3. Bc4 *',
  white: 'me',
  black: 'them',
  userColor: 'white',
  result: 'loss',
  timeClass: 'blitz',
  endTime: new Date(2026, 0, 2),
  ...over,
});

describe('slimGame', () => {
  it('keeps the numbers and drops the PGN, evals and engine lines', () => {
    const s = slimGame(
      row({
        analysis: analysis(),
        opening: { eco: 'C50', name: 'Italian Game: Giuoco Pianissimo' },
        book: { status: 'you-deviated', ply: 6, played: 'Ng5', expected: 'c3', lineId: 'white-italian:e4 e5' },
      }),
    );
    expect(s).toEqual({
      id: 'g1',
      at: new Date(2026, 0, 2).getTime(),
      color: 'white',
      result: 'loss',
      timeClass: 'blitz',
      opp: 'them',
      review: 'current',
      unreviewable: false,
      family: 'Italian Game',
      book: { status: 'you-deviated', ply: 6, lineId: 'white-italian:e4 e5' },
      a: {
        at: new Date(2026, 0, 3).getTime(),
        accuracy: 71,
        blunders: 1,
        mistakes: 0,
        errors: [{ ply: 4, kind: 'hung-piece', missedWin: true, clock: 'low' }],
        winningTurns: 2,
        lastWinningPly: 4,
        phases: { opening: { accuracy: 95, moves: 1 }, middlegame: { accuracy: 60, moves: 2 }, endgame: { accuracy: 0, moves: 0 } },
        clock: { low: 1, hasty: 0, endedLow: true },
      },
    });
    const text = JSON.stringify(s);
    expect(text).not.toContain('Nf3');
    expect(text).not.toContain('e2e4');
    expect(text).not.toContain('evals');
  });

  it('marks older analyses stale and leaves their numbers out', () => {
    const old = slimGame(row({ analysis: analysis({ version: ANALYSIS_VERSION - 1 }) }));
    expect(old.review).toBe('stale');
    expect(old.a).toBeUndefined();
    expect(slimGame(row({ analysis: analysis({ version: undefined }) })).review).toBe('stale');
    expect(slimGame(row()).review).toBe('none');
    expect(slimGame(row({ analysis: analysis({ version: ANALYSIS_VERSION + 1 }) })).review).toBe('current');
  });

  it('reads Black games from Black’s side', () => {
    const s = slimGame(
      row({
        userColor: 'black',
        analysis: analysis({
          evals: [0, -500, -480, -520, 300, 400, 380],
          moves: [move(), move({ cls: 'best' }), move(), move({ cls: 'blunder', drop: 70, kind: 'allowed-mate' }), move(), move()],
          time: undefined,
        }),
      }),
    );
    expect(s.opp).toBe('me');
    expect(s.a?.errors).toEqual([{ ply: 3, kind: 'allowed-mate', missedWin: false }]);
    expect(s.a?.winningTurns).toBe(2); // positions 1 and 3
    expect(s.a?.lastWinningPly).toBe(3);
    expect(s.a?.clock).toBeUndefined();
  });

  it('works out whose plies are whose when Black moves first', () => {
    // A game started from a position with Black to move: the Black player's moves are the even plies.
    const s = slimGame(
      row({
        userColor: 'black',
        analysis: analysis({
          evals: [-500, -450, -520, 0],
          moves: [move(), move(), move({ cls: 'mistake', drop: 25, kind: 'missed-tactic' })],
          time: undefined,
        }),
      }),
    );
    expect(s.a?.winningTurns).toBe(2); // positions 0 and 2
    expect(s.a?.lastWinningPly).toBe(2);
  });

  it('tells a rushed mistake from one in time trouble', () => {
    const errorsOf = (left: number, spent: number) =>
      slimGame(row({ analysis: analysis({ moves: [move({ cls: 'blunder', kind: 'fork', left, spent })], evals: [0, -300] }) })).a!.errors[0].clock;
    expect(errorsOf(10, 8)).toBe('low'); // under 20s on a 3-minute clock
    expect(errorsOf(100, 1)).toBe('hasty');
    expect(errorsOf(100, 12)).toBeUndefined();
  });

  it('names the opening family, falling back to the analysis', () => {
    expect(slimGame(row({ opening: { eco: 'B12', name: 'Caro-Kann Defense: Advance Variation' } })).family).toBe('Caro-Kann Defense');
    expect(slimGame(row({ analysis: analysis({ opening: { eco: 'C50', name: 'Italian Game', ply: 6 } }) })).family).toBe('Italian Game');
    expect(slimGame(row()).family).toBeUndefined();
  });

  it('survives a malformed row', () => {
    const broken = { ...row(), endTime: '2026-01-02T10:00:00.000Z', analysis: { version: ANALYSIS_VERSION, depth: 12 } } as unknown as GameRow;
    const s = slimGame(broken);
    expect(s.at).toBe(Date.parse('2026-01-02T10:00:00.000Z'));
    expect(s.a).toMatchObject({ accuracy: 0, blunders: 0, errors: [], winningTurns: 0, lastWinningPly: -1 });
    expect(slimGame({ ...row(), endTime: undefined } as unknown as GameRow).at).toBe(0);
  });

  it('marks games that can never be analysed', () => {
    expect(slimGame(row()).unreviewable).toBe(false);
    expect(slimGame(row({ unreadable: true })).unreviewable).toBe(true); // PGN cannot be replayed
    expect(slimGame(row({ unanalysable: true })).unreviewable).toBe(true); // fewer than two moves of yours
  });
});

describe('slim helpers', () => {
  it('counts your own moves before a ply', () => {
    expect(ownMovesBefore(0, 'white')).toBe(0);
    expect(ownMovesBefore(4, 'white')).toBe(2);
    expect(ownMovesBefore(5, 'white')).toBe(3);
    expect(ownMovesBefore(1, 'black')).toBe(0);
    expect(ownMovesBefore(3, 'black')).toBe(1);
    expect(ownMovesBefore(5, 'black')).toBe(2);
  });

  it('cuts an opening name at the colon', () => {
    expect(familyOf('Sicilian Defense: Alapin Variation, Smith-Morra Declined')).toBe('Sicilian Defense');
    expect(familyOf('Italian Game')).toBe('Italian Game');
  });

  it('indexes lines with a readable name and their place in the repertoire', () => {
    const idx = indexLines([
      { id: 'r', title: 'The Italian', side: 'white', lines: [{ id: 'r:a', chapterTitle: 'Slow', label: 'Main line' }, { id: 'r:b', chapterTitle: 'Slow', label: 'vs 4...d6' }, { id: 'r:c' }] },
    ]);
    expect(idx.get('r:a')).toEqual({ id: 'r:a', repId: 'r', repTitle: 'The Italian', name: 'The Italian, Slow', index: 0 });
    expect(idx.get('r:b')?.name).toBe('The Italian, Slow, vs 4...d6');
    expect(idx.get('r:c')).toMatchObject({ name: 'The Italian', index: 2 });
  });

  it('sorts newest first only when it has to', () => {
    const sorted = [game(3), game(2), game(1)];
    expect(newestFirst(sorted)).toBe(sorted);
    const mixed = [game(1), game(3), game(2)];
    expect(newestFirst(mixed).map((g) => g.id)).toEqual(['g3', 'g2', 'g1']);
    expect(mixed.map((g) => g.id)).toEqual(['g1', 'g3', 'g2']); // input untouched
  });

  it('slims an attempt and finds midnight', () => {
    const at = new Date(2026, 4, 2, 15, 30);
    expect(slimAttempt({ id: 7, puzzleId: 'p', source: 'lichess', theme: 'fork', solved: true, at })).toEqual({
      puzzleId: 'p',
      theme: 'fork',
      source: 'lichess',
      solved: true,
      at: at.getTime(),
    });
    expect(startOfDay(at)).toBe(new Date(2026, 4, 2).getTime());
  });
});
