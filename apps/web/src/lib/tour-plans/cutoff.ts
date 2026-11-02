/**
 * Tour-plan window: next calendar month only; closes on the 22nd of the current month at 12:00 AM IST.
 * Same rule as the mobile client.
 */
import { thisMonthIST } from '@/components/tour-plans/month';

const MONTH_NAMES =
  'January February March April May June July August September October November December'.split(
    ' ',
  );

/** YYYY-MM of the calendar month after `ym`. */
export function nextYmOf(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  let ny = y!;
  let nm = m! + 1;
  if (nm > 12) {
    nm = 1;
    ny += 1;
  }
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

export function monthNameOf(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_NAMES[m! - 1]} ${y}`;
}

/**
 * Returns an error string when `planYm` is not open for planning; null when OK.
 * Example on 1 Nov: December is open until 22 Nov 12:00 AM IST; November is blocked.
 */
export function tpFutureMonthCutoffError(planYm: string, now = new Date()): string | null {
  const currentYm = thisMonthIST();
  const nextYm = nextYmOf(currentYm);
  const planLabel = monthNameOf(planYm);
  const currLabel = monthNameOf(currentYm);

  if (planYm <= currentYm)
    return `Tour plans are for the next month only — ${planLabel} is not open (current month is ${currLabel}).`;
  if (planYm !== nextYm) return `Only ${monthNameOf(nextYm)} can be planned now.`;

  const cutoff = new Date(`${currentYm}-22T00:00:00+05:30`);
  if (now.getTime() < cutoff.getTime()) return null;
  return `Tour plans for ${planLabel} closed after 22 ${currLabel} at 12:00 AM IST.`;
}

/** The one month that can be planned right now, or null if the window is closed. */
export function tpOpenMonth(now = new Date()): string | null {
  const next = nextYmOf(thisMonthIST());
  return tpFutureMonthCutoffError(next, now) ? null : next;
}

/** True when empty days in this month should be greyed (not the open planning month). */
export function tpMonthNotPlannable(month: string, now = new Date()): boolean {
  return !!tpFutureMonthCutoffError(month, now);
}
