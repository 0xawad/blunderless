// Chess.com published-data API (public, CORS-enabled, no key).
// https://www.chess.com/news/view/published-data-api
import type { GameRow } from './srs/types';

export const USERNAME_RE = /^[A-Za-z0-9_-]{3,25}$/;
const API = 'https://api.chess.com/pub';
const ARCHIVE_RE = /^https:\/\/api\.chess\.com\/pub\/player\/[a-z0-9_-]{3,25}\/games\/\d{4}\/\d{2}$/;
const MAX_PGN = 100_000;
const DRAWS = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']);

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) throw new Error('not-found');
  if (!res.ok) throw new Error(`chess.com ${res.status}`);
  return res.json();
}

/** true / false when Chess.com answers clearly, undefined when it couldn't be reached. */
export async function chessComPlayerExists(username: string): Promise<boolean | undefined> {
  if (!USERNAME_RE.test(username)) return false;
  try {
    await getJson(`${API}/player/${encodeURIComponent(username.toLowerCase())}`);
    return true;
  } catch (e) {
    return (e as Error).message === 'not-found' ? false : undefined;
  }
}

interface ApiPlayer {
  username?: unknown;
  rating?: unknown;
  result?: unknown;
}

const str = (v: unknown, max = 200) => (typeof v === 'string' && v.length <= max ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Validates one archive entry and maps it to a GameRow (or null to skip). */
export function toGameRow(raw: unknown, username: string): GameRow | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const g = raw as Record<string, unknown>;
  const pgn = str(g.pgn, MAX_PGN);
  const id = str(g.uuid, 64) ?? str(g.url, 300);
  const white = g.white as ApiPlayer | undefined;
  const black = g.black as ApiPlayer | undefined;
  if (!pgn || !id || g.rules !== 'chess' || !white || !black) return null;

  const wName = str(white.username, 40) ?? '?';
  const bName = str(black.username, 40) ?? '?';
  const me = username.toLowerCase();
  const userColor = wName.toLowerCase() === me ? 'white' : bName.toLowerCase() === me ? 'black' : null;
  if (!userColor) return null;

  const mine = userColor === 'white' ? white : black;
  const code = str(mine.result, 40) ?? '';
  const result = code === 'win' ? 'win' : DRAWS.has(code) ? 'draw' : 'loss';
  const url = str(g.url, 300);

  return {
    id,
    source: 'chesscom',
    url: url?.startsWith('https://www.chess.com/') ? url : undefined,
    pgn,
    white: wName,
    black: bName,
    whiteElo: num(white.rating),
    blackElo: num(black.rating),
    userColor,
    result,
    timeClass: str(g.time_class, 20) ?? 'unknown',
    endTime: new Date((num(g.end_time) ?? 0) * 1000),
  };
}

/**
 * The most recent `months` monthly archives, newest first, fetched one at a time.
 * With `since`, only archives from that month on are fetched (incremental import).
 */
export async function fetchRecentGames(username: string, months = 3, since?: Date): Promise<GameRow[]> {
  if (!USERNAME_RE.test(username)) throw new Error('bad username');
  const u = encodeURIComponent(username.toLowerCase());
  const data = (await getJson(`${API}/player/${u}/games/archives`)) as { archives?: unknown };
  const archives = Array.isArray(data.archives)
    ? data.archives.filter((a): a is string => typeof a === 'string' && ARCHIVE_RE.test(a))
    : [];

  const rows: GameRow[] = [];
  const sinceKey = since ? since.getUTCFullYear() * 100 + since.getUTCMonth() + 1 : 0;
  const keyOf = (url: string) => {
    const [y, m] = url.split('/').slice(-2).map(Number);
    return y * 100 + m;
  };
  for (const url of archives.slice(-months).filter((a) => keyOf(a) >= sinceKey).reverse()) {
    const month = (await getJson(url)) as { games?: unknown };
    if (!Array.isArray(month.games)) continue;
    for (const g of month.games) {
      const row = toGameRow(g, username);
      if (row) rows.push(row);
    }
  }
  return rows;
}
