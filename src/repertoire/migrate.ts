// A line's id is its repertoire plus every move in it ("white-italian:e4 e5 Nf3 ..."),
// so editing a line in a PGN gives it a new id and its drill card is orphaned. This
// works out which orphaned ids can be carried over to a line that still exists.

/** A match needs at least this many plies in common, so a stub cannot claim an unrelated line. */
export const MIN_SHARED_PLIES = 4;

const split = (id: string) => {
  const i = id.indexOf(':');
  return i < 0 ? null : { rep: id.slice(0, i), moves: id.slice(i + 1) };
};

/**
 * Maps orphaned line ids to live ones. An orphan moves only when exactly one
 * live line in the same repertoire continues it (the line was extended) or is a
 * leading part of it (the line was shortened), that line has no card of its own,
 * and no other orphan wants it. Anything ambiguous is left alone: progress is
 * never guessed at and never deleted.
 */
export function rekeyOrphans(cardIds: readonly string[], liveIds: readonly string[]): Map<string, string> {
  const live = new Set(liveIds);
  const taken = new Set(cardIds.filter((id) => live.has(id)));
  const byRep = new Map<string, string[]>();
  for (const id of liveIds) {
    const s = split(id);
    if (!s) continue;
    const list = byRep.get(s.rep) ?? [];
    list.push(s.moves);
    byRep.set(s.rep, list);
  }

  const wanted = new Map<string, string[]>(); // target -> orphans that want it
  for (const id of cardIds) {
    if (live.has(id)) continue;
    const s = split(id);
    if (!s || s.moves.split(' ').length < MIN_SHARED_PLIES) continue;
    const candidates = (byRep.get(s.rep) ?? []).filter((m) => {
      const extended = m.startsWith(s.moves + ' ');
      const shortened = s.moves.startsWith(m + ' ') && m.split(' ').length >= MIN_SHARED_PLIES;
      return extended || shortened;
    });
    if (candidates.length !== 1) continue;
    const target = `${s.rep}:${candidates[0]}`;
    if (taken.has(target)) continue;
    wanted.set(target, [...(wanted.get(target) ?? []), id]);
  }

  const out = new Map<string, string>();
  for (const [target, orphans] of wanted) if (orphans.length === 1) out.set(orphans[0], target);
  return out;
}
