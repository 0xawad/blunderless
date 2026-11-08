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

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
