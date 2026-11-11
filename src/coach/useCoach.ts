// The coach as a React hook. Reads IndexedDB through live queries that keep
// only slim rows, computes after paint, and remembers the last result so a
// page that mounts later shows it at once.
import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { dayKey } from '../streak';
import { computeCoach, readGames, readLight, type CoachCounts, type CoachResult } from './data';
import type { Motifs } from './motifs';
import type { Plan } from './plan';
import type { Profile } from './profile';
import type { Trends } from './trends';

export interface CoachState {
  /** True until the first result is in. The other fields are null (or zero) while it is. */
  loading: boolean;
  profile: Profile | null;
  trends: Trends | null;
  motifs: Motifs | null;
  plan: Plan | null;
  streak: number;
  counts: CoachCounts;
}

const EMPTY: CoachState = {
  loading: true,
  profile: null,
  trends: null,
  motifs: null,
  plan: null,
  streak: 0,
  counts: {
    games: 0,
    analysed: 0,
    toAnalyse: 0,
    linesTotal: 0,
    linesStarted: 0,
    linesDue: 0,
    linesKnown: 0,
    puzzlesDue: 0,
    puzzlesTotal: 0,
    attempts: 0,
    solved: 0,
    attemptsToday: 0,
    puzzleRating: 800,
  },
};

/** The last result, shared by every mount. Tagged with its day: "done today" must not survive midnight. */
let last: { day: string; state: CoachState } | null = null;

/** Today's local day key. Re-checked every minute and when the tab comes back, so an app left open rolls over. */
function useDay(): string {
  const [day, setDay] = useState(() => dayKey(new Date()));
  useEffect(() => {
    const check = () => setDay(dayKey(new Date())); // same string: no re-render
    const id = window.setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  return day;
}

/**
 * Everything the coach knows. Call it once per page and pass the parts down:
 * each call runs its own live queries.
 *
 * Two queries, so recording a puzzle or a drill never re-reads the games:
 * the games (heavy, chunked and slimmed inside the query) and the small
 * tables plus settings. The work itself runs in a timeout after paint and is
 * memoised on a cheap key of the games.
 */
export function useCoach(): CoachState {
  const day = useDay();
  const games = useLiveQuery(readGames, []);
  const light = useLiveQuery(() => readLight(new Date()), [day]);
  const [state, setState] = useState<CoachState>(() => (last?.day === day ? last.state : EMPTY));

  useEffect(() => {
    if (!games || !light) return;
    let alive = true;
    const id = window.setTimeout(() => {
      const result: CoachResult = computeCoach(games, light, new Date());
      const next: CoachState = { loading: false, ...result };
      last = { day, state: next };
      if (alive) setState(next);
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [games, light, day]);

  return state;
}

/** Today's plan with the streak and counts. For the Today page. */
export function usePlan(): Pick<CoachState, 'loading' | 'plan' | 'streak' | 'counts'> {
  const { loading, plan, streak, counts } = useCoach();
  return { loading, plan, streak, counts };
}

/** The weakness profile and trends. For the Progress page. */
export function useProfile(): Pick<CoachState, 'loading' | 'profile' | 'trends' | 'counts'> {
  const { loading, profile, trends, counts } = useCoach();
  return { loading, profile, trends, counts };
}

/** Puzzle performance per theme and the recommended theme. For the Puzzles page. */
export function useMotifs(): Pick<CoachState, 'loading' | 'motifs'> {
  const { loading, motifs } = useCoach();
  return { loading, motifs };
}
