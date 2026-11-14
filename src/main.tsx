import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { readTheme, setTheme } from './theme';
import { applyPrefsToDocument } from './prefs';
import { warmAudioOnFirstInteraction } from './sound';
import './styles/tokens.css';
import './styles/legacy.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/components.css';
import './styles/board.css';
import './styles/polish.css';
import './pieces.css';

// public/theme-init.js has already done both of these before first paint;
// repeating them here keeps the app correct if that script failed to load.
setTheme(readTheme());
applyPrefsToDocument();
warmAudioOnFirstInteraction();
// A repertoire edit changes line ids; carry existing drill progress over before anything reads it.
void import('./srs/db').then((m) => m.migrateOrphanLines()).catch(() => {});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// A chunk that fails to load is almost always from a build that is no longer
// served (a deploy happened while this tab was open): reload onto the new one.
// Once per page and per minute, so being offline cannot turn into a reload loop
// (the error boundary then offers a Reload button instead).
window.addEventListener('vite:preloadError', (e) => {
  const key = 'reloaded-for-chunk';
  try {
    const [href, at] = (sessionStorage.getItem(key) ?? '').split('\n');
    if (href === location.href && Date.now() - Number(at) < 60_000) return;
    sessionStorage.setItem(key, `${location.href}\n${Date.now()}`);
  } catch {
    return; // no session storage to remember the attempt in: let the error boundary handle it
  }
  e.preventDefault();
  location.reload();
});

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
