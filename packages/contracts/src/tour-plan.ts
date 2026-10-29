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

/** Default weekly off (0 = Sunday .. 6 = Saturday), as leave_settings.weekly_off_days. */
export const DEFAULT_WEEKLY_OFF_DAYS = [0];
/** Time zone for "today" in the tour-plan submit rule. */
export const TP_TIME_ZONE = 'Asia/Kolkata';
/** Calendar date (YYYY-MM-DD) of an instant in IST. */
export function istDate(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** Submit rule: a plan can be submitted when at least one day has an entry. */
export function hasPlannedDay(days: PlanDay[]): boolean {
  return days.some((d) => d.entries.length > 0);
}

/**
 * @deprecated Informational only; submit no longer requires these dates (see hasPlannedDay).
 * Dates that need a plan entry before submit (approved full-day leave is excluded separately).
 * Weekly-off days never count. Current month (IST): only dates on or after today. Future and
 * past months: every non-off date (a past month is not reduced to nothing).
 */
export function requiredDates(month: string, today: string, weeklyOffDays: number[]): string[] {
  const off = new Set(weeklyOffDays);
  const dates = monthDates(month).filter((d) => !off.has(new Date(`${d}T00:00:00Z`).getUTCDay()));
  return month === today.slice(0, 7) ? dates.filter((d) => d >= today) : dates;
}

/** @deprecated Informational only; does not gate submit. Required dates with no entry. */
export function missingRequiredDates(
  month: string,
  days: PlanDay[],
  today: string,
  weeklyOffDays: number[],
): string[] {
  const have = new Set(days.filter((d) => d.entries.length > 0).map((d) => d.date));
  return requiredDates(month, today, weeklyOffDays).filter((d) => !have.has(d));
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

/** A plan day with its own approval state, as input to tourPlanDraftCards. */
export interface TpCardDay<E> {
  date: string;
  entries: E[];
  status: string;
  submissionId: string | null;
}
/** One report of the rep (any DCR of a day), as input to tourPlanDraftCards. */
export interface TpDayReport {
  date: string;
  status: string;
}
export interface TpCard<E> {
  tourPlanId: string;
  submissionId: string | null;
  from: string;
  to: string;
  dates: string[];
  entries: E[];
  filedDates: string[];
  draftDates: string[];
  pendingDates: string[];
  fileableDates: string[];
}

const nextDate = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};

/**
 * Approved tour-plan days as DCR draft cards. A card is a run of consecutive approved days of one
 * plan, in the same submission, with identical entries (one day = a one-day card). A day is filed
 * when the rep has a submitted or approved DCR for it (rejected and draft reports do not count).
 * A card is shown while some pending day is today (IST) or later; the day lock is 00:00 IST the
 * next day, so the card hides once its last pending day locks. fileableDates = today only.
 */
export function tourPlanDraftCards<E>(
  plans: { tourPlanId: string; days: TpCardDay<E>[] }[],
  reports: TpDayReport[],
  today: string,
): TpCard<E>[] {
  const filed = new Set(
    reports.filter((r) => r.status === 'submitted' || r.status === 'approved').map((r) => r.date),
  );
  const drafts = new Set(reports.filter((r) => r.status === 'draft').map((r) => r.date));
  const cards: TpCard<E>[] = [];
  for (const plan of plans) {
    const days = plan.days
      .filter((d) => d.status === 'approved' && d.entries.length > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    let run: TpCardDay<E>[] = [];
    const flush = () => {
      if (!run.length) return;
      const dates = run.map((d) => d.date);
      const pendingDates = dates.filter((d) => !filed.has(d));
      if (pendingDates.some((d) => d >= today))
        cards.push({
          tourPlanId: plan.tourPlanId,
          submissionId: run[0]!.submissionId,
          from: dates[0]!,
          to: dates[dates.length - 1]!,
          dates,
          entries: run[0]!.entries,
          filedDates: dates.filter((d) => filed.has(d)),
          draftDates: pendingDates.filter((d) => drafts.has(d)),
          pendingDates,
          fileableDates: pendingDates.filter((d) => d === today),
        });
      run = [];
    };
    for (const d of days) {
      const prev = run[run.length - 1];
      if (
        prev &&
        (prev.submissionId !== d.submissionId ||
          nextDate(prev.date) !== d.date ||
          JSON.stringify(prev.entries) !== JSON.stringify(d.entries))
      )
        flush();
      run.push(d);
    }
    flush();
  }
  return cards.sort(
    (a, b) => a.from.localeCompare(b.from) || a.tourPlanId.localeCompare(b.tourPlanId),
  );
}
