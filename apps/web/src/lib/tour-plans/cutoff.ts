/**
 * Tour-plan window: next calendar month only.
 * Closes at 11:59 pm IST on the role's day: BM 20, ABM 22, RBM 24, ZBM and above 27.
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

/** BM 20, ABM 22, RBM 24, ZBM and above 27. Rank 0 has no day cutoff. */
export function tpDeadlineDay(rank: number) {
  if (rank === 1) return 20;
  if (rank === 2) return 22;
  if (rank === 3) return 24;
  if (rank >= 4) return 27;
  return null;
}

function dayOrdinal(day: number) {
  const teen = day % 100;
  const suf =
    teen >= 11 && teen <= 13
      ? 'th'
      : day % 10 === 1
        ? 'st'
        : day % 10 === 2
          ? 'nd'
          : day % 10 === 3
            ? 'rd'
            : 'th';
  return `${day}${suf}`;
}

/**
 * Returns an error string when `planYm` is not open for planning; null when OK.
 * The next month stays open through 11:59 pm IST on the role's day.
 */
export function tpFutureMonthCutoffError(
  planYm: string,
  rank: number,
  now = new Date(),
): string | null {
  const currentYm = thisMonthIST();
  const nextYm = nextYmOf(currentYm);
  const planLabel = monthNameOf(planYm);
  const currLabel = monthNameOf(currentYm);

  if (planYm <= currentYm)
    return `Tour plans are for the next month only — ${planLabel} is not open (current month is ${currLabel}).`;
  if (planYm !== nextYm) return `Only ${monthNameOf(nextYm)} can be planned now.`;

  const day = tpDeadlineDay(rank);
  if (!day) return null;
  const end = new Date(`${currentYm}-${String(day).padStart(2, '0')}T23:59:59.999+05:30`);
  if (now.getTime() <= end.getTime()) return null;
  return `Tour plans are only for the next month, and that window closed at 11:59 pm on the ${dayOrdinal(day)}.`;
}

/** The one month that can be planned right now, or null if the window is closed. */
export function tpOpenMonth(rank: number, now = new Date()): string | null {
  const next = nextYmOf(thisMonthIST());
  return tpFutureMonthCutoffError(next, rank, now) ? null : next;
}

/** True when empty days in this month should be greyed (not the open planning month). */
export function tpMonthNotPlannable(month: string, rank: number, now = new Date()): boolean {
  return !!tpFutureMonthCutoffError(month, rank, now);
}
