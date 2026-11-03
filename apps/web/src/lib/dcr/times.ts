/**
 * End time, derived duration and from/to place for non-field DCR / tour-plan details.
 * ASSUMED CONTRACT (not in the API yet): `endTime` (HH:mm), `fromPlace`, `toPlace` (meeting and
 * admin work) on the details object. `durationMin` stays the API's field and is derived from
 * start and end, so it is never typed in.
 */
export type DetailsExtra = {
  endTime?: string | null;
  fromPlace?: string | null;
  toPlace?: string | null;
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Minutes from start to end on the same day; null unless both are valid and end is after start. */
export function spanMin(start: string, end: string): number | null {
  if (!HHMM.test(start) || !HHMM.test(end)) return null;
  const d = mins(end) - mins(start);
  return d > 0 ? d : null;
}

/** End time for records saved before end time existed: start + duration (same day only). */
export function endFrom(start: string | null | undefined, durationMin: number): string {
  if (!start || !HHMM.test(start)) return '';
  const t = mins(start) + durationMin;
  if (t >= 24 * 60) return '';
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** "45 min", "2 h", "1 h 30 min". */
export function durationText(min: number | null): string {
  if (!min) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ');
}

/** The inline problem with a start/end pair, if any (shown as soon as both are filled). */
export function endTimeProblem(start: string, end: string): string | null {
  if (!HHMM.test(start) || !HHMM.test(end)) return null;
  return spanMin(start, end) ? null : 'End time must be after the start time.';
}

/**
 * Form values for end time, duration and places from a saved details object. `durationMin` is
 * server-derived and may be absent; the end time falls back to start + duration on records saved
 * before end time existed, and the duration to the start/end span.
 */
export function extraFormOf(d: {
  startTime?: string | null;
  endTime?: string | null;
  durationMin?: number | null;
  fromPlace?: string | null;
  toPlace?: string | null;
}): { endTime: string; durationMin: string; fromPlace: string; toPlace: string } {
  const endTime = d.endTime ?? (d.durationMin ? endFrom(d.startTime, d.durationMin) : '');
  const duration = d.durationMin ?? (d.startTime ? spanMin(d.startTime, endTime) : null);
  return {
    endTime,
    durationMin: duration ? String(duration) : '',
    fromPlace: d.fromPlace ?? '',
    toPlace: d.toPlace ?? '',
  };
}
