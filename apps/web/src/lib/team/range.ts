/** Quick date ranges (IST calendar days, YYYY-MM-DD) for team filters. */
export type RangeKey = 'today' | 'yesterday' | 'week' | 'month' | 'last30';

export const RANGE_LABEL: Record<RangeKey, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'This week',
  month: 'This month',
  last30: 'Last 30 days',
};

const add = (ymd: string, days: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export { add as addDays };

/** `today` is the IST date. Weeks start on Monday. */
export function rangeOf(key: RangeKey, today: string): { from: string; to: string } {
  switch (key) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday':
      return { from: add(today, -1), to: add(today, -1) };
    case 'week': {
      const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
      return { from: add(today, -dow), to: today };
    }
    case 'month':
      return { from: `${today.slice(0, 8)}01`, to: today };
    case 'last30':
      return { from: add(today, -29), to: today };
  }
}

/** Inclusive number of days in a range. */
export const daysIn = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

/** Months (YYYY-MM) a range touches, oldest first. */
export function monthsIn(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const end = to.slice(0, 7);
  for (;;) {
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    out.push(ym);
    if (ym >= end || out.length > 24) return out;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
}
