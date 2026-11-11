import { useEffect } from 'react';
import { copy } from '../copy';
import { onQueueFinish, stopQueue, useQueue } from '../games/queue';
import { useToast } from './Toast';

/** Reports how a batch went, whichever page started it. Mount once inside ToastProvider. */
export function QueueNotifier() {
  const toast = useToast();
  useEffect(() => {
    onQueueFinish((s) => {
      if (s.failed) return toast(s.failure === 'storage' ? copy.games.storageFull : copy.engine.failed, 'bad');
      if (s.errors > 0) toast(copy.games.someFailed(s.errors), 'bad');
      if (s.done === 0) return;
      if (s.puzzles > 0) toast(copy.games.madePuzzles(s.puzzles), 'neutral');
      else if (s.mistakes === 0) toast(copy.games.madePuzzles(0), 'good');
      else toast(copy.games.reviewedClean, 'good');
    });
    return () => onQueueFinish(null);
  }, [toast]);
  return null;
}

/** Progress for the background analysis queue; renders nothing when idle. */
export function QueueStatus() {
  const q = useQueue();
  if (!q.running) return null;
  const pct = Math.round(((q.done + q.progress) / Math.max(1, q.total)) * 100);
  return (
    <div className="callout queue" role="status">
      <span className="spinner" aria-hidden />
      <div className="callout-body">
        <strong>{copy.games.queue(q.done, q.total, pct)}</strong>
        <div className="muted small">{copy.games.queueHint}</div>
        <div className="progress" style={{ marginTop: 8 }}><span style={{ width: `${pct}%` }} /></div>
      </div>
      <div className="callout-actions">
        <button className="btn quiet small" onClick={stopQueue}>{copy.games.stop}</button>
      </div>
    </div>
  );
}
