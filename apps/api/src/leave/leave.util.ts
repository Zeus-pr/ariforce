import type { Tx } from '@ariforce/db';
import { sql } from 'drizzle-orm';
import { err } from '../field/checkins.service';
import { submittedReportSql } from '../dcr/day-report';

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

/**
 * Serialises "approve leave" against "submit a DCR" for one user (transaction-scoped advisory lock).
 * Both sides take it before their check (leave approval: no submitted DCR on the leave dates; DCR
 * submit: no approved leave on the day), so neither can commit past the other's check.
 */
export async function lockDcrLeave(tx: Tx, userId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`ariforce:dcr-leave:${userId}`}, 0))`,
  );
}

export interface LeaveDcrConflict {
  dates: string[];
  dcrIds: string[];
}

/** Submitted/approved DCRs on the leave's dates -> the 409 details (sorted, unique), or null. */
export function leaveDcrConflict(rows: { id: string; date: string }[]): LeaveDcrConflict | null {
  if (!rows.length) return null;
  return {
    dates: [...new Set(rows.map((r) => r.date))].sort(),
    dcrIds: [...new Set(rows.map((r) => r.id))].sort(),
  };
}

/**
 * Leave approval guard (Sharanya 2026-10-28: block approval until the DCR is sorted out): every date
 * from fromDate to toDate (half days included) must have no live submitted/approved DCR of the user.
 * Drafts never block. Throws 409 LEAVE_DCR_CONFLICT { dates, dcrIds }. Takes lockDcrLeave first.
 */
export async function assertNoSubmittedDcr(
  tx: Tx,
  userId: string,
  fromDate: string,
  toDate: string,
) {
  await lockDcrLeave(tx, userId);
  const r = await tx.execute<{ id: string; date: string }>(sql`
    select d.id, to_char(d.date, 'YYYY-MM-DD') as date from dcrs d
    where d.user_id = ${userId} and ${submittedReportSql('d')}
      and d.date between ${fromDate}::date and ${toDate}::date
    order by d.date, d.id`);
  const c = leaveDcrConflict(r.rows);
  if (c)
    throw err(
      409,
      'LEAVE_DCR_CONFLICT',
      'A submitted DCR exists on these leave dates; sort the DCR out (correction) before approving',
      c,
    );
}
