import { Component, type ErrorInfo, type ReactNode } from 'react';
import { copy } from '../copy';

interface State { error?: Error }

/**
 * A page chunk that would not load (offline, or a deploy replaced it while
 * this tab was open). React keeps the failed import, so rendering again can
 * never succeed: only a reload fetches the page anew.
 */
const isChunkLoadError = (error: Error) =>
  /dynamically imported module|module script failed|Unable to preload CSS/i.test(error.message);

/** Keeps one broken page (a PGN chess.js rejects, say) from blanking the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: undefined });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const chunk = isChunkLoadError(error);
    const reload = () => window.location.reload();
    return (
      <div className="empty-state center" role="alert">
        <h2>{copy.crash.title}</h2>
        <p>{chunk ? copy.crash.chunk : copy.crash.body}</p>
        {!chunk && error.message && <p className="hint">{error.message}</p>}
        <div className="actions">
          {chunk ? (
            <button type="button" className="btn primary" onClick={reload}>{copy.crash.reload}</button>
          ) : (
            <>
              <button type="button" className="btn primary" onClick={() => this.setState({ error: undefined })}>{copy.crash.retry}</button>
              <button type="button" className="btn ghost" onClick={reload}>{copy.crash.reload}</button>
            </>
          )}
        </div>
      </div>
    );
  }
}
