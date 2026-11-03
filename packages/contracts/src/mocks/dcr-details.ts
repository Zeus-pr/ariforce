import { HttpResponse } from 'msw';
import {
  DCR_EXPENSE_CATEGORIES,
  DCR_MAX_DURATION_MIN,
  MEETING_TYPES,
  hhmmToMinutes,
  deriveDurationMinutes,
  type DcrDetails,
} from '../schemas/dcr-parts';

/** Mock checks for meeting sub-type, end time and DCR expenses (run on the raw body, before zod). */
const err = (code: string, message: string, details?: unknown) =>
  HttpResponse.json({ error: { code, message, details } }, { status: 422 });

const rec = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : null;

export function checkDcrDetailsRaw(details: unknown) {
  const d = rec(details);
  if (!d) return null;
  if (d.kind === 'meeting' && !(MEETING_TYPES as readonly unknown[]).includes(d.title))
    return err('MEETING_TYPE_INVALID', 'Meeting type must be Cycle Meeting or Review Meeting', {
      allowed: MEETING_TYPES,
    });
  const start = typeof d.startTime === 'string' ? d.startTime : null;
  const end = typeof d.endTime === 'string' ? d.endTime : null;
  if (end && (!start || deriveDurationMinutes(start, end) === null))
    return err('END_TIME_NOT_AFTER_START', 'End time must be after the start time', {
      startTime: start,
      endTime: end,
    });
  if (end && start && hhmmToMinutes(end) - hhmmToMinutes(start) > DCR_MAX_DURATION_MIN)
    return err('DURATION_TOO_LONG', 'A session can be at most 12 hours', {
      max: DCR_MAX_DURATION_MIN,
    });
  return null;
}

export function checkDcrExpensesRaw(expenses: unknown) {
  if (!Array.isArray(expenses)) return null;
  const i = expenses.findIndex(
    (e) => !(DCR_EXPENSE_CATEGORIES as readonly unknown[]).includes(rec(e)?.category),
  );
  if (i >= 0)
    return err('DCR_EXPENSE_CATEGORY_INVALID', 'Use travel, hotel, food or other', {
      index: i,
      allowed: DCR_EXPENSE_CATEGORIES,
    });
  return null;
}

/** Server-side normalisation: derived durationMin. */
export function normaliseDcrDetails<T extends DcrDetails | null | undefined>(d: T): T {
  if (!d || d.kind === 'leave') return d;
  const derived = deriveDurationMinutes(d.startTime, d.endTime);
  return (derived ? { ...d, durationMin: derived } : d) as T;
}
