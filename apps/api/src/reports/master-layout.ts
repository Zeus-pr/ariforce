/** One month's master workbook. People are posted to a headquarters. Territories are the patches under it. */

export type Figures = {
  workingDays: number | null;
  present: number | null;
  absent: number | null;
  holiday: number | null;
  cl: number | null;
  sl: number | null;
  el: number | null;
  lop: number | null;
  otherLeave: number | null;
  fieldDays: number | null;
  campDays: number | null;
  meetingDays: number | null;
  trainingDays: number | null;
  otherDays: number | null;
  uniqueDoctors: number | null;
  doctorVisits: number | null;
  callAverage: number | null;
  coverage: number | null;
  missed: number | null;
  uniqueChemists: number | null;
  chemistVisits: number | null;
  chemistAverage: number | null;
  msl: number | null;
  primaryTarget: number | null;
  primarySales: number | null;
  primaryAchievement: number | null;
  secondaryTarget: number | null;
  secondarySales: number | null;
  secondaryAchievement: number | null;
  pob: number | null;
  growth: number | null;
  dcrCompliance: number | null;
  dcrOnTime: number | null;
  tpAdherence: number | null;
};

export type PersonLine = {
  name: string;
  code: string;
  role: string;
  manager: string;
  figures: Figures;
  /** Submitted DCR days and on-time days, so a total can rebuild the percents. */
  submittedDays: number;
  onTimeDays: number;
  /** Must-see doctors actually met. Coverage uses this, not every doctor called on. */
  mslSeen: number;
};

export type PatchLine = {
  name: string;
  figures: Figures;
};

export type HqSheet = {
  name: string;
  people: PersonLine[];
  patches: PatchLine[];
  total: Figures;
};

export type MasterFile = {
  company: string;
  preparedFor: string;
  monthLabel: string;
  monthKey: string;
  generatedAt: string;
  sheets: HqSheet[];
};

export const FIGURE_KEYS = [
  'workingDays',
  'present',
  'absent',
  'holiday',
  'cl',
  'sl',
  'el',
  'lop',
  'otherLeave',
  'fieldDays',
  'campDays',
  'meetingDays',
  'trainingDays',
  'otherDays',
  'uniqueDoctors',
  'doctorVisits',
  'callAverage',
  'coverage',
  'missed',
  'uniqueChemists',
  'chemistVisits',
  'chemistAverage',
  'msl',
  'primaryTarget',
  'primarySales',
  'primaryAchievement',
  'secondaryTarget',
  'secondarySales',
  'secondaryAchievement',
  'pob',
  'growth',
  'dcrCompliance',
  'dcrOnTime',
  'tpAdherence',
] as const satisfies readonly (keyof Figures)[];

export function blankFigures(): Figures {
  return Object.fromEntries(FIGURE_KEYS.map((k) => [k, null])) as Figures;
}

const pct = (n: number, d: number) => (d ? Math.round((1000 * n) / d) / 10 : null);
const ratio = (n: number, d: number) => (d ? Math.round((100 * n) / d) / 100 : null);

/** Add the people on one headquarters. Sales stay blank: the place total is applied once. */
export function sumPeople(rows: PersonLine[]): Figures {
  const out = blankFigures();
  const add = (k: keyof Figures) => {
    let n = 0;
    let any = false;
    for (const row of rows) {
      const v = row.figures[k];
      if (v == null) continue;
      any = true;
      n += v;
    }
    out[k] = any ? Math.round(n * 100) / 100 : null;
  };
  for (const k of FIGURE_KEYS) add(k);
  const field = out.fieldDays ?? 0;
  out.callAverage = ratio(out.doctorVisits ?? 0, field);
  out.chemistAverage = ratio(out.chemistVisits ?? 0, field);
  const knownMsl = rows.filter((r) => r.figures.msl != null);
  const msl = knownMsl.reduce((n, r) => n + (r.figures.msl ?? 0), 0);
  const seen = knownMsl.reduce((n, r) => n + r.mslSeen, 0);
  out.msl = knownMsl.length ? msl : null;
  out.coverage = knownMsl.length ? pct(seen, msl) : null;
  out.missed = knownMsl.length && msl ? pct(Math.max(0, msl - seen), msl) : null;
  const submitted = rows.reduce((n, r) => n + r.submittedDays, 0);
  const onTime = rows.reduce((n, r) => n + r.onTimeDays, 0);
  out.dcrCompliance = pct(submitted, out.workingDays ?? 0);
  out.dcrOnTime = pct(onTime, submitted);
  out.primaryAchievement = null;
  out.secondaryAchievement = null;
  out.growth = null;
  out.primaryTarget = null;
  out.primarySales = null;
  out.secondaryTarget = null;
  out.secondarySales = null;
  return out;
}

export function applySales(
  base: Figures,
  sales: {
    primaryTarget: number | null;
    primarySales: number;
    primaryLy: number | null;
    secondaryTarget: number | null;
    secondarySales: number;
  },
): Figures {
  const growth =
    sales.primaryLy != null && sales.primaryLy !== 0
      ? pct(sales.primarySales - sales.primaryLy, sales.primaryLy)
      : null;
  return {
    ...base,
    primaryTarget: sales.primaryTarget,
    primarySales: sales.primarySales,
    primaryAchievement: pct(sales.primarySales, sales.primaryTarget ?? 0),
    secondaryTarget: sales.secondaryTarget,
    secondarySales: sales.secondarySales,
    secondaryAchievement: pct(sales.secondarySales, sales.secondaryTarget ?? 0),
    growth,
  };
}

export type Place = {
  id: string;
  name: string;
  path: string;
  level: string;
  parentId: string | null;
};

/** Headquarters the viewer can see, by name. */
export function headquartersOf(places: Place[]): Place[] {
  return places
    .filter((p) => p.level === 'headquarter')
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Territory patches directly under a headquarters. */
export function patchesOf(places: Place[], hq: Place): Place[] {
  return places
    .filter((p) => p.level === 'territory' && p.parentId === hq.id)
    .sort((a, b) => a.name.localeCompare(b.name));
}

const ILLEGAL = /[\\/*?:[\]]/g;

/** Excel sheet tab: 31 characters, unique, no characters Excel refuses. */
export function sheetTab(name: string, used: Set<string>): string {
  const clean = name.replace(ILLEGAL, ' ').replace(/\s+/g, ' ').trim() || 'Headquarters';
  let base = clean.slice(0, 31);
  let n = 2;
  while (used.has(base.toLowerCase())) {
    const suffix = ` ${n}`;
    base = `${clean.slice(0, 31 - suffix.length).trimEnd()}${suffix}`;
    n += 1;
  }
  used.add(base.toLowerCase());
  return base;
}
