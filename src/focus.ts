// The openings you're working on right now. They lead the Openings page and
// Home, and get the daily spar. Everything else stays one click away.
import { useLiveQuery } from 'dexie-react-hooks';
import { repertoires } from './repertoire';
import { getSetting, setSetting } from './srs/db';

export const DEFAULT_FOCUS = ['white-italian', 'black-caro'];

export function useFocus(): string[] | undefined {
  return useLiveQuery(async () => {
    const saved = await getSetting<string[]>('focus');
    const valid = (saved ?? DEFAULT_FOCUS).filter((id) => repertoires.some((r) => r.id === id));
    return valid;
  }, []);
}

export async function toggleFocus(id: string, current: string[]) {
  const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
  await setSetting('focus', next);
}
