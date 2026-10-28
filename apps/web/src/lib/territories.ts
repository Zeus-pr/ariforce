/**
 * Territory levels in pickers (migration 0042, docs/TERRITORY-MODEL.md). A level 'territory' row is a
 * city/market under an HQ: it groups doctors and chemists, is never assigned to people, and does not
 * turn its HQ into a "parent" that drops out of work pickers.
 */
type Row = { id: string; parentId: string | null; level: string; name: string };

/** People/assignment pickers: every level except 'territory'. */
export const peopleTerritories = <T extends Row>(rows: T[]): T[] => rows.filter((t) => t.level !== 'territory');

/**
 * Where a rep can work: leaf rows of the people hierarchy (usually HQs; a 'territory' child does not
 * make its HQ a branch) plus the 'territory' rows under them.
 */
export function workTerritories<T extends Row>(rows: T[]): T[] {
  const hasBranchChild = new Set(rows.filter((c) => c.level !== 'territory' && c.parentId).map((c) => c.parentId!));
  return rows.filter((t) => t.level === 'territory' || !hasBranchChild.has(t.id));
}

/** "Arambagh · Durgapur HQ" for a 'territory' row, the plain name otherwise. */
export function territoryLabel<T extends Row>(t: T, byId: Map<string, string>): string {
  if (t.level !== 'territory' || !t.parentId) return t.name;
  const hq = byId.get(t.parentId);
  return hq ? `${t.name} · ${hq}` : t.name;
}

/** Sort for selects: each HQ followed by its 'territory' rows, then by name. */
export function sortForPicker<T extends Row>(rows: T[]): T[] {
  const key = (t: T) => {
    const hq = t.level === 'territory' && t.parentId ? rows.find((r) => r.id === t.parentId)?.name ?? '' : t.name;
    return `${hq}\u0000${t.level === 'territory' ? '1' : '0'}${t.name}`;
  };
  return [...rows].sort((a, b) => key(a).localeCompare(key(b)));
}
