/**
 * Month-grid helpers for the DCR workspace (status buckets + day pills).
 * Used by the web calendar that follows tour-plans / leave grid patterns.
 */
import type { Dcr } from '@ariforce/contracts';
import { BANDS } from '@/lib/dcr/model';

export type CalendarPillStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'tp' | 'locked';

export type DayPill = {
  date: string;
  label: string;
  status: CalendarPillStatus;
  itemId: string;
};

export type DcrBucket = 'draft' | 'pending' | 'locked' | 'approved' | 'rejected';

type DcrWithReview = Dcr & {
  reviewStatus?: 'pending' | 'approved' | 'rejected' | null;
};

/** Approved tour-plan day still waiting to be filed as a DCR. */
export type TpDraftCard = {
  id: string;
  from: string;
  to: string;
  pendingDates: string[];
  draftDates?: string[];
  label: string;
};

export function shortLabel(raw: string, max = 16): string {
  const t = raw.trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > 6 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

function summaryOf(d: Dcr, workType: string | undefined, placeName: Map<string, string>) {
  const band = BANDS.find((b) => b.band === d.band);
  const places = d.territoryIds.map((id) => placeName.get(id)).filter(Boolean) as string[];
  const territory = places.length
    ? places.join(', ')
    : d.territoryIds.length
      ? `${d.territoryIds.length} ${d.territoryIds.length === 1 ? 'territory' : 'territories'}`
      : null;
  const what =
    workType ??
    (band
      ? 'Field work'
      : d.details?.kind
        ? d.details.kind[0]!.toUpperCase() + d.details.kind.slice(1)
        : 'Report');
  const n = d.callCount ?? d.calls.length;
  const calls = n ? `${n} call${n === 1 ? '' : 's'}` : null;
  return [what, band ? band.label : null, territory, band || n ? calls : null]
    .filter(Boolean)
    .join(' · ');
}

/** Sunday-start month grid of YYYY-MM-DD (null = padding). */
export function monthGrid(year: number, monthIndex: number): (string | null)[] {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const startPad = first.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(new Date(Date.UTC(year, monthIndex, d)).toISOString().slice(0, 10));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function monthRange(year: number, monthIndex: number) {
  const from = `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const to = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  return { from, to };
}

export function cursorFromYmd(ymd: string) {
  const [y, m] = ymd.split('-').map(Number);
  return { year: y!, monthIndex: m! - 1 };
}

/** Map the DCR status and its manager review status into a calendar / list bucket. */
export function dcrBucket(d: Dcr): DcrBucket | null {
  const reviewStatus = (d as DcrWithReview).reviewStatus;
  if (reviewStatus === 'approved' || reviewStatus === 'rejected') return reviewStatus;
  if (d.status === 'draft') return 'draft';
  if (d.status === 'submitted') return 'pending';
  if (d.status === 'locked') return 'locked';
  return null;
}

function pillStatus(bucket: ReturnType<typeof dcrBucket>): CalendarPillStatus | null {
  if (!bucket) return null;
  if (bucket === 'locked') return 'locked';
  return bucket;
}

/** Prefer real doctor/chemist/stockist names; else territory / work type. */
export function dcrOutletLabels(
  d: Dcr,
  names: {
    territory: Map<string, string>;
    workType: (id: string) => string | undefined;
    outlet?: Map<string, string>;
  },
): string[] {
  const outlets =
    d.calls?.map((c) => names.outlet?.get(c.outletId)?.trim()).filter((n): n is string => !!n) ??
    [];
  if (outlets.length) return outlets;

  const terr = d.territoryIds.map((id) => names.territory.get(id)).filter((n): n is string => !!n);
  if (terr.length) return terr;

  const wt = names.workType(d.workTypeId);
  if (wt) return [wt];
  const n = d.callCount ?? d.calls?.length ?? 0;
  return n ? [`${n} call${n === 1 ? '' : 's'}`] : ['DCR'];
}

export function dcrPillLabel(
  d: Dcr,
  wtName: (id: string) => string | undefined,
  placeName: Map<string, string>,
  outletName?: Map<string, string>,
): string {
  return shortLabel(
    dcrOutletLabels(d, { territory: placeName, workType: wtName, outlet: outletName })
      .slice(0, 2)
      .join(', '),
    18,
  );
}

export function dcrListLabel(
  d: Dcr,
  wtName: (id: string) => string | undefined,
  placeName: Map<string, string>,
): string {
  return summaryOf(d, wtName(d.workTypeId), placeName);
}

/**
 * One pill per outlet name (stacked in the day cell) + TP-to-file when the day is otherwise empty.
 */
export function dcrPillsByDate(
  items: Dcr[],
  tpCards: TpDraftCard[],
  wtName: (id: string) => string | undefined,
  placeName: Map<string, string>,
  outletName?: Map<string, string>,
): Map<string, DayPill[]> {
  const map = new Map<string, DayPill[]>();

  for (const d of items) {
    const bucket = dcrBucket(d);
    const status = pillStatus(bucket);
    if (!status) continue;
    const list = map.get(d.date) ?? [];
    const outlets = dcrOutletLabels(d, {
      territory: placeName,
      workType: wtName,
      outlet: outletName,
    });
    if (outlets.length > 1 || (d.calls?.length ?? 0) > 1) {
      outlets.forEach((name, i) => {
        list.push({
          date: d.date,
          label: name,
          status,
          itemId: `${d.id}:${i}`,
        });
      });
    } else {
      list.push({
        date: d.date,
        label: outlets[0] ?? dcrPillLabel(d, wtName, placeName, outletName),
        status,
        itemId: d.id,
      });
    }
    map.set(d.date, list);
  }

  for (const t of tpCards) {
    for (const date of t.pendingDates) {
      const existing = map.get(date) ?? [];
      if (existing.some((p) => p.status !== 'tp')) continue;
      existing.push({
        date,
        label: shortLabel(t.label || 'Tour plan', 14),
        status: 'tp',
        itemId: `tp:${t.id}`,
      });
      map.set(date, existing);
    }
  }

  return map;
}

export function groupDcrs(items: Dcr[]) {
  const drafts: Dcr[] = [];
  const pending: Dcr[] = [];
  const locked: Dcr[] = [];
  const approved: Dcr[] = [];
  const rejected: Dcr[] = [];
  for (const d of items) {
    const b = dcrBucket(d);
    if (b === 'draft') drafts.push(d);
    else if (b === 'pending') pending.push(d);
    else if (b === 'locked') locked.push(d);
    else if (b === 'approved') approved.push(d);
    else if (b === 'rejected') rejected.push(d);
  }
  const byDateDesc = (a: Dcr, b: Dcr) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  drafts.sort(byDateDesc);
  pending.sort(byDateDesc);
  locked.sort(byDateDesc);
  approved.sort(byDateDesc);
  rejected.sort(byDateDesc);
  return { drafts, pending, locked, approved, rejected };
}
