import type { Tx } from '@ariforce/db';
import { sql } from 'drizzle-orm';
import { err } from '../field/checkins.service';

/** Approved leave on a date (weekly offs excluded), from the kpi_user_leave_day view (#51). */
export interface LeaveDay {
  userId: string;
  date: string;
  half: 'am' | 'pm' | null;
  requestId: string;
  typeCode: string;
}

export const addDay = (d: string, n = 1) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
/** Every calendar date from..to inclusive (no cap; callers bound the range). */
export function allDates(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDay(d)) out.push(d);
  return out;
}
/** Dates that count as leave: weekly-off weekdays are skipped (no holiday master exists yet). */
export const countedDates = (from: string, to: string, weeklyOff: number[]) =>
  allDates(from, to).filter((d) => !weeklyOff.includes(dow(d)));

/** Approved leave days for users in [from, to]. */
export async function approvedLeaveDays(
  tx: Tx,
  userIds: string[],
  from: string,
  to: string,
): Promise<LeaveDay[]> {
  if (!userIds.length) return [];
  const r = await tx.execute<{
    user_id: string;
    date: string;
    half: 'am' | 'pm' | null;
    leave_request_id: string;
    leave_type_code: string;
  }>(sql`select user_id, to_char(date, 'YYYY-MM-DD') as date, half, leave_request_id, leave_type_code
    from kpi_user_leave_day
    where user_id in (${sql.join(
      userIds.map((u) => sql`${u}::uuid`),
      sql`, `,
    )}) and date between ${from}::date and ${to}::date`);
  return r.rows.map((x) => ({
    userId: x.user_id,
    date: x.date,
    half: x.half,
    requestId: x.leave_request_id,
    typeCode: x.leave_type_code,
  }));
}

/** Kinds that may be planned/reported on a leave day. */
const OFF_KINDS = ['leave', 'holiday'];

/**
 * Throws 422 LEAVE_DAY_BLOCKED when work is planned/reported on approved leave: on a full leave day
 * any field/non-field entry; on a half day an entry for the same half or the full day.
 */
export function assertNotOnLeave(
  leave: LeaveDay[],
  entries: { date: string; session: 'full' | 'am' | 'pm'; kind: string }[],
) {
  const bad = new Set<string>();
  for (const e of entries) {
    if (OFF_KINDS.includes(e.kind)) continue;
    const l = leave.find((x) => x.date === e.date);
    if (!l) continue;
    if (!l.half || e.session === 'full' || e.session === l.half) bad.add(e.date);
  }
  if (bad.size)
    throw err(422, 'LEAVE_DAY_BLOCKED', 'You are on approved leave on these dates', {
      dates: [...bad].sort(),
    });
}
