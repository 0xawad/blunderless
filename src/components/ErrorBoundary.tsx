import { Component, type ErrorInfo, type ReactNode } from 'react';
import { copy } from '../copy';

interface State { error?: Error }

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
    if (!this.state.error) return this.props.children;
    return (
      <section className="card empty-state">
        <div className="big-emoji" aria-hidden>♟</div>
        <h1>{copy.crash.title}</h1>
        <p className="lead">{copy.crash.body}</p>
        <p className="hint">{this.state.error.message}</p>
        <button className="btn primary" onClick={() => this.setState({ error: undefined })}>{copy.crash.retry}</button>
      </section>
    );
  }
}
