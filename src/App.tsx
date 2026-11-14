import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, liveCards, statusOf } from './srs/db';
import { copy } from './copy';
import { setTheme, useTheme } from './theme';
import { ToastProvider } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
  BookIcon,
  BrandMark,
  CrownIcon,
  GamesIcon,
  GearIcon,
  MenuIcon,
  MoonIcon,
  PlayIcon,
  PuzzleIcon,
  SoundOffIcon,
  SoundOnIcon,
  SunIcon,
  TodayIcon,
  TrendIcon,
} from './components/icons';
import { EmptyState } from './components/ui';
import { setPrefs, usePrefs } from './prefs';
import { play, unlockAudio } from './sound';
import { protectStorage } from './storage';
import { QueueNotifier } from './components/QueueStatus';
import { useQueue } from './games/queue';
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

// Which nav section a path belongs to, for the tab title. The router ignores
// case and a trailing slash, so these do too. Keep in step with the <Routes> below.
const SECTIONS: [RegExp, string][] = [
  [/^\/$/, copy.nav.today],
  [/^\/welcome\/?$/i, copy.nav.welcome],
  [/^\/(?:openings(?:\/[^/]+(?:\/map)?)?|drill|learn\/[^/]+\/[^/]+)\/?$/i, copy.nav.openings],
  [/^\/puzzles\/?$/i, copy.nav.puzzles],
  [/^\/endgames\/?$/i, copy.nav.endgames],
  [/^\/play\/?$/i, copy.nav.play],
  [/^\/games(?:\/[^/]+)?\/?$/i, copy.nav.games],
  [/^\/(?:stats|progress)\/?$/i, copy.nav.progress],
  [/^\/settings\/?$/i, copy.nav.settings],
];
const titleFor = (pathname: string) => copy.nav.pageTitle(SECTIONS.find(([path]) => path.test(pathname))?.[1] ?? copy.notFoundTitle);

/** Training and review screens: on phones the board gets the tab bar's space (.focus-mode in shell.css). */
const FOCUS_ROUTES = /^\/(?:learn\/[^/]+\/[^/]+|drill|games\/[^/]+|openings\/[^/]+\/map)\/?$/i;

/**
 * Keeps the document in step with the route: the tab title, focus mode, and
 * where the scroll position and keyboard focus land after a navigation.
 *
 * Rendered before the page, and the title is set in a layout effect, so a page
 * that sets its own, more specific document.title in an effect always wins.
 */
function RouteSync({ pathname }: { pathname: string }) {
  const previous = useRef(pathname);

  useLayoutEffect(() => {
    document.title = titleFor(pathname);
    document.documentElement.classList.toggle('focus-mode', FOCUS_ROUTES.test(pathname));
  }, [pathname]);
  useLayoutEffect(() => () => document.documentElement.classList.remove('focus-mode'), []);

  useEffect(() => {
    // The first page of a visit keeps the browser's own focus and scroll position.
    if (previous.current === pathname) return;
    previous.current = pathname;
    window.scrollTo({ top: 0, behavior: 'instant' });
    // Otherwise focus stays on the link that was followed (on phones: the tab
    // bar, after all the content) and a screen reader announces nothing. A new
    // page that has already put focus somewhere inside itself keeps it.
    const main = document.getElementById('main');
    if (main && !main.contains(document.activeElement)) main.focus({ preventScroll: true });
  }, [pathname]);

  return null;
}

function Skeleton() {
  return (
    <div className="skeleton" role="status" aria-busy="true" aria-label={copy.nav.loading}>
      <span style={{ height: 40, width: '38%' }} />
      <span style={{ height: 18, width: '62%' }} />
      <span style={{ height: 240, marginTop: 12 }} />
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

interface NavEntry {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
  count?: number;
  /** What the count counts, in words: "3 lines due". */
  countLabel?: (n: number) => string;
}

/**
 * The link's accessible name. Set explicitly because the icon-only rail hides
 * the label, which would leave the badge ("3") as the whole name.
 */
const navName = (e: NavEntry) => (e.count && e.countLabel ? copy.nav.withCount(e.label, e.countLabel(e.count)) : e.label);

/** The number badge. Decorative: the link's name already says it in words. */
function Count({ n }: { n?: number }) {
  return n ? (
    <span className="count" aria-hidden>
      {n > 99 ? '99+' : n}
    </span>
  ) : null;
}

function Item({ entry, active }: { entry: NavEntry; active?: boolean }) {
  return (
    <NavLink
      to={entry.to}
      end={entry.end}
      className={({ isActive }) => `rail-item${isActive || active ? ' active' : ''}`}
      title={entry.label}
      aria-label={navName(entry)}
    >
      {entry.icon}
      <span className="label">{entry.label}</span>
      <Count n={entry.count} />
    </NavLink>
  );
}

function SoundButton({ withLabel }: { withLabel?: boolean }) {
  const prefs = usePrefs();
  const label = prefs.sound ? copy.nav.soundOff : copy.nav.soundOn;
  return (
    <button
      type="button"
      className={withLabel ? 'rail-item' : 'iconbtn'}
      onClick={() => {
        setPrefs({ sound: !prefs.sound });
        if (!prefs.sound) {
          unlockAudio();
          play('move');
        }
      }}
      aria-label={label}
      title={label}
    >
      {prefs.sound ? <SoundOnIcon /> : <SoundOffIcon />}
      {withLabel && <span className="label">{label}</span>}
    </button>
  );
}

function ThemeButton({ withLabel }: { withLabel?: boolean }) {
  // The shared store: this button and the Settings page can never disagree.
  const { dark } = useTheme();
  const label = dark ? copy.nav.themeLight : copy.nav.themeDark;
  return (
    <button type="button" className={withLabel ? 'rail-item' : 'iconbtn'} onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label={label} title={label}>
      {dark ? <SunIcon /> : <MoonIcon />}
      {withLabel && <span className="label">{label}</span>}
    </button>
  );
}

/** Background analysis progress, visible from every page while it runs. */
function RailQueue() {
  const q = useQueue();
  if (!q.running) return null;
  const pct = Math.round(((q.done + q.progress) / Math.max(1, q.total)) * 100);
  return (
    <Link to="/games" className="rail-queue">
      <strong>{copy.nav.analysing}</strong>
      {/* The status role sits on the text, not the link, so it is still announced as a link. */}
      <span role="status">{copy.nav.analysingCount(Math.min(q.done + 1, q.total), q.total)}</span>
      <div className="progress" aria-hidden><span style={{ width: `${pct}%` }} /></div>
    </Link>
  );
}

function NotFound() {
  return (
    <EmptyState
      center
      icon={<GamesIcon />}
      title={copy.notFoundTitle}
      actions={<Link to="/" className="btn primary">{copy.notFoundCta}</Link>}
    >
      {copy.notFound}
    </EmptyState>
  );
}

function Shell() {
  const onboarded = useLiveQuery(async () => (await db.settings.get('onboarded'))?.value === true, [], null);
  const { pathname } = useLocation();
  const due = useDueCounts();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLElement>(null);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // The More menu is a disclosure: focus moves into it when it opens, Escape
  // closes it and hands focus back to the button that opened it.
  useEffect(() => {
    if (!menuOpen) return;
    menu.current?.querySelector<HTMLElement>('a, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMenuOpen(false);
      menuButton.current?.focus();
    };
    // The menu only exists in the phone layout (shell.css): close it if the window grows out of that.
    const phone = matchMedia('(max-width: 760px)');
    const onResize = () => !phone.matches && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    phone.addEventListener('change', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      phone.removeEventListener('change', onResize);
    };
  }, [menuOpen]);

  // Once you have progress worth keeping, ask the browser not to evict it.
  const hasProgress = useLiveQuery(async () => (await db.cards.count()) + (await db.attempts.count()) > 0, [], false);
  useEffect(() => {
    if (hasProgress) void protectStorage();
  }, [hasProgress]);

  if (onboarded === null) return null;
  if (!onboarded && pathname !== '/welcome') return <Navigate to="/welcome" replace />;
  // Finishing onboarding navigates before this flag has updated, which bounces back here;
  // once it is set there is nothing left to do on the welcome screen.
  if (onboarded && pathname === '/welcome') return <Navigate to="/" replace />;

  const today: NavEntry = { to: '/', label: copy.nav.today, icon: <TodayIcon />, end: true };
  const openings: NavEntry = { to: '/openings', label: copy.nav.openings, icon: <BookIcon />, count: due?.drill, countLabel: copy.nav.linesDue };
  const puzzles: NavEntry = { to: '/puzzles', label: copy.nav.puzzles, icon: <PuzzleIcon />, count: due?.puzzles, countLabel: copy.nav.puzzlesDue };
  const endgames: NavEntry = { to: '/endgames', label: copy.nav.endgames, icon: <CrownIcon /> };
  const playE: NavEntry = { to: '/play', label: copy.nav.play, icon: <PlayIcon /> };
  const games: NavEntry = { to: '/games', label: copy.nav.games, icon: <GamesIcon /> };
  const progress: NavEntry = { to: '/stats', label: copy.nav.progress, icon: <TrendIcon /> };
  const settings: NavEntry = { to: '/settings', label: copy.nav.settings, icon: <GearIcon /> };

  // Drill and Learn belong to Openings, so keep that item lit while training.
  const inOpenings = pathname.startsWith('/drill') || pathname.startsWith('/learn');

  return (
    <ToastProvider>
      <QueueNotifier />
      <RouteSync pathname={pathname} />
      <a href="#main" className="skip">{copy.nav.skip}</a>
      <div className={`app${onboarded ? '' : ' bare'}`}>
        {onboarded && (
          <>
            <aside className="rail">
              <NavLink to="/" className="brand" aria-label={copy.brand}>
                <BrandMark />
                <span>{copy.brand}</span>
              </NavLink>
              <nav aria-label={copy.nav.main} style={{ display: 'contents' }}>
                <Item entry={today} />
                <p className="rail-group">{copy.nav.groupTrain}</p>
                <Item entry={openings} active={inOpenings} />
                <Item entry={puzzles} />
                <Item entry={endgames} />
                <p className="rail-group">{copy.nav.groupPlay}</p>
                <Item entry={playE} />
                <Item entry={games} />
                <Item entry={progress} />
              </nav>
              <div className="rail-spacer" />
              <RailQueue />
              <Item entry={settings} />
              <div className="rail-foot">
                <SoundButton withLabel />
              </div>
            </aside>

            <header className="mbar">
              <NavLink to="/" className="brand" aria-label={copy.brand}>
                <BrandMark />
                <span>{copy.brand}</span>
              </NavLink>
              <button
                ref={menuButton}
                type="button"
                className="iconbtn"
                aria-label={copy.nav.more}
                aria-expanded={menuOpen}
                aria-controls="more-menu"
                onClick={() => setMenuOpen((o) => !o)}
              >
                <MenuIcon />
              </button>
            </header>
            {menuOpen && (
              <>
                <div className="sheet-scrim" onClick={() => setMenuOpen(false)} />
                <nav
                  id="more-menu"
                  ref={menu}
                  className="sheet"
                  aria-label={copy.nav.more}
                  onBlur={(e) => {
                    // Tabbing out of the menu closes it, so focus never sits behind the scrim.
                    const to = e.relatedTarget;
                    if (to && !e.currentTarget.contains(to) && to !== menuButton.current) setMenuOpen(false);
                  }}
                >
                  <Item entry={endgames} />
                  <Item entry={progress} />
                  <Item entry={settings} />
                  <hr />
                  <SoundButton withLabel />
                  <ThemeButton withLabel />
                </nav>
              </>
            )}
          </>
        )}

        <main id="main" className="main" tabIndex={-1}>
          <div className="main-inner">
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
                    <Route path="/progress" element={<Navigate to="/stats" replace />} />
                    <Route path="/endgames" element={<Endgames />} />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </div>
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>

        {onboarded && (
          <nav className="mtabs" aria-label={copy.nav.main}>
            {[today, openings, puzzles, games, playE].map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                aria-label={navName(l)}
                className={({ isActive }) => (isActive || (l === openings && inOpenings) ? 'active' : '')}
              >
                {l.icon}
                {l.label}
                <Count n={l.count} />
              </NavLink>
            ))}
          </nav>
        )}
      </div>
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
