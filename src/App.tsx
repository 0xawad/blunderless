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
            <NavLink to="/settings">Settings</NavLink>
          </nav>
        )}
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/openings" element={<Openings />} />
          <Route path="/openings/:repId" element={<RepertoirePage />} />
          <Route path="/learn/:repId/:index" element={<Learn />} />
          <Route path="/drill" element={<DrillPage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<p className="empty">{copy.notFound}</p>} />
        </Routes>
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
