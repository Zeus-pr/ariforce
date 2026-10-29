/**
 * Leave (#51), live API (apps/web components/leave + lib/leave/model.ts ported):
 * GET /v1/leave/types|settings|balances|requests, POST /v1/leave/requests (apply = submit),
 * POST /v1/leave/requests/:id/cancel, POST /v1/leave/requests/:id/decision.
 */
import type { LeaveRequest, LeaveType } from '@ariforce/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiFetch } from './api';
import { todayIST } from './dcr/dates';

export type LeaveReq = LeaveRequest;
export type { LeaveType };
export type LeaveStatus = LeaveReq['status'];
export type LeaveBalanceItem = {
  typeCode: string;
  typeName: string;
  paid: boolean;
  unlimited: boolean;
  quota: number | null;
  used: number;
  pending: number;
  available: number | null;
};
export type LeaveSettings = {
  weeklyOffDays: number[];
  backdateDays: number;
  maxFutureDays: number | null;
};

export const STATUS_LABEL: Record<LeaveStatus, string> = {
  pending: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};
export const STATUS_TONE = {
  pending: 'orange',
  approved: 'green',
  rejected: 'red',
  cancelled: 'neutral',
} as const satisfies Record<LeaveStatus, string>;

export const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

/** Days counted as leave: dates in range minus weekly offs; a half day is 0.5 (same rule as the API). */
export function countDays(from: string, to: string, half: 'am' | 'pm' | null, weeklyOff: number[]) {
  if (!from || !to || to < from) return 0;
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (!weeklyOff.includes(dow(d))) n++;
  return half ? Math.min(n, 0.5) : n;
}

const MON = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
const short = (d: string) => `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]}`;
export const dateLabelL = (d: string) => `${short(d)} ${d.slice(0, 4)}`;
export function rangeLabel(r: Pick<LeaveReq, 'fromDate' | 'toDate' | 'half'>) {
  const half = r.half ? ` (${r.half === 'am' ? 'morning' : 'afternoon'})` : '';
  if (r.fromDate === r.toDate) return dateLabelL(r.fromDate) + half;
  return `${short(r.fromDate)} – ${dateLabelL(r.toDate)}`;
}
export const daysLabel = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/** "29 Oct", "29 Oct and 30 Oct", "29 Oct, 30 Oct and 31 Oct" (first 5, then "and N more"). */
export function shortDates(ds: string[]): string {
  const xs = [...new Set(ds)].sort().map(short);
  if (xs.length > 5) return `${xs.slice(0, 5).join(', ')} and ${xs.length - 5} more`;
  return xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : (xs[0] ?? '');
}

/** Ported from apps/web lib/leave/model.ts: 409 LEAVE_DCR_CONFLICT on approving leave. */
export function leaveDcrConflictMessage(details: unknown): string {
  const d = details as { dates?: unknown } | undefined;
  const dates = Array.isArray(d?.dates)
    ? d.dates.filter((x): x is string => typeof x === 'string')
    : [];
  if (!dates.length)
    return 'Can’t approve: a DCR is already submitted on a leave date. Sort it out with a correction first.';
  return `Can’t approve: ${dates.length > 1 ? 'DCRs are' : 'a DCR is'} already submitted for ${shortDates(dates)}. Sort ${dates.length > 1 ? 'them' : 'it'} out with a correction first.`;
}

/** Plain-language leave errors (web leaveMessage). */
export function leaveMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return (e as Error)?.message || 'Something went wrong.';
  const d = (e.details ?? {}) as Record<string, unknown>;
  const list = (ds: unknown) =>
    Array.isArray(ds) && ds.length ? ` (${shortDates(ds as string[])})` : '';
  switch (e.code) {
    case 'LEAVE_DCR_CONFLICT':
      return leaveDcrConflictMessage(e.details);
    case 'LEAVE_BACKDATE_WINDOW':
      return `Leave can start no earlier than ${typeof d.earliest === 'string' ? dateLabelL(d.earliest) : 'the backdating limit'}.`;
    case 'LEAVE_TOO_FAR_AHEAD':
      return `Leave can start no later than ${typeof d.latest === 'string' ? dateLabelL(d.latest) : 'the allowed limit'}.`;
    case 'LEAVE_INSUFFICIENT_BALANCE':
      return `Not enough balance: ${String(d.available ?? 0)} available, ${String(d.requested ?? '?')} requested.`;
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
    case 'REJECTION_REASON_REQUIRED':
      return 'Give a reason to reject.';
    case 'CONFLICT':
      return 'Someone already decided this request. Pull to refresh.';
    case 'NETWORK':
      return 'Could not reach the server.';
    default:
      return e.message || 'Something went wrong.';
  }
}

/** Web rule: pending, or approved and not started yet. */
export const cancellable = (r: LeaveReq) =>
  r.status === 'pending' || (r.status === 'approved' && r.fromDate > todayIST());

const key = ['leave'] as const;
const year = () => Number(todayIST().slice(0, 4));

export function useLeaveData() {
  return useQuery({
    queryKey: [...key, 'mine', year()],
    queryFn: async ({ signal }) => {
      const y = year();
      const [types, settings, balances, requests] = await Promise.all([
        apiFetch<{ items: LeaveType[] }>('/v1/leave/types', { signal }),
        apiFetch<LeaveSettings>('/v1/leave/settings', { signal }),
        apiFetch<{ items: LeaveBalanceItem[] }>('/v1/leave/balances', {
          signal,
          query: { year: y },
        }),
        apiFetch<{ items: LeaveReq[] }>('/v1/leave/requests', {
          signal,
          query: { mine: 'true', year: y },
        }),
      ]);
      return {
        types: types.items
          .filter((t) => t.active)
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
        settings,
        balances: balances.items,
        requests: [...requests.items].sort((a, b) => b.fromDate.localeCompare(a.fromDate)),
      };
    },
  });
}

export function useApplyLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: {
      typeCode: string;
      fromDate: string;
      toDate: string;
      half: 'am' | 'pm' | null;
      reason: string | null;
    }) => apiFetch<LeaveReq>('/v1/leave/requests', { method: 'POST', body: b }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  });
}

export function useCancelLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string | null }) =>
      apiFetch<LeaveReq>(`/v1/leave/requests/${id}/cancel`, { method: 'POST', body: { reason } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  });
}

/** Team requests waiting for a decision (web approvals.tsx: status=pending, mine=false). */
export function useLeaveQueue(myId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: [...key, 'queue', myId],
    enabled: enabled && !!myId,
    queryFn: ({ signal }) =>
      apiFetch<{ items: LeaveReq[] }>('/v1/leave/requests', {
        signal,
        query: { status: 'pending', mine: 'false' },
      }).then((r) => r.items.filter((x) => x.userId !== myId)),
  });
}

export function useDecideLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      decision,
      comment,
    }: {
      id: string;
      decision: 'approve' | 'reject';
      comment?: string;
    }) =>
      apiFetch<LeaveReq>(`/v1/leave/requests/${id}/decision`, {
        method: 'POST',
        body: { decision, ...(comment ? { comment } : {}) },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ['approvals'] });
    },
  });
}
