import { useEffect } from 'react';
import { copy } from '../copy';
import { onQueueFinish, stopQueue, useQueue } from '../games/queue';
import { useToast } from './Toast';

/** Reports how a batch went, whichever page started it. Mount once inside ToastProvider. */
export function QueueNotifier() {
  const toast = useToast();
  useEffect(() => {
    onQueueFinish((s) => {
      if (s.failed) toast(copy.engine.failed, 'bad');
      else if (s.done) toast(copy.games.madePuzzles(s.puzzles), s.puzzles ? 'neutral' : 'good');
    });
    return () => onQueueFinish(null);
  }, [toast]);
  return null;
}

/** Progress card for the background analysis queue; renders nothing when idle. */
export function QueueStatus() {
  const q = useQueue();
  if (!q.running) return null;
  const pct = Math.round(((q.done + q.progress) / Math.max(1, q.total)) * 100);
  return (
    <div className="card queue" role="status">
      <div className="queue-text">
        <strong>{copy.games.queue(q.done, q.total, pct)}</strong>
        <span className="muted small">{copy.games.queueHint}</span>
      </div>
      <button className="btn ghost small" onClick={stopQueue}>{copy.games.stop}</button>
      <div className="progress"><span style={{ width: `${pct}%` }} /></div>
    </div>
  );
}
