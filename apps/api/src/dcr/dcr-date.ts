import { err } from '../field/checkins.service';
import { localDate } from '../field/field.util';

/** DCR "today" is always the calendar day in India, never the server's local zone. */
export const DCR_TIME_ZONE = 'Asia/Kolkata';

/** Injectable clock (tests replace `now`). */
export const dcrClock = { now: (): Date => new Date() };

/** Today's date (YYYY-MM-DD) in Asia/Kolkata (= Asia/Calcutta). */
export const dcrToday = (now: Date = dcrClock.now()) => localDate(now, DCR_TIME_ZONE);

/**
 * A DCR may be filled (legacy upsert, draft, submit) only for today in IST. A past day is allowed
 * only while it is unlocked (approved correction / director unlock, or a manager rejection that
 * reopens the day, see lockInfo.unlockedUntil), so an unlocked day can be fixed and re-submitted.
 * Future days are never allowed. Throws 422 DCR_DATE_NOT_TODAY.
 */
export function assertDcrDateWritable(date: string, opts: { unlocked: boolean; now?: Date }): void {
  const today = dcrToday(opts.now);
  if (date === today) return;
  if (date < today && opts.unlocked) return;
  throw err(
    422,
    'DCR_DATE_NOT_TODAY',
    date > today
      ? 'A DCR can only be filled for today; future days are not allowed'
      : 'A DCR can only be filled for today; past days need an approved unlock',
    { date, today },
  );
}
