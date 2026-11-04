import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './srs/db';
import { copy } from './copy';
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

function Shell() {
  const onboarded = useLiveQuery(async () => (await db.settings.get('onboarded'))?.value === true, [], null);
  const { pathname } = useLocation();

  if (onboarded === null) return null;
  if (!onboarded && pathname !== '/welcome') return <Navigate to="/welcome" replace />;

  return (
    <>
      <header className="topbar">
        <NavLink to="/" className="logo">
          <span aria-hidden>♞</span> {copy.brand}
        </NavLink>
        {onboarded && (
          <nav>
            <NavLink to="/" end>Home</NavLink>
            <NavLink to="/openings">Openings</NavLink>
            <NavLink to="/drill">Drill</NavLink>
            <NavLink to="/puzzles">Puzzles</NavLink>
            <NavLink to="/games">Games</NavLink>
            <NavLink to="/play">Play</NavLink>
            <NavLink to="/stats">Stats</NavLink>
            <NavLink to="/settings" aria-label="Settings">⚙</NavLink>
          </nav>
        )}
      </header>
      <main>
        <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/openings" element={<Openings />} />
          <Route path="/openings/:repId" element={<RepertoirePage />} />
          <Route path="/learn/:repId/:index" element={<Learn />} />
          <Route path="/drill" element={<DrillPage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/games" element={<Games />} />
          <Route path="/games/:id" element={<GameReview />} />
          <Route path="/puzzles" element={<Puzzles />} />
          <Route path="/play" element={<Play />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="*" element={<p className="empty">{copy.notFound}</p>} />
        </Routes>
        </Suspense>
      </main>
    </>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  );
}
