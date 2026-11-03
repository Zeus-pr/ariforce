/** Leave (#51) helpers shared by the leave page, Tour Plans and DCR. See docs/LEAVE.md. */
import {
  DEFAULT_ROLE_PERMISSIONS,
  istDate,
  LEAVE_DCR_CONFLICT,
  LeaveDcrConflictDetails,
  type LeaveBalanceItem as LeaveBalanceSchema,
  type LeaveCalendarEntry as LeaveCalendarSchema,
  type LeaveRequest,
  type LeaveSettings as LeaveSettingsSchema,
  type LeaveType,
  type Permission,
} from '@ariforce/contracts';
import type * as z from 'zod';
import type { Role } from '@/lib/roles';

export type LeaveReq = LeaveRequest;
export type { LeaveType };
export type LeaveSettings = z.infer<typeof LeaveSettingsSchema>;
export type LeaveBalanceItem = z.infer<typeof LeaveBalanceSchema>;
export type LeaveCalendarEntry = z.infer<typeof LeaveCalendarSchema>;
export type LeaveStatus = LeaveReq['status'];

export const canLeave = (role: Role, p: Permission) =>
  (DEFAULT_ROLE_PERMISSIONS[role] ?? []).includes(p);
/** Everyone with a reporting line applies; System Admin has no leave. */
export const seesLeave = (role: Role) => canLeave(role, 'leave:read');

export const STATUS_LABEL: Record<LeaveStatus, string> = {
  pending: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};
export const STATUS_TONE: Record<LeaveStatus, string> = {
  pending: 'bg-amber-100 text-amber-900',
  approved: 'bg-emerald-100 text-emerald-900',
  rejected: 'bg-red-100 text-red-900',
  cancelled: 'bg-muted text-muted-foreground',
};

export const today = () => istDate();
export const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

/** Days counted as leave: dates in range minus weekly offs; a half day is 0.5 (same rule as the API). */
export function countDays(from: string, to: string, half: 'am' | 'pm' | null, weeklyOff: number[]) {
  if (!from || !to || to < from) return 0;
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (!weeklyOff.includes(dow(d))) n++;
  return half ? Math.min(n, 0.5) : n;
}

const fmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const fmtShort = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
export const dateLabel = (d: string) => fmt.format(new Date(`${d}T00:00:00Z`));
export function rangeLabel(r: Pick<LeaveReq, 'fromDate' | 'toDate' | 'half'>) {
  const half = r.half ? ` (${r.half === 'am' ? 'morning' : 'afternoon'})` : '';
  if (r.fromDate === r.toDate) return dateLabel(r.fromDate) + half;
  return `${fmtShort.format(new Date(`${r.fromDate}T00:00:00Z`))} – ${dateLabel(r.toDate)}`;
}
export const daysLabel = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

type Err = { code?: string; message?: string; details?: unknown };
const list = (ds: unknown) =>
  Array.isArray(ds) && ds.length
    ? ` (${(ds as string[]).slice(0, 5).map(dateLabel).join(', ')}${ds.length > 5 ? '…' : ''})`
    : '';

/** "29 Oct", "29 Oct and 30 Oct", "29 Oct, 30 Oct and 31 Oct" (first 5, then "and N more"). */
export function shortDates(ds: string[]): string {
  const xs = [...new Set(ds)].sort().map((d) => fmtShort.format(new Date(`${d}T00:00:00Z`)));
  if (xs.length > 5) return `${xs.slice(0, 5).join(', ')} and ${xs.length - 5} more`;
  return xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : (xs[0] ?? '');
}

/**
 * 409 LEAVE_DCR_CONFLICT on approving leave: the requester has a submitted DCR on a leave date.
 * Nothing was saved; the request stays pending. There is no web view of another person's single DCR,
 * so the dcrIds are not linked.
 */
export function leaveDcrConflictMessage(details: unknown): string {
  const p = LeaveDcrConflictDetails.safeParse(details);
  const dates = p.success ? p.data.dates : [];
  if (!dates.length)
    return 'Can’t approve: a DCR is already submitted on a leave date. Sort it out with a correction first.';
  return `Can’t approve: ${dates.length > 1 ? 'DCRs are' : 'a DCR is'} already submitted for ${shortDates(dates)}. Sort ${dates.length > 1 ? 'them' : 'it'} out with a correction first.`;
}

/** Message for a failed POST /v1/approvals/{id}/decision: LEAVE_DCR_CONFLICT spelled out, others as sent. */
export function approvalDecisionMessage(e: Err): string {
  return e.code === LEAVE_DCR_CONFLICT
    ? leaveDcrConflictMessage(e.details)
    : e.message || 'Could not save the decision. Try again.';
}

/** Plain-language message for leave errors, including LEAVE_DAY_BLOCKED from Tour Plans and DCR. */
export function leaveMessage(e: Err): string {
  const d = (e.details ?? {}) as Record<string, unknown>;
  switch (e.code) {
    case LEAVE_DCR_CONFLICT:
      return leaveDcrConflictMessage(e.details);
    case 'LEAVE_DAY_BLOCKED':
      return `You are on approved leave on ${Array.isArray(d.dates) && d.dates.length ? (d.dates as string[]).map(dateLabel).join(', ') : 'this day'}. Use a Leave or Holiday work type for that day, or cancel the leave first.`;
    case 'LEAVE_BACKDATE_WINDOW':
      return `Leave can start no earlier than ${typeof d.earliest === 'string' ? dateLabel(d.earliest) : 'the backdating limit'}.`;
    case 'LEAVE_TOO_FAR_AHEAD':
      return `Leave can start no later than ${typeof d.latest === 'string' ? dateLabel(d.latest) : 'the allowed limit'}.`;
    case 'LEAVE_INSUFFICIENT_BALANCE':
      return `Not enough balance: ${d.available ?? 0} available, ${d.requested ?? '?'} requested.`;
    case 'LEAVE_OVERLAP':
      return 'You already have leave on some of these dates.';
    case 'LEAVE_SPANS_YEARS':
      return 'Leave cannot cross 31 December. Split it into two requests.';
    case 'LEAVE_NO_WORKING_DAYS':
      return 'Every selected date is a weekly off.';
    case 'LEAVE_HALF_DAY_NOT_ALLOWED':
      return 'This leave type cannot be taken as a half day.';
    case 'LEAVE_DCR_EXISTS':
      return `A DCR already exists on${list(d.dates) || ' one of these days'}.`;
    case 'LEAVE_NOT_CANCELLABLE':
      return e.message || 'This leave can no longer be cancelled.';
    case 'LEAVE_SELF_GRANT':
      return 'You cannot grant leave to yourself.';
    case 'CONFLICT':
      return 'Someone already decided this request. Reload to see the latest.';
    case 'NETWORK':
      return 'Could not reach the server.';
    default:
      return e.message || 'Something went wrong.';
  }
}

/** Save errors on Tour Plans / DCR: explain an approved-leave block, otherwise the server message. */
export const saveMessage = (e: Err) =>
  e.code === 'LEAVE_DAY_BLOCKED' ? leaveMessage(e) : e.message || 'Something went wrong.';
