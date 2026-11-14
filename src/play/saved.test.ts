import { describe, expect, it } from 'vitest';
import { validSave } from './saved';

const good = {
  v: 1,
  setup: { level: 2, time: 0, guard: true, cct: false },
  color: 'white',
  moves: ['e2e4', 'e7e5', 'g1f3'],
  clocks: { w: 0, b: 0 },
  log: [
    { san: 'e4', color: 'w', verdict: 'best' },
    { san: 'e5', color: 'b' },
    { san: 'Nf3', color: 'w' },
  ],
  saves: 1,
  hints: 0,
  savedAt: 1,
};

describe('validSave', () => {
  it('accepts a game that replays, and keeps its verdicts', () => {
    const v = validSave(good);
    expect(v?.moves).toHaveLength(3);
    expect(v?.log[0].verdict).toBe('best');
  });

  it('refuses a game with a move that cannot be played', () => {
    expect(validSave({ ...good, moves: ['e2e4', 'e7e5', 'e4e6'] })).toBeNull();
  });

  it('refuses the wrong version, no moves, or a bad starting position', () => {
    expect(validSave({ ...good, v: 2 })).toBeNull();
    expect(validSave({ ...good, moves: [] })).toBeNull();
    expect(validSave({ ...good, startFen: 'not a fen' })).toBeNull();
    expect(validSave(null)).toBeNull();
    expect(validSave('x')).toBeNull();
  });

  it('rebuilds a move log that does not match the moves', () => {
    const v = validSave({ ...good, log: [{ san: 'd4', color: 'w' }] });
    expect(v?.log.map((l) => l.san)).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('never returns a negative or missing clock', () => {
    expect(validSave({ ...good, clocks: { w: -5 } })?.clocks).toEqual({ w: 0, b: 0 });
  });

  it('replays from a custom starting position', () => {
    const v = validSave({ ...good, startFen: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', moves: ['e2e4'], log: [] });
    expect(v?.log).toEqual([{ san: 'e4', color: 'w' }]);
  });
});
