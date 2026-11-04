// Chess.com published-data API (public, CORS-enabled, no key).
// Phase 2 adds game archives; for now we only check that a username exists.

export const USERNAME_RE = /^[A-Za-z0-9_-]{3,25}$/;
const API = 'https://api.chess.com/pub';

/** true / false when Chess.com answers clearly, undefined when it couldn't be reached. */
export async function chessComPlayerExists(username: string): Promise<boolean | undefined> {
  if (!USERNAME_RE.test(username)) return false;
  try {
    const res = await fetch(`${API}/player/${encodeURIComponent(username.toLowerCase())}`, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(6000),
    });
    if (res.status === 404) return false;
    return res.ok ? true : undefined;
  } catch {
    return undefined;
  }
}
