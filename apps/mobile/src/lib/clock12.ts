/** Convert between API `HH:mm` (24h) and 12-hour clock fields (CUTLY utils/clock12.ts). */

export type AmPm = 'AM' | 'PM';

export type Clock12 = {
  hour12: number;
  minute: number;
  period: AmPm;
};

/** Parse `HH:mm` or `H:mm` → 12h parts. Falls back to 9:00 AM. */
export function parseHHmmTo12(value: string): Clock12 {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  let hour24 = 9;
  let minute = 0;
  if (match) {
    hour24 = Math.min(23, Math.max(0, Number(match[1])));
    minute = Math.min(59, Math.max(0, Number(match[2])));
  }
  const period: AmPm = hour24 >= 12 ? 'PM' : 'AM';
  let hour12 = hour24 % 12;
  if (hour12 === 0) hour12 = 12;
  return { hour12, minute, period };
}

/** Build `HH:mm` (24h) from 12h parts. */
export function format12ToHHmm(hour12: number, minute: number, period: AmPm): string {
  const h12 = Math.min(12, Math.max(1, Math.round(hour12) || 12));
  const m = Math.min(59, Math.max(0, Math.round(minute) || 0));
  let hour24 = h12 % 12;
  if (period === 'PM') hour24 += 12;
  return `${String(hour24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Display label e.g. "9:00 AM". */
export function formatHHmmLabel(value: string): string {
  const { hour12, minute, period } = parseHHmmTo12(value);
  return `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
}

/** Date used only to feed native time picker. */
export function dateFromHHmm(value: string, base = new Date()): Date {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  const hh = match ? Math.min(23, Number(match[1])) : 9;
  const mm = match ? Math.min(59, Number(match[2])) : 0;
  const next = new Date(base);
  next.setHours(hh, mm, 0, 0);
  return next;
}

export function hhmmFromDate(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
