import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, liveCards, statusOf } from './srs/db';
import { copy } from './copy';
import { applyTheme, readTheme, type Theme } from './theme';
import { ToastProvider } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { BookIcon, GamesIcon, GearIcon, HomeIcon, MoonIcon, PlayIcon, PuzzleIcon, SoundOffIcon, SoundOnIcon, StatsIcon, SunIcon } from './components/icons';
import { setPrefs, usePrefs } from './prefs';
import { play, unlockAudio } from './sound';
import { protectStorage } from './storage';
import { QueueNotifier } from './components/QueueStatus';
import { Home } from './pages/Home';
import { Welcome } from './pages/Welcome';
import { Openings } from './pages/Openings';
import { RepertoirePage } from './pages/RepertoirePage';
import { Learn } from './pages/Learn';
import { DrillPage } from './pages/DrillPage';
import { Settings } from './pages/Settings';

// Engine-heavy pages load on demand.
const Games = lazy(() => import('./pages/Games').then((m) => ({ default: m.Games })));
const GameReview = lazy(() => import('./pages/GameReview').then((m) => ({ default: m.GameReview })));
const Puzzles = lazy(() => import('./pages/Puzzles').then((m) => ({ default: m.Puzzles })));
const Play = lazy(() => import('./pages/Play').then((m) => ({ default: m.Play })));
const Stats = lazy(() => import('./pages/Stats').then((m) => ({ default: m.Stats })));
const OpeningMap = lazy(() => import('./pages/OpeningMap').then((m) => ({ default: m.OpeningMap })));
const Endgames = lazy(() => import('./pages/Endgames').then((m) => ({ default: m.Endgames })));

function Skeleton() {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading">
      <span style={{ height: 36, width: '40%' }} />
      <span style={{ height: 18, width: '70%' }} />
      <span style={{ height: 220 }} />
    </div>
  );
}

/** Counts shown as badges in the nav. */
function useDueCounts() {
  return useLiveQuery(async () => {
    const [cards, puzzles] = await Promise.all([
      liveCards(),
      db.puzzles.where('card.due').belowOrEqual(new Date()).count(),
    ]);
    return { drill: cards.filter((c) => statusOf(c) === 'due').length, puzzles };
  }, []);
}

function Count({ n }: { n?: number }) {
  return n ? <span className="count">{n > 99 ? '99+' : n}</span> : null;
}

function SoundButton() {
  const prefs = usePrefs();
  return (
    <button
      className="iconbtn"
      onClick={() => {
        setPrefs({ sound: !prefs.sound });
        if (!prefs.sound) {
          unlockAudio();
          play('move');
        }
      }}
      aria-label={prefs.sound ? 'Mute sounds' : 'Unmute sounds'}
      title={prefs.sound ? 'Sounds on' : 'Sounds off'}
    >
      {prefs.sound ? <SoundOnIcon /> : <SoundOffIcon />}
    </button>
  );
}

function ThemeButton() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  return (
    <button
      className="iconbtn"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Light mode' : 'Dark mode'}
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function Shell() {
  const onboarded = useLiveQuery(async () => (await db.settings.get('onboarded'))?.value === true, [], null);
  const { pathname } = useLocation();
  const due = useDueCounts();

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);

  // Once you have progress worth keeping, ask the browser not to evict it.
  const hasProgress = useLiveQuery(async () => (await db.cards.count()) + (await db.attempts.count()) > 0, [], false);
  useEffect(() => {
    if (hasProgress) void protectStorage();
  }, [hasProgress]);

  if (onboarded === null) return null;
  if (!onboarded && pathname !== '/welcome') return <Navigate to="/welcome" replace />;

  const links = [
    { to: '/', label: 'Home', icon: <HomeIcon />, end: true },
    { to: '/openings', label: 'Openings', icon: <BookIcon />, count: due?.drill },
    { to: '/puzzles', label: 'Puzzles', icon: <PuzzleIcon />, count: due?.puzzles },
    { to: '/games', label: 'Games', icon: <GamesIcon /> },
    { to: '/play', label: 'Play', icon: <PlayIcon /> },
  ];

  return (
    <ToastProvider>
      <QueueNotifier />
      <a href="#main" className="skip">Skip to content</a>
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="logo">
            <span className="logo-mark" aria-hidden>♞</span>
            {copy.brand}
          </NavLink>
          {onboarded && (
            <nav className="nav" aria-label="Main">
              {links.map((l) => (
                <NavLink key={l.to} to={l.to} end={l.end}>
                  {l.label}
                  <Count n={l.count} />
                </NavLink>
              ))}
              <NavLink to="/endgames">Endgames</NavLink>
              <NavLink to="/stats">Stats</NavLink>
            </nav>
          )}
          <div className="topbar-right">
            <SoundButton />
            <ThemeButton />
            {onboarded && (
              <>
                <NavLink to="/endgames" className="iconbtn mobile-only" aria-label="Endgames" title="Endgames">
                  <span aria-hidden className="glyph">♔</span>
                </NavLink>
                <NavLink to="/stats" className="iconbtn mobile-only" aria-label="Stats" title="Stats">
                  <StatsIcon />
                </NavLink>
              </>
            )}
            {onboarded && (
              <NavLink to="/settings" className="iconbtn" aria-label="Settings" title="Settings">
                <GearIcon />
              </NavLink>
            )}
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1}>
        <ErrorBoundary resetKey={pathname}>
        <Suspense fallback={<Skeleton />}>
          <div className="page" key={pathname}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/welcome" element={<Welcome />} />
              <Route path="/openings" element={<Openings />} />
              <Route path="/openings/:repId" element={<RepertoirePage />} />
              <Route path="/openings/:repId/map" element={<OpeningMap />} />
              <Route path="/learn/:repId/:index" element={<Learn />} />
              <Route path="/drill" element={<DrillPage />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/games" element={<Games />} />
              <Route path="/games/:id" element={<GameReview />} />
              <Route path="/puzzles" element={<Puzzles />} />
              <Route path="/play" element={<Play />} />
              <Route path="/stats" element={<Stats />} />
              <Route path="/endgames" element={<Endgames />} />
              <Route path="*" element={<p className="empty">{copy.notFound}</p>} />
            </Routes>
          </div>
        </Suspense>
        </ErrorBoundary>
      </main>

      {onboarded && (
        <nav className="tabbar" aria-label="Main">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end}>
              {l.icon}
              {l.label}
              <Count n={l.count} />
            </NavLink>
          ))}
        </nav>
      )}
    </ToastProvider>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  );
}
