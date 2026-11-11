/** Levels a person can be assigned. The patch under an HQ (`territory`) is a link on the
 * doctor, not a headquarters, so it does not belong in the Doctors/Chemists/Stockists filter. */
const HIDDEN_LEVEL = 'territory';

const LEVEL_WORD: Record<string, string> = {
  national: 'national',
  zone: 'zone',
  region: 'region',
  area: 'area',
  headquarter: 'HQ',
};

export type TerritoryOptionRow = {
  id: string;
  name: string;
  level: string;
  parentId?: string | null;
};

/**
 * Filter menu for master lists. Keeps each territory id. Hides patches under an HQ.
 * When two visible rows share a name, the label adds the level and the parent so they
 * are not identical lines.
 */
export function masterTerritoryFilterOptions(rows: TerritoryOptionRow[]): {
  value: string;
  label: string;
}[] {
  const nameOf = new Map(rows.map((r) => [r.id, r.name]));
  const visible = rows.filter((r) => r.level !== HIDDEN_LEVEL);
  const counts = new Map<string, number>();
  for (const r of visible) {
    const key = r.name.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...visible]
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, 'en') ||
        a.level.localeCompare(b.level) ||
        a.id.localeCompare(b.id),
    )
    .map((r) => {
      const shared = (counts.get(r.name.trim().toLowerCase()) ?? 0) > 1;
      if (!shared) return { value: r.id, label: r.name };
      const parent = r.parentId ? nameOf.get(r.parentId) : undefined;
      const extra = [LEVEL_WORD[r.level] ?? r.level, parent].filter(Boolean).join(', ');
      return { value: r.id, label: extra ? `${r.name} · ${extra}` : r.name };
    });
}
