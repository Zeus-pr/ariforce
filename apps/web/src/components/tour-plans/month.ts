const ym = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' });
/** Current month in IST as YYYY-MM. */
export const thisMonthIST = () => ym.format(new Date());

export function shiftMonth(month: string, by: number) {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Every date in the month as YYYY-MM-DD. */
export function datesOf(month: string) {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

/** Monday-first weekday index (0 = Mon) for a YYYY-MM-DD date. */
export const weekdayMon = (ymd: string) => (new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7;

const ml = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const monthLabel = (month: string) => ml.format(new Date(`${month}-01T00:00:00Z`));
const dl = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
export const dayLabel = (ymd: string) => dl.format(new Date(`${ymd}T00:00:00Z`));
