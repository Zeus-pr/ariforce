/** First day the absent mark exists. Earlier empty days stay as they were. */
export const ABSENT_FROM = '2026-11-23';

export function isSunday(date: string): boolean {
  return new Date(`${date}T00:00:00Z`).getUTCDay() === 0;
}

/**
 * A finished working day with no punch-in and no leave. Sunday and a holiday stay clear.
 * Today stays clear until the day has ended.
 */
export function isAbsentDay(a: {
  date: string;
  today: string;
  punchedIn: boolean;
  leave: boolean;
  holiday: boolean;
}): boolean {
  if (a.date < ABSENT_FROM || a.date >= a.today) return false;
  if (a.punchedIn || a.leave || a.holiday || isSunday(a.date)) return false;
  return true;
}

/** Yesterday was worked and its report was never submitted. One day only. */
export function blocksNextPunchIn(a: { punchedIn: boolean; submitted: boolean }): boolean {
  return a.punchedIn && !a.submitted;
}
