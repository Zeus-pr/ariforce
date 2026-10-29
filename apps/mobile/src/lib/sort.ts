/** A-Z by name, case- and accent-insensitive (pickers sort on the client; the API will too). */
export const byName = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: 'base' });

export const sortByLabel = <T extends { label: string }>(xs: readonly T[]) =>
  [...xs].sort((a, b) => byName(a.label, b.label));
