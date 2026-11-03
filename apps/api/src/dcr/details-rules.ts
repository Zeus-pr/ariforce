import {
  DCR_MAX_DURATION_MIN,
  MEETING_TYPES,
  hhmmToMinutes,
  isMeetingType,
  type DcrDetails,
} from '@ariforce/contracts';
import { err } from '../field/checkins.service';

/**
 * Write rules for non-field details (DCR draft/submit, TP upsert/submit):
 *  - meeting title must be 'Cycle Meeting' | 'Review Meeting' (422 MEETING_TYPE_INVALID);
 *  - endTime needs a startTime and must be after it (422 END_TIME_NOT_AFTER_START), at most
 *    720 min after it (422 DURATION_TOO_LONG); durationMin is then derived (input ignored);
 *  - without endTime (older clients) durationMin stays required as before (422 VALIDATION).
 * Reads never run these, so old rows (free-text titles, no endTime) keep loading.
 */
export function normaliseDetails<T extends DcrDetails | null | undefined>(
  d: T,
  field = 'details',
): T {
  if (!d || d.kind === 'leave') return d;
  if (d.kind === 'meeting' && !isMeetingType(d.title))
    throw err(422, 'MEETING_TYPE_INVALID', 'Meeting type must be Cycle Meeting or Review Meeting', {
      field: `${field}.title`,
      allowed: MEETING_TYPES,
    });
  const out: Exclude<DcrDetails, { kind: 'leave' }> = { ...d };
  if (out.endTime) {
    const span = out.startTime ? hhmmToMinutes(out.endTime) - hhmmToMinutes(out.startTime) : null;
    if (span === null || span <= 0)
      throw err(422, 'END_TIME_NOT_AFTER_START', 'End time must be after the start time', {
        field: `${field}.endTime`,
        startTime: out.startTime ?? null,
        endTime: out.endTime,
      });
    if (span > DCR_MAX_DURATION_MIN)
      throw err(422, 'DURATION_TOO_LONG', 'A session can be at most 12 hours', {
        field: `${field}.endTime`,
        max: DCR_MAX_DURATION_MIN,
        durationMin: span,
      });
    out.durationMin = span;
  } else if (out.durationMin == null) {
    throw err(422, 'VALIDATION', 'Send endTime (or durationMin from older clients)', {
      field: `${field}.endTime`,
    });
  }
  return out as T;
}
