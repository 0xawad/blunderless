import { copy } from '../copy';
import { stopQueue, useQueue } from '../games/queue';

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
