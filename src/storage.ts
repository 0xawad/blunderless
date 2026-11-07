// Everything lives in IndexedDB, which browsers may clear on their own:
// Safari after about a week without a visit (unless installed), Chrome and
// Firefox under disk pressure. Asking for persistent storage stops that, and
// a backup reminder covers the browsers that say no.
import { db, getSetting, setSetting } from './srs/db';

export async function isPersisted(): Promise<boolean | undefined> {
  try {
    return navigator.storage?.persisted ? await navigator.storage.persisted() : undefined;
  } catch {
    return undefined;
  }
}

/** Asks once there's progress worth keeping. Chrome decides silently; Firefox may show a prompt. */
export async function protectStorage(): Promise<boolean | undefined> {
  if ((await isPersisted()) !== false) return isPersisted();
  try {
    return await navigator.storage.persist();
  } catch {
    return undefined;
  }
}

const DAY = 86_400_000;
const REMIND_AFTER = 14 * DAY;
const SNOOZE = 7 * DAY;

/** Should Home nudge you to export a backup? Only when there's real progress at risk. */
export async function backupDue(now = Date.now()): Promise<boolean> {
  const [cards, reviews, last, snoozed] = await Promise.all([
    db.cards.count(),
    db.reviews.count(),
    getSetting<string>('lastBackup'),
    getSetting<string>('backupSnooze'),
  ]);
  if (cards < 5 || reviews < 10) return false;
  if (snoozed && now - Date.parse(snoozed) < SNOOZE) return false;
  if (last && now - Date.parse(last) < REMIND_AFTER) return false;
  return (await isPersisted()) !== true || !last;
}

export const markBackedUp = () => setSetting('lastBackup', new Date().toISOString());
export const snoozeBackup = () => setSetting('backupSnooze', new Date().toISOString());

/** Saves a blob as a file download. */
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
