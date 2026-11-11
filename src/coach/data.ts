// Reads what the coach needs from IndexedDB as slim rows, and turns it into
// the profile, trends, motifs and plan. No React here, so it can be tested.
import { State } from 'ts-fsrs';
import { ENDGAMES } from '../endgames/positions';
import { DEFAULT_FOCUS } from '../focus';
import { getLine, repertoires } from '../repertoire';
import { db, getSetting } from '../srs/db';
import { dayKey, streakOf } from '../streak';
import { buildMotifs, type Motifs } from './motifs';
import { buildPlan, type Plan } from './plan';
import { buildProfile, type Profile } from './profile';
import { indexLines, slimAttempt, slimGame, startOfDay, type CoachAttempt, type CoachCard, type CoachGame, type CoachLine } from './slim';
import { buildTrends, type Trends } from './trends';

/**
 * Games are read this many at a time and slimmed straight away, so a full
 * row (PGN, evals, engine lines) lives only until its chunk is done. An
 * analysed game is around 15 kB, so one chunk is a megabyte or two: small
 * enough to deserialise without dropping frames on a phone, and a year of
 * blitz is still only a few dozen round trips. Each read is its own task,
 * so the page stays responsive in between.
 */
export const GAME_CHUNK = 100;

export interface GamesData {
  /** Newest first. */
  games: CoachGame[];
  /** Changes whenever a game is added, analysed, named or marked unreadable or too short. Cheap to compare. */
  key: string;
}

export interface LightData {
  attempts: CoachAttempt[];
  /** Drill cards whose line still exists. */
  cards: CoachCard[];
  /** Every drill review and puzzle attempt, for the streak. */
  trainedAt: Date[];
  reviewsToday: number;
  attemptsToday: number;
  puzzlesDue: number;
  /** Every puzzle in the review queue, due or not. */
  puzzlesTotal: number;
  puzzlesReviewedToday: number;
  sparredToday: boolean;
  endgameToday: boolean;
  endgamesWon: string[];
  focus: string[];
  puzzleRating: number;
}

export interface CoachCounts {
  games: number;
  /** Analysed by the current analysis version. */
  analysed: number;
  /** Readable games with no analysis, or an outdated one. */
  toAnalyse: number;
  linesTotal: number;
  linesStarted: number;
  linesDue: number;
  linesKnown: number;
  puzzlesDue: number;
  /** Every puzzle in the review queue, due or not. */
  puzzlesTotal: number;
  attempts: number;
  solved: number;
  attemptsToday: number;
  puzzleRating: number;
}

export interface CoachResult {
  profile: Profile;
  trends: Trends;
  motifs: Motifs;
  plan: Plan;
  /** Consecutive days with any drill or puzzle, from src/streak.ts. */
  streak: number;
  counts: CoachCounts;
}

/**
 * A failed themed puzzle is saved to the queue and its attempt recorded a few
 * milliseconds later. An attempt this close to the puzzle's creation is that
 * themed try, not a review of it.
 */
const JOINED_QUEUE_MS = 2000;

const MOD = 1e15; // keeps the running sums well inside exact integers

/** A cheap fingerprint of the slim games: a few counters and sums, no hashing of strings. */
export function gamesKey(games: readonly CoachGame[]): string {
  let analysed = 0;
  let stale = 0;
  let unreviewable = 0;
  let named = 0;
  let booked = 0;
  let wins = 0;
  let at = 0;
  let analysedAt = 0;
  for (const g of games) {
    if (g.a) {
      analysed++;
      analysedAt = (analysedAt + g.a.at) % MOD;
    } else if (g.review === 'stale') stale++;
    if (g.unreviewable) unreviewable++;
    if (g.family) named++;
    if (g.book) booked++;
    if (g.result === 'win') wins++;
    at = (at + g.at) % MOD;
  }
  return [games.length, analysed, stale, unreviewable, named, booked, wins, at, analysedAt].join(':');
}

/** Every stored game as a slim row, newest first. Safe inside a Dexie live query. */
export async function readGames(): Promise<GamesData> {
  const games: CoachGame[] = [];
  let last: string | undefined;
  for (;;) {
    const page = await (last === undefined ? db.games.orderBy(':id') : db.games.where(':id').above(last))
      .limit(GAME_CHUNK)
      .toArray();
    for (const row of page) games.push(slimGame(row));
    if (page.length < GAME_CHUNK) break;
    last = page[page.length - 1].id;
  }
  games.sort((a, b) => b.at - a.at);
  return { games, key: gamesKey(games) };
}

/** Everything else the coach reads: small tables and a few settings. Safe inside a Dexie live query. */
export async function readLight(now: Date = new Date()): Promise<LightData> {
  const start = startOfDay(now);
  const today = dayKey(now);
  const [attemptRows, cardRows, reviewRows, puzzlesDue, puzzlesTotal, lastSpar, endgameWins, savedFocus, rating] = await Promise.all([
    db.attempts.toArray(),
    db.cards.toArray(),
    db.reviews.toArray(),
    db.puzzles.where('card.due').belowOrEqual(now).count(),
    db.puzzles.count(),
    getSetting<string>('lastSpar'),
    getSetting<Record<string, string>>('endgameWins'),
    getSetting<string[]>('focus'),
    getSetting<number>('puzzleRating'),
  ]);

  const attempts = attemptRows.map(slimAttempt);
  const todays = attempts.filter((a) => a.at >= start);
  // Which of today's attempts were reviews from the queue, as opposed to themed tries?
  // A queue review reschedules the puzzle, so its card carries the time of the last one.
  // A themed try never touches a card; a failed one only adds the puzzle with a fresh card.
  let puzzlesReviewedToday = 0;
  if (todays.length) {
    const ids = [...new Set(todays.map((a) => a.puzzleId))];
    const queued = new Map<string, { reviewed: number; added: number }>();
    (await db.puzzles.bulkGet(ids)).forEach((p, i) => {
      const reviewed = p?.card?.last_review ? new Date(p.card.last_review).getTime() : 0;
      if (p && reviewed >= start) queued.set(ids[i], { reviewed, added: new Date(p.addedAt).getTime() });
    });
    for (const a of todays) {
      const q = queued.get(a.puzzleId);
      if (!q || a.at > q.reviewed) continue; // not in the queue, or a themed try after the last review
      // Your own mistakes are only ever met in the queue. A themed puzzle joins it at the moment you fail it.
      if (a.source === 'mine' || a.at - q.added > JOINED_QUEUE_MS) puzzlesReviewedToday++;
    }
  }
  const attemptsToday = todays.length;

  const cards: CoachCard[] = [];
  for (const row of cardRows) {
    if (!getLine(row.lineId)) continue; // a PGN edit can orphan old ids
    cards.push({
      lineId: row.lineId,
      repId: row.repertoireId,
      due: new Date(row.card.due).getTime(),
      addedAt: new Date(row.addedAt).getTime(),
      lastReview: row.card.last_review ? new Date(row.card.last_review).getTime() : 0,
      mature: row.card.state === State.Review,
    });
  }

  const trainedAt: Date[] = [];
  let reviewsToday = 0;
  const asDate = (d: Date) => (d instanceof Date ? d : new Date(d)); // a hand-edited backup can carry strings
  for (const r of reviewRows) {
    const at = asDate(r.at);
    trainedAt.push(at);
    if (at.getTime() >= start) reviewsToday++;
  }
  for (const a of attemptRows) trainedAt.push(asDate(a.at));

  const wins = endgameWins && typeof endgameWins === 'object' ? endgameWins : {};
  const focus = (Array.isArray(savedFocus) ? savedFocus : DEFAULT_FOCUS).filter((id) => repertoires.some((r) => r.id === id));

  return {
    attempts,
    cards,
    trainedAt,
    reviewsToday,
    attemptsToday,
    puzzlesDue,
    puzzlesTotal,
    puzzlesReviewedToday,
    sparredToday: lastSpar === today,
    endgameToday: Object.values(wins).includes(today),
    endgamesWon: Object.keys(wins),
    focus,
    puzzleRating: typeof rating === 'number' ? rating : 800,
  };
}

let lineIndex: Map<string, CoachLine> | null = null;
let profileCache: { key: string; value: Profile } | null = null;
let trendsCache: { key: string; value: Trends } | null = null;

/** Forgets the memoised profile and trends (tests, or after a restore). */
export function resetCoachCache(): void {
  profileCache = null;
  trendsCache = null;
}

/**
 * The whole coach from slim data. The profile and trends only change when
 * the games do, so they are memoised on the games key; the motifs and the
 * plan are cheap and are rebuilt every time.
 */
export function computeCoach(g: GamesData, l: LightData, now: Date = new Date()): CoachResult {
  lineIndex ??= indexLines(repertoires);

  // The profile also names the line you keep leaving and whether it is in your drills.
  const profileKey = `${g.key}|${l.cards.length}:${l.cards.reduce((s, card) => (s + card.addedAt) % MOD, 0)}|${l.focus.join(',')}`;
  if (profileCache?.key !== profileKey) {
    profileCache = {
      key: profileKey,
      value: buildProfile({ games: g.games, cards: l.cards, lines: lineIndex, repertoires, focus: l.focus }),
    };
  }
  if (trendsCache?.key !== g.key) trendsCache = { key: g.key, value: buildTrends(g.games) };
  const profile = profileCache.value;
  const trends = trendsCache.value;

  const motifs = buildMotifs(l.attempts, profile);
  const plan = buildPlan({
    now,
    repertoires,
    focus: l.focus,
    cards: l.cards,
    games: g.games,
    reviewsToday: l.reviewsToday,
    puzzlesDue: l.puzzlesDue,
    puzzlesReviewedToday: l.puzzlesReviewedToday,
    attemptsToday: l.attemptsToday,
    sparredToday: l.sparredToday,
    endgameToday: l.endgameToday,
    endgames: ENDGAMES,
    endgamesWon: l.endgamesWon,
    motif: motifs.recommended,
    profile,
  });

  const t = now.getTime();
  let linesDue = 0;
  let linesKnown = 0;
  for (const card of l.cards) {
    if (card.due <= t) linesDue++;
    else if (card.mature) linesKnown++;
  }
  let toAnalyse = 0;
  for (const game of g.games) if (!game.unreviewable && game.review !== 'current') toAnalyse++;

  return {
    profile,
    trends,
    motifs,
    plan,
    streak: streakOf(l.trainedAt),
    counts: {
      games: g.games.length,
      analysed: profile.sample.analysed,
      toAnalyse,
      linesTotal: repertoires.reduce((n, r) => n + r.lines.length, 0),
      linesStarted: l.cards.length,
      linesDue,
      linesKnown,
      puzzlesDue: l.puzzlesDue,
      puzzlesTotal: l.puzzlesTotal,
      attempts: motifs.overall.attempts,
      solved: motifs.overall.solved,
      attemptsToday: l.attemptsToday,
      puzzleRating: l.puzzleRating,
    },
  };
}
