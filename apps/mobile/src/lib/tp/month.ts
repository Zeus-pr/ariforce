import type { TpPlan } from './adapter';

/**
 * One tour plan for the next calendar month.
 * Working days need a saved draft. A full-day pending or approved leave does not.
 * The company weekly off does not. Sunday is required when it is a working day.
 * Slide-to-submit sends those days as one item, which is one approval.
 */

export type MonthStatus = 'draft' | 'pending' | 'approved' | 'rejected';

export type MonthItem = {
  id: string;
  from: string;
  to: string;
  status: MonthStatus;
  updatedAt: string;
  plan: TpPlan;
};

export type LeaveSpan = {
  fromDate: string;
  toDate: string;
  half: 'am' | 'pm' | null;
  status: string;
};

const MONTHS =
  'January February March April May June July August September October November December'.split(
    ' ',
  );

export function nextYm(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  const nm = m! + 1;
  if (nm > 12) return `${y! + 1}-01`;
  return `${y}-${String(nm).padStart(2, '0')}`;
}

/** Last calendar day of YYYY-MM. */
export function monthEnd(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return `${ym}-${String(last).padStart(2, '0')}`;
}

export function monthTitle(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m! - 1]} ${y}`;
}

export function eachDate(from: string, to: string) {
  if (to < from) return [];
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end && out.length < 40) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const dow = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** Full-day pending or approved leave on a working day, inside from..to. */
export function exemptLeaveDates(
  requests: LeaveSpan[] | undefined,
  from: string,
  to: string,
  weeklyOff: number[],
) {
  const out = new Set<string>();
  for (const r of requests ?? []) {
    if (r.half) continue;
    if (r.status !== 'pending' && r.status !== 'approved') continue;
    for (const d of eachDate(
      r.fromDate < from ? from : r.fromDate,
      r.toDate > to ? to : r.toDate,
    )) {
      if (d < from || d > to) continue;
      if (weeklyOff.includes(dow(d))) continue;
      out.add(d);
    }
  }
  return out;
}

/** BM 20, ABM 22, RBM 24, ZBM and above 27. Outside the sales ladder: no deadline. */
export function tpDeadlineDay(rank: number) {
  if (rank === 1) return 20;
  if (rank === 2) return 22;
  if (rank === 3) return 24;
  if (rank >= 4) return 27;
  return null;
}

/** Eight hours between reminders. OK starts the next wait. */
export const TP_REMINDER_GAP_MS = 8 * 60 * 60 * 1000;

/**
 * A reminder while next month's plan is still unsent, from the role's deadline day
 * through the end of this month. Null when there is nothing to say.
 */
export function tpReminder(args: {
  today: string;
  now: Date;
  rank: number;
  sent: boolean;
  lastDismissedAt: number | null;
}): { title: string; body: string } | null {
  const day = tpDeadlineDay(args.rank);
  if (!day || args.sent) return null;
  const todayDay = Number(args.today.slice(8, 10));
  if (todayDay < day) return null;
  if (
    args.lastDismissedAt != null &&
    args.now.getTime() - args.lastDismissedAt < TP_REMINDER_GAP_MS
  )
    return null;
  const next = nextYm(args.today.slice(0, 7));
  const month = monthTitle(next);
  const [y, m] = args.today.slice(0, 7).split('-').map(Number);
  const due = `${day} ${MONTHS[m! - 1]} ${y}, 11:59 pm`;
  if (!tpDeadlinePassed(args.today, args.now, args.rank))
    return {
      title: 'Tour plan due',
      body: `Submit ${month}’s tour plan by ${due}.`,
    };
  return {
    title: 'Tour plan due',
    body: `Punch in stays off until you submit ${month}’s tour plan. Send it before this month ends.`,
  };
}

/** True after 11:59 pm IST on the role's day of `today`'s month. */
export function tpDeadlinePassed(today: string, now: Date, rank: number) {
  const day = tpDeadlineDay(rank);
  if (!day) return false;
  const end = new Date(`${today.slice(0, 7)}-${String(day).padStart(2, '0')}T23:59:59.999+05:30`);
  return now.getTime() > end.getTime();
}

export type PlanStretch = { from: string; to: string; plan: TpPlan };

function planKey(plan: TpPlan) {
  const routes = (plan.sfcRoutes ?? []).map((route) => route.sfcRouteId).sort();
  const sections = (plan.sections ?? []).map((section) => ({
    workTypeId: section.workTypeId,
    territoryIds: [...section.territoryIds].sort(),
    workWithUserIds: [...section.workWithUserIds].sort(),
    routes: section.sfcRoutes.map((route) => route.sfcRouteId).sort(),
    details: section.details,
  }));
  return JSON.stringify({
    workTypeId: plan.workTypeId,
    territoryIds: [...(plan.territoryIds ?? [])].sort(),
    workWithUserIds: [...(plan.workWithUserIds ?? [])].sort(),
    routes,
    details: plan.details,
    sections,
  });
}

/** Consecutive days that share one plan, in date order. A plan with no days is one stretch. */
export function stretchesOf(item: { from: string; to: string; plan: TpPlan }): PlanStretch[] {
  const days = [...(item.plan.days ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  if (!days.length) return [{ from: item.from, to: item.to, plan: item.plan }];
  const groups: PlanStretch[] = [];
  for (const day of days) {
    const plan: TpPlan = {
      workTypeId: day.workTypeId,
      territoryIds: day.territoryIds,
      workWithUserIds: day.workWithUserIds,
      sfcRoutes: day.sfcRoutes,
      details: day.details,
      ...(day.sections?.length ? { sections: day.sections } : {}),
    };
    const last = groups[groups.length - 1];
    if (last && planKey(last.plan) === planKey(plan)) last.to = day.date;
    else groups.push({ from: day.date, to: day.date, plan });
  }
  return groups;
}

/** The plan that applies to one date. A month item stores that on `days`. */
export function planForDay(plan: TpPlan, date: string): TpPlan {
  const day = plan.days?.find((d) => d.date === date);
  if (!day) return plan;
  return {
    workTypeId: day.workTypeId,
    territoryIds: day.territoryIds,
    workWithUserIds: day.workWithUserIds,
    sfcRoutes: day.sfcRoutes,
    details: day.details,
    sections: day.sections,
  };
}

function covers(item: MonthItem, date: string) {
  return item.from <= date && date <= item.to;
}

function pickDraft(items: MonthItem[], date: string) {
  const hits = items.filter(
    (t) => (t.status === 'draft' || t.status === 'rejected') && covers(t, date),
  );
  hits.sort((a, b) => {
    const span = (t: MonthItem) =>
      Date.parse(`${t.to}T00:00:00Z`) - Date.parse(`${t.from}T00:00:00Z`);
    const bySpan = span(a) - span(b);
    if (bySpan) return bySpan;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
  return hits[0] ?? null;
}

export type MonthView =
  | {
      kind: 'ready';
      from: string;
      to: string;
      days: NonNullable<TpPlan['days']>;
      draftIds: string[];
    }
  | { kind: 'sent'; from: string; to: string }
  | { kind: 'gaps'; from: string; to: string; dates: string[] }
  | { kind: 'split'; from: string; to: string };

/**
 * ready: every working day has a draft and nothing in the month is already sent.
 * sent: every working day is already pending or approved (or the month has no working day).
 * gaps: some working days have no plan yet.
 * split: part of the month is already sent, so the rest cannot join one request.
 */
export function monthView(
  items: MonthItem[],
  from: string,
  to: string,
  leave: Set<string>,
  weeklyOff: number[],
): MonthView {
  const required = eachDate(from, to).filter((d) => !leave.has(d) && !weeklyOff.includes(dow(d)));
  const overlaps = (t: MonthItem) => t.from <= to && t.to >= from;
  const blocking = items.filter(
    (t) => (t.status === 'pending' || t.status === 'approved') && overlaps(t),
  );
  const drafts = items.filter(
    (t) => (t.status === 'draft' || t.status === 'rejected') && overlaps(t),
  );
  const coveredBy = (list: MonthItem[], date: string) => list.some((t) => covers(t, date));

  if (required.every((d) => coveredBy(blocking, d))) return { kind: 'sent', from, to };

  const missing = required.filter((d) => !coveredBy(blocking, d) && !coveredBy(drafts, d));
  if (blocking.length) return { kind: 'split', from, to };
  if (missing.length) return { kind: 'gaps', from, to, dates: missing };

  const used = new Map<string, MonthItem>();
  const days = required.map((date) => {
    const item = pickDraft(drafts, date)!;
    used.set(item.id, item);
    const plan = planForDay(item.plan, date);
    return {
      date,
      workTypeId: plan.workTypeId,
      territoryIds: plan.territoryIds ?? [],
      workWithUserIds: plan.workWithUserIds ?? [],
      sfcRoutes: plan.sfcRoutes ?? [],
      details: plan.details ?? null,
      ...(plan.sections?.length ? { sections: plan.sections } : {}),
    };
  });
  return { kind: 'ready', from, to, days, draftIds: [...used.keys()] };
}

/**
 * After the role's day, punch-in stays off through the end of this month
 * until next month's plan is sent. The next calendar month is a new deadline.
 */
export function tpPunchGate(args: {
  today: string;
  now: Date;
  rank: number;
  items: MonthItem[];
  leaveDates: Set<string>;
  weeklyOff: number[];
}): { blocked: boolean; month: string } {
  const next = nextYm(args.today.slice(0, 7));
  const month = monthTitle(next);
  if (!tpDeadlinePassed(args.today, args.now, args.rank)) return { blocked: false, month };
  const view = monthView(args.items, `${next}-01`, monthEnd(next), args.leaveDates, args.weeklyOff);
  return { blocked: view.kind !== 'sent', month };
}
