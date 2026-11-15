/** One SFC route as the spreadsheet and the on-screen table share it. */
export type SfcSheetRoute = {
  fromPlace: string;
  toPlace: string;
  distanceKm: number | null;
  actualFare: boolean;
  travelMode: string;
  category: string;
  da: number | null;
};

export const SFC_SHEET_HEADERS = [
  'From place',
  'To place',
  'Distance one way (km)',
  'Actual fare',
  'Travel mode',
  'Category',
  'DA',
] as const;

const HEADER_KEY: Record<string, keyof SfcSheetRoute | 'skip'> = {
  fromplace: 'fromPlace',
  from: 'fromPlace',
  toplace: 'toPlace',
  to: 'toPlace',
  distanceonewaykm: 'distanceKm',
  distanceoneway: 'distanceKm',
  onewaykm: 'distanceKm',
  km: 'distanceKm',
  actualfare: 'actualFare',
  travelmode: 'travelMode',
  mode: 'travelMode',
  category: 'category',
  da: 'da',
};

const normHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, '');

function cell(row: string[], index: number | undefined): string {
  if (index == null || index < 0) return '';
  return (row[index] ?? '').trim();
}

function kmOf(raw: string): number | null | 'bad' {
  const t = raw.trim().replace(/km$/i, '').trim();
  if (!t) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return 'bad';
  const n = Number(t);
  return n >= 0 ? n : 'bad';
}

function daOf(raw: string): number | null | 'bad' {
  const t = raw.trim().replace(/,/g, '');
  if (!t) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return 'bad';
  return Number(t);
}

function yes(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  return t === 'yes' || t === 'y' || t === 'true' || t === 'actual fare' || t === 'actual';
}

/** Rows for the spreadsheet. Amounts are left out; the server fills those on save. */
export function sfcRoutesToSheet(routes: SfcSheetRoute[]): (string | number | null)[][] {
  return routes.map((r) => [
    r.fromPlace,
    r.toPlace,
    r.distanceKm,
    r.actualFare ? 'Yes' : 'No',
    r.travelMode,
    r.category,
    r.da,
  ]);
}

/**
 * Read a sheet. The header row is the first row that has From place and To place,
 * so a title line above the columns is ignored. Blank rows are skipped.
 * A row that is missing a place, or has a distance or DA that is not a number, is reported
 * and nothing is returned.
 */
export function sfcSheetToRoutes(grid: string[][]): {
  routes: SfcSheetRoute[];
  error: string | null;
} {
  const headerAt = grid.findIndex((row) => {
    const keys = row.map(normHeader);
    return keys.includes('fromplace') && keys.includes('toplace');
  });
  if (headerAt < 0) {
    return { routes: [], error: 'The file needs From place and To place columns.' };
  }
  const headers = grid[headerAt] ?? [];
  const body = grid.slice(headerAt + 1);
  const col: Partial<Record<keyof SfcSheetRoute, number>> = {};
  headers.forEach((h, i) => {
    const key = HEADER_KEY[normHeader(h)];
    if (key && key !== 'skip' && col[key] == null) col[key] = i;
  });
  if (col.fromPlace == null || col.toPlace == null)
    return {
      routes: [],
      error: 'The file needs From place and To place columns.',
    };
  const routes: SfcSheetRoute[] = [];
  let seen = 0;
  for (const row of body) {
    if (!row.some((c) => c.trim())) continue;
    seen += 1;
    const fromPlace = cell(row, col.fromPlace).toUpperCase();
    const toPlace = cell(row, col.toPlace).toUpperCase();
    const km = kmOf(cell(row, col.distanceKm));
    const da = daOf(cell(row, col.da));
    if (!fromPlace || !toPlace) {
      return { routes: [], error: `Row ${seen}: fill in both From place and To place.` };
    }
    if (km === 'bad') {
      return { routes: [], error: `Row ${seen}: distance must be a number, 0 or more.` };
    }
    if (da === 'bad') {
      return { routes: [], error: `Row ${seen}: DA must be a number, or blank.` };
    }
    routes.push({
      fromPlace,
      toPlace,
      distanceKm: km,
      actualFare: yes(cell(row, col.actualFare)),
      travelMode: cell(row, col.travelMode).toUpperCase(),
      category: cell(row, col.category).toUpperCase(),
      da,
    });
  }
  if (!routes.length) return { routes: [], error: 'The file has no routes.' };
  return { routes, error: null };
}
