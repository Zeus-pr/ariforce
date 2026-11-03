/**
 * DCR date rule (API PR #92: 422 DCR_DATE_NOT_TODAY, details { date, today }), same as web PR #97:
 * a DCR can be filled only for today in Asia/Kolkata. A past day is writable only while it is
 * unlocked (`unlockedUntil` in the future). Future days never are. Reading reports is unaffected,
 * and tour plans are unaffected.
 */
import { dateLabel } from './dates';

export function dcrDateOpen(
  date: string,
  today: string,
  unlockedUntil?: string | null,
  now: number = Date.now(),
): boolean {
  if (date === today) return true;
  return date < today && !!unlockedUntil && Date.parse(unlockedUntil) > now;
}

/** Why a day can't be filled. */
export function dcrDateClosedText(date: string, today: string): string {
  return date > today
    ? `DCRs can be filled for today only (${dateLabel(today)}). ${dateLabel(date)} opens on the day.`
    : `DCRs can be filled for today only (${dateLabel(today)}). ${dateLabel(date)} is view-only unless your manager reopens it.`;
}

/** Message for 422 DCR_DATE_NOT_TODAY using its details ({ date, today }). */
export function dcrDateNotTodayMessage(details: unknown, fallbackToday?: string): string {
  const d = (details ?? {}) as { date?: unknown; today?: unknown };
  const today = typeof d.today === 'string' ? d.today : fallbackToday;
  const date = typeof d.date === 'string' ? d.date : undefined;
  if (today && date) return dcrDateClosedText(date, today);
  if (today) return `DCRs can be filled for today only (${dateLabel(today)}).`;
  return 'DCRs can be filled for today only.';
}
