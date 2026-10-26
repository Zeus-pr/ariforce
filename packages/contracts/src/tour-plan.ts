/** Pure tour-plan helpers shared by the API and the mock (no I/O). */

export interface PlanDay<E = unknown> {
  date: string;
  entries: E[];
}
export interface StandardDay<E = unknown> {
  week: number;
  weekday: number;
  entries: E[];
}

/** All dates (YYYY-MM-DD) of a month 'YYYY-MM'. */
export function monthDates(month: string): string[] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

/** STP key of a date: week of month (1-5, day 1-7 = week 1) and ISO weekday (Mon=1 … Sun=7). */
export function stpKey(date: string): { week: number; weekday: number } {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDate();
  return { week: Math.ceil(day / 7), weekday: ((d.getUTCDay() + 6) % 7) + 1 };
}

/** Dates of the month with no entry (submit requires every date planned; use leave/holiday work types). */
export function missingDates(month: string, days: PlanDay[]): string[] {
  const have = new Set(days.filter((d) => d.entries.length > 0).map((d) => d.date));
  return monthDates(month).filter((d) => !have.has(d));
}

/** Dates outside the month or listed twice. */
export function badDates(month: string, days: PlanDay[]): string[] {
  const seen = new Set<string>();
  const bad: string[] = [];
  for (const d of days) {
    if (!d.date.startsWith(`${month}-`) || seen.has(d.date)) bad.push(d.date);
    seen.add(d.date);
  }
  return bad;
}

/** Same-weekday pattern: target date takes the entries of the source date with the same (week, weekday). */
const keyOf = (k: { week: number; weekday: number }) => `${k.week}|${k.weekday}`;
export function copyFromMonth<E>(month: string, source: PlanDay<E>[]): PlanDay<E>[] {
  const byKey = new Map(source.map((d) => [keyOf(stpKey(d.date)), d.entries]));
  return monthDates(month)
    .map((date) => ({ date, entries: structuredClone(byKey.get(keyOf(stpKey(date))) ?? []) }))
    .filter((d) => d.entries.length > 0);
}
export function copyFromStandard<E>(month: string, stp: StandardDay<E>[]): PlanDay<E>[] {
  const byKey = new Map(stp.map((d) => [keyOf(d), d.entries]));
  return monthDates(month)
    .map((date) => ({ date, entries: structuredClone(byKey.get(keyOf(stpKey(date))) ?? []) }))
    .filter((d) => d.entries.length > 0);
}

/** Previous month 'YYYY-MM'. */
export function prevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * DCR deviation from the approved TP (#22): the work type is not planned that day, or a worked territory is not planned.
 * No planned entry = no deviation.
 */
export function isDeviation(
  planned: { workTypeId: string; territoryIds: string[] }[],
  workTypeId: string,
  territoryIds: string[],
): boolean {
  if (!planned.length) return false;
  const terr = new Set(planned.flatMap((e) => e.territoryIds));
  return (
    !planned.some((e) => e.workTypeId === workTypeId) || territoryIds.some((t) => !terr.has(t))
  );
}
