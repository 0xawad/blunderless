/** Local calendar day, e.g. "2026-10-8" (month is 0-based; only compared, never shown). */
export const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Consecutive days (ending today, or yesterday if today has nothing yet) with any training. */
export function streakOf(dates: Date[]): number {
  const days = new Set(dates.map(dayKey));
  const d = new Date();
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(dayKey(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}
