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
