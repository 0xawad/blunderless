import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyTheme, readTheme } from './theme';
import { applyPrefsToDocument } from './prefs';
import { warmAudioOnFirstInteraction } from './sound';
import './styles.css';
import './pieces.css';

applyTheme(readTheme());
applyPrefsToDocument();
warmAudioOnFirstInteraction();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// A chunk that fails to load is almost always from a build that is no longer
// served (a deploy happened while this tab was open): reload onto the new one.
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault();
  const key = 'reloaded-for-chunk';
  if (sessionStorage.getItem(key) === location.href) return; // don't loop
  sessionStorage.setItem(key, location.href);
  location.reload();
});

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
