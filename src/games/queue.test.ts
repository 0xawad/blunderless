import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EngineError } from '../engine/engine';
import type { AnalyzeOutcome } from './store';

const { analyze } = vi.hoisted(() => ({
  analyze: vi.fn<(id: string, onProgress?: (p: number) => void, opts?: { signal?: AbortSignal }) => Promise<AnalyzeOutcome>>(),
}));

vi.mock('./store', () => ({
  analyzeStoredGameFull: analyze,
  isStorageError: (e: unknown) => e instanceof Error && e.name === 'StorageError',
}));

import { enqueue, getQueue, onQueueFinish, stopQueue, type QueueState } from './queue';

const ok = (added = 0, mistakes = added): AnalyzeOutcome => ({ status: 'analysed', added, updated: 0, removed: 0, mistakes });
const abortErr = () => Object.assign(new Error('analysis aborted'), { name: 'AbortError' });

/** Resolves with the state handed to the finish callback. */
const finished = () => new Promise<QueueState>((resolve) => onQueueFinish(resolve));

/** An analysis that runs until the test lets it go, or until it is aborted. */
function pendingAnalysis() {
  let release!: (r: AnalyzeOutcome) => void;
  const started: string[] = [];
  const impl = (id: string, _p?: (p: number) => void, opts?: { signal?: AbortSignal }) =>
    new Promise<AnalyzeOutcome>((resolve, reject) => {
      started.push(id);
      release = resolve;
      opts?.signal?.addEventListener('abort', () => reject(abortErr()), { once: true });
    });
  return { impl, started, release: (r: AnalyzeOutcome) => release(r) };
}

beforeEach(() => {
  analyze.mockReset();
  onQueueFinish(null);
});

describe('analysis queue', () => {
  it('runs a batch in order and adds up puzzles and mistakes', async () => {
    analyze.mockResolvedValueOnce(ok(2)).mockResolvedValueOnce(ok(0, 3)).mockResolvedValueOnce(ok(1));
    const end = finished();
    enqueue(['a', 'b', 'b', 'c']);
    expect(getQueue()).toMatchObject({ running: true, total: 3 });
    const s = await end;
    expect(analyze.mock.calls.map((c) => c[0])).toEqual(['a', 'b', 'c']);
    expect(s).toMatchObject({ running: false, done: 3, total: 3, puzzles: 3, mistakes: 6, errors: 0, skipped: 0, failed: false, stopped: false, pending: [] });
    expect(s.current).toBeUndefined();
  });

  it('counts a game that failed as an error, not as done, and carries on', async () => {
    analyze.mockResolvedValueOnce(ok(1)).mockRejectedValueOnce(new Error('bad move data')).mockResolvedValueOnce(ok(1));
    const end = finished();
    enqueue(['a', 'b', 'c']);
    const s = await end;
    expect(s).toMatchObject({ done: 2, errors: 1, lastError: 'bad move data', failed: false, puzzles: 2 });
    // The failed game leaves the total, so done/total still reads as finished.
    expect(s.total).toBe(2);
    expect(analyze).toHaveBeenCalledTimes(3);
  });

  it('stops the batch on a storage error and says so', async () => {
    const quota = Object.assign(new Error('storage: QuotaExceededError: no space'), { name: 'StorageError' });
    analyze.mockResolvedValueOnce(ok(1)).mockRejectedValueOnce(quota);
    const end = finished();
    enqueue(['a', 'b', 'c', 'd']);
    const s = await end;
    expect(s).toMatchObject({ failed: true, failure: 'storage', done: 1, errors: 1, total: 1, pending: [] });
    expect(s.lastError).toContain('QuotaExceededError');
    expect(analyze).toHaveBeenCalledTimes(2); // c and d were never started
  });

  it('stops the batch when the engine dies', async () => {
    analyze.mockRejectedValueOnce(new EngineError('engine ignored stop'));
    const end = finished();
    enqueue(['a', 'b']);
    expect(await end).toMatchObject({ failed: true, failure: 'engine', done: 0, errors: 1, lastError: 'engine ignored stop' });
    expect(analyze).toHaveBeenCalledTimes(1);

    // Errors from older code paths that only carry the word are still recognised.
    analyze.mockRejectedValueOnce(new Error('engine is dead'));
    const again = finished();
    enqueue(['a']);
    expect(await again).toMatchObject({ failed: true, failure: 'engine' });
  });

  it('keeps games with nothing to analyse out of done', async () => {
    analyze
      .mockResolvedValueOnce({ status: 'unreadable', added: 0, updated: 0, removed: 0, mistakes: 0 })
      .mockResolvedValueOnce({ status: 'unanalysable', added: 0, updated: 0, removed: 0, mistakes: 0 })
      .mockResolvedValueOnce(ok(0));
    const end = finished();
    enqueue(['a', 'b', 'c']);
    expect(await end).toMatchObject({ done: 1, skipped: 2, total: 1, errors: 0, failed: false });
  });

  it('Stop abandons the game in progress at once: neither done nor failed', async () => {
    const job = pendingAnalysis();
    analyze.mockImplementation(job.impl);
    const end = finished();
    enqueue(['a', 'b', 'c']);
    await vi.waitFor(() => expect(job.started).toEqual(['a']));
    const signal = analyze.mock.calls[0][2]!.signal!;
    analyze.mock.calls[0][1]!(0.4);
    expect(getQueue().progress).toBe(0.4);

    stopQueue();
    expect(signal.aborted).toBe(true);
    expect(getQueue()).toMatchObject({ stopped: true, pending: [], total: 0, progress: 0 });
    const s = await end;
    expect(s).toMatchObject({ running: false, stopped: true, done: 0, errors: 0, failed: false, total: 0 });
    expect(job.started).toEqual(['a']); // b and c never started
  });

  it('a new request while a stopped game winds down starts a fresh run of work', async () => {
    const job = pendingAnalysis();
    analyze.mockImplementationOnce(job.impl).mockResolvedValueOnce(ok(1));
    const end = finished();
    enqueue(['a', 'b']);
    await vi.waitFor(() => expect(job.started).toEqual(['a']));
    stopQueue();
    enqueue(['z']);
    const s = await end;
    expect(analyze.mock.calls.map((c) => c[0])).toEqual(['a', 'z']);
    expect(s).toMatchObject({ done: 1, total: 1, stopped: false, puzzles: 1 });
  });

  it('adds to a running batch without repeating what is already queued', async () => {
    const job = pendingAnalysis();
    analyze.mockImplementationOnce(job.impl).mockResolvedValue(ok(0));
    const end = finished();
    enqueue(['a', 'b']);
    await vi.waitFor(() => expect(job.started).toEqual(['a']));
    enqueue(['a', 'b', 'c']);
    expect(getQueue()).toMatchObject({ current: 'a', pending: ['b', 'c'], total: 3 });
    job.release(ok(0));
    expect(await end).toMatchObject({ done: 3, total: 3 });
  });

  it('starts every batch from a clean slate', async () => {
    analyze.mockRejectedValueOnce(new Error('odd game'));
    let end = finished();
    enqueue(['a']);
    expect(await end).toMatchObject({ errors: 1, lastError: 'odd game' });
    analyze.mockResolvedValueOnce(ok(1));
    end = finished();
    enqueue(['b']);
    const s = await end;
    expect(s).toMatchObject({ errors: 0, done: 1, total: 1, failed: false });
    expect(s.lastError).toBeUndefined();
    expect(s.failure).toBeUndefined();
  });

  it('Stop with nothing running does nothing', () => {
    const before = getQueue();
    stopQueue();
    expect(getQueue()).toBe(before);
  });
});
