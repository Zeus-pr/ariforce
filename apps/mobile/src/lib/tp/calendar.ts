import { datesOf, type TpItem, type TpStatus } from './adapter';
import { joinShort, shortLabel, type CalendarPillStatus, type DayPill } from '../calendar-pills';

export type { DayPill, CalendarPillStatus };

function pillStatus(s: TpStatus): CalendarPillStatus {
  return s;
}

/** Build a short Outlook-style label: territories, else work type. */
export function tpPillLabel(
  t: TpItem,
  names: { territory: Map<string, string>; workType: Map<string, string> },
): string {
  const terr = t.plan.territoryIds
    .map((id) => names.territory.get(id))
    .filter((n): n is string => !!n);
  if (terr.length) return joinShort(terr, 2, 18);
  const wt = names.workType.get(t.plan.workTypeId);
  if (wt) return shortLabel(wt, 16);
  return shortLabel(`TP ${t.from.slice(5)}`, 14);
}

/** Longer subtitle for list rows (territories · work type). */
export function tpListLabel(
  t: TpItem,
  names: { territory: Map<string, string>; workType: Map<string, string> },
): string {
  const terr = t.plan.territoryIds
    .map((id) => names.territory.get(id))
    .filter((n): n is string => !!n);
  const wt = names.workType.get(t.plan.workTypeId);
  if (terr.length && wt) return `${terr.slice(0, 2).join(' · ')} · ${wt}`;
  if (terr.length) return terr.slice(0, 3).join(' · ');
  return wt ?? `Tour plan`;
}

/** Map TP items onto YYYY-MM-DD keys for the month grid (includes drafts). */
export function pillsByDate(
  items: TpItem[],
  labelOf: (t: TpItem) => string,
): Map<string, DayPill[]> {
  const map = new Map<string, DayPill[]>();
  for (const t of items) {
    const label = labelOf(t);
    for (const date of datesOf(t.from, t.to)) {
      const list = map.get(date) ?? [];
      list.push({ date, label, status: pillStatus(t.status), itemId: t.id });
      map.set(date, list);
    }
  }
  return map;
}

/** Build a Sunday-start month grid of YYYY-MM-DD (or null padding). */
export function monthGrid(year: number, monthIndex: number): (string | null)[] {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const startPad = first.getUTCDay(); // 0 = Sun
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = new Date(Date.UTC(year, monthIndex, d)).toISOString().slice(0, 10);
    cells.push(iso);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function groupByStatus(items: TpItem[]) {
  const approved = items.filter((t) => t.status === 'approved');
  const pending = items.filter((t) => t.status === 'pending');
  const rejected = items.filter((t) => t.status === 'rejected');
  const drafts = items.filter((t) => t.status === 'draft');
  return { approved, pending, rejected, drafts };
}
