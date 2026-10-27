import { LEAVE_DEFAULT_BACKDATE_DAYS } from '../schemas/leave';
import { http, HttpResponse } from 'msw';
import type * as z from 'zod';
import type { Me } from '../schemas/auth';
import {
  LeaveApply,
  LeaveBalance,
  LeaveCalendar,
  LeaveCancel,
  LeaveDecision,
  LeaveGrant,
  LeaveGrantCreate,
  LeaveRequest,
  LeaveSettings,
  LeaveType,
} from '../schemas/leave';

/**
 * Mock leave (#51). Same states, defaults and error codes as the API. Simplifications: one approval
 * step (the API defaults to 2 via leave_settings), any `leave:approve` user may decide/cancel/grant
 * for others, no DCR conflict check, and the backdate window is not enforced.
 */
type Req = z.infer<typeof LeaveRequest>;
type Type = z.infer<typeof LeaveType>;
const types: Type[] = [
  ['CL', 'Casual leave', true, 12, false, null, false],
  ['SL', 'Sick leave', true, 12, false, null, false],
  ['EL', 'Earned leave', true, 15, true, 30, false],
  ['LOP', 'Loss of pay (unpaid)', false, null, false, null, false],
  ['COMP', 'Compensatory off', true, 0, false, null, true],
].map(([code, name, paid, q, cf, cap, g], i) => ({
  code: code as string,
  name: name as string,
  paid: paid as boolean,
  annualQuota: q as number | null,
  carryForward: cf as boolean,
  carryForwardCap: cap as number | null,
  halfDayAllowed: true,
  grantOnly: g as boolean,
  active: true,
  sortOrder: i + 1,
  version: 1,
}));
const settings: z.infer<typeof LeaveSettings> = {
  approvalLevels: 2,
  backdateDays: LEAVE_DEFAULT_BACKDATE_DAYS,
  weeklyOffDays: [0],
  maxFutureDays: null,
  version: 1,
};
const requests: Req[] = [];
const grants: z.infer<typeof LeaveGrant>[] = [];
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${(0xf00000000000 + ++seq).toString(16)}`;
const now = () => new Date().toISOString();
const e = (status: number, code: string, message: string, details?: unknown) =>
  HttpResponse.json({ error: { code, message, details } }, { status });
const can = (p: Me, perm: string) => (p.permissions as string[]).includes(perm);
const addDay = (d: string, n = 1) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const counted = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDay(d))
    if (!settings.weeklyOffDays.includes(new Date(`${d}T00:00:00Z`).getUTCDay())) out.push(d);
  return out;
};

/** Weekly off from the mock leave settings (tour-plan submit rule). */
export const mockWeeklyOffDays = () => [...settings.weeklyOffDays];

/** Approved mock leave for attendance mocks. */
export function mockLeaveOn(userId: string, date: string) {
  const r = requests.find(
    (x) =>
      x.userId === userId &&
      x.status === 'approved' &&
      x.fromDate <= date &&
      x.toDate >= date &&
      counted(date, date).length,
  );
  return r ? { requestId: r.id, typeCode: r.typeCode, half: r.half } : null;
}

function balance(userId: string, year: number) {
  return LeaveBalance.parse({
    userId,
    year,
    items: types
      .filter((t) => t.active)
      .map((t) => {
        const unlimited = t.annualQuota === null && !t.grantOnly;
        const gs = grants.filter(
          (g) => g.userId === userId && g.year === year && g.typeCode === t.code,
        );
        const sum = (k: string[]) =>
          gs.filter((g) => k.includes(g.kind)).reduce((s, g) => s + g.days, 0);
        const rs = (st: string) =>
          requests
            .filter(
              (r) =>
                r.userId === userId && r.year === year && r.typeCode === t.code && r.status === st,
            )
            .reduce((s, r) => s + r.days, 0);
        const carriedForward = sum(['carry_forward']);
        const opening = sum(['opening']) + carriedForward;
        const quota = unlimited ? null : t.grantOnly ? 0 : t.annualQuota!;
        const granted = sum(['grant', 'adjustment']);
        const used = rs('approved');
        const pending = rs('pending');
        return {
          typeCode: t.code,
          typeName: t.name,
          paid: t.paid,
          unlimited,
          opening,
          carriedForward,
          quota,
          granted,
          used,
          pending,
          available: unlimited ? null : opening + (quota ?? 0) + granted - used - pending,
        };
      }),
  });
}

export function leaveHandlers(baseUrl: string, who: (r: Request) => Me | undefined) {
  const B = `${baseUrl}/v1/leave`;
  const auth = (request: Request, perm?: string) => {
    const p = who(request);
    if (!p) return { res: e(401, 'UNAUTHENTICATED', 'Sign in required') };
    if (perm && !can(p, perm)) return { res: e(403, 'FORBIDDEN', `Missing permission: ${perm}`) };
    return { p };
  };
  const visible = (p: Me, r: Req) => r.userId === p.id || can(p, 'leave:approve');
  const find = (p: Me, id: string) => {
    const r = requests.find((x) => x.id === id);
    return r && visible(p, r) ? r : undefined;
  };
  return [
    http.get(`${B}/types`, ({ request }) => {
      const a = auth(request);
      return a.res ?? HttpResponse.json({ items: types });
    }),
    http.get(`${B}/settings`, ({ request }) => {
      const a = auth(request);
      return a.res ?? HttpResponse.json(settings);
    }),
    http.get(`${B}/balances`, ({ request }) => {
      const a = auth(request, 'leave:read');
      if (a.res) return a.res;
      const sp = new URL(request.url).searchParams;
      const userId = sp.get('userId') ?? a.p.id;
      if (userId !== a.p.id && !can(a.p, 'leave:approve'))
        return e(404, 'NOT_FOUND', 'User not found');
      return HttpResponse.json(balance(userId, Number(sp.get('year') ?? new Date().getFullYear())));
    }),
    http.get(`${B}/requests`, ({ request }) => {
      const a = auth(request, 'leave:read');
      if (a.res) return a.res;
      const sp = new URL(request.url).searchParams;
      const items = requests.filter(
        (r) =>
          visible(a.p, r) &&
          (sp.get('mine') !== 'true' || r.userId === a.p.id) &&
          (!sp.get('status') || r.status === sp.get('status')) &&
          (!sp.get('userId') || r.userId === sp.get('userId')),
      );
      return HttpResponse.json({ items });
    }),
    http.post(`${B}/requests`, async ({ request }) => {
      const a = auth(request, 'leave:write');
      if (a.res) return a.res;
      const parsed = LeaveApply.safeParse(await request.json());
      if (!parsed.success) return e(422, 'VALIDATION', parsed.error.message);
      const b = parsed.data;
      const t = types.find((x) => x.code === b.typeCode && x.active);
      if (!t) return e(422, 'LEAVE_TYPE_UNKNOWN', `Unknown or inactive leave type ${b.typeCode}`);
      if (b.fromDate.slice(0, 4) !== b.toDate.slice(0, 4))
        return e(422, 'LEAVE_SPANS_YEARS', 'Split leave that crosses 31 Dec into two requests');
      const dates = counted(b.fromDate, b.toDate);
      if (!dates.length)
        return e(422, 'LEAVE_NO_WORKING_DAYS', 'All selected dates are weekly offs');
      const days = b.half ? 0.5 : dates.length;
      const clash = requests.filter(
        (r) =>
          r.userId === a.p.id &&
          ['pending', 'approved'].includes(r.status) &&
          r.fromDate <= b.toDate &&
          r.toDate >= b.fromDate &&
          !(b.half && r.half && r.half !== b.half),
      );
      if (clash.length)
        return e(409, 'LEAVE_OVERLAP', 'You already have leave on some of these dates', {
          requestIds: clash.map((c) => c.id),
        });
      const year = Number(b.fromDate.slice(0, 4));
      const av = balance(a.p.id, year).items.find((i) => i.typeCode === t.code)!.available;
      if (av !== null && av < days)
        return e(422, 'LEAVE_INSUFFICIENT_BALANCE', `Only ${av} day(s) of ${t.code} left`, {
          available: av,
          requested: days,
        });
      const r: Req = {
        id: uuid(),
        userId: a.p.id,
        userName: a.p.name,
        typeCode: t.code,
        typeName: t.name,
        paid: t.paid,
        year,
        fromDate: b.fromDate,
        toDate: b.toDate,
        half: b.half,
        days,
        reason: b.reason,
        status: 'pending',
        approvalId: uuid(),
        approvalStep: 1,
        createdAt: now(),
        decidedAt: null,
        decidedBy: null,
        decisionComment: null,
        cancelledAt: null,
        cancelledBy: null,
        cancelReason: null,
        version: 1,
      };
      requests.push(r);
      return HttpResponse.json(LeaveRequest.parse(r), { status: 201 });
    }),
    http.get(`${B}/requests/:id`, ({ request, params }) => {
      const a = auth(request, 'leave:read');
      if (a.res) return a.res;
      const r = find(a.p, String(params.id));
      return r ? HttpResponse.json(r) : e(404, 'NOT_FOUND', 'Leave request not found');
    }),
    http.post(`${B}/requests/:id/decision`, async ({ request, params }) => {
      const a = auth(request, 'leave:approve');
      if (a.res) return a.res;
      const r = find(a.p, String(params.id));
      if (!r) return e(404, 'NOT_FOUND', 'Leave request not found');
      if (r.userId === a.p.id) return e(403, 'FORBIDDEN', 'You cannot decide your own request');
      if (r.status !== 'pending') return e(409, 'CONFLICT', `Leave is ${r.status}`);
      const d = LeaveDecision.safeParse(await request.json());
      if (!d.success) return e(422, 'VALIDATION', d.error.message);
      Object.assign(r, {
        status: d.data.decision === 'approve' ? 'approved' : 'rejected',
        approvalStep: null,
        decidedAt: now(),
        decidedBy: a.p.id,
        decisionComment: d.data.comment ?? null,
        version: r.version + 1,
      });
      return HttpResponse.json(r);
    }),
    http.post(`${B}/requests/:id/cancel`, async ({ request, params }) => {
      const a = auth(request, 'leave:read');
      if (a.res) return a.res;
      const r = find(a.p, String(params.id));
      if (!r) return e(404, 'NOT_FOUND', 'Leave request not found');
      if (!['pending', 'approved'].includes(r.status))
        return e(409, 'LEAVE_NOT_CANCELLABLE', `Leave is ${r.status}`);
      const today = now().slice(0, 10);
      if (r.userId === a.p.id && r.status === 'approved' && r.fromDate <= today)
        return e(
          409,
          'LEAVE_NOT_CANCELLABLE',
          'Approved leave that has started can only be cancelled by your manager',
        );
      if (r.userId !== a.p.id && !can(a.p, 'leave:approve'))
        return e(403, 'FORBIDDEN', 'Only the owner or a manager above them can cancel');
      const b = LeaveCancel.parse(await request.json().catch(() => ({})));
      Object.assign(r, {
        status: 'cancelled',
        approvalStep: null,
        cancelledAt: now(),
        cancelledBy: a.p.id,
        cancelReason: b.reason,
        version: r.version + 1,
      });
      return HttpResponse.json(r);
    }),
    http.get(`${B}/grants`, ({ request }) => {
      const a = auth(request, 'leave:read');
      if (a.res) return a.res;
      const userId = new URL(request.url).searchParams.get('userId') ?? a.p.id;
      return HttpResponse.json({ items: grants.filter((g) => g.userId === userId) });
    }),
    http.post(`${B}/grants`, async ({ request }) => {
      const a = auth(request, 'leave:approve');
      if (a.res) return a.res;
      const g = LeaveGrantCreate.safeParse(await request.json());
      if (!g.success) return e(422, 'VALIDATION', g.error.message);
      if (g.data.userId === a.p.id)
        return e(403, 'LEAVE_SELF_GRANT', 'You cannot grant leave to yourself');
      if (!types.some((t) => t.code === g.data.typeCode))
        return e(422, 'LEAVE_TYPE_UNKNOWN', `Unknown leave type ${g.data.typeCode}`);
      const row = LeaveGrant.parse({ ...g.data, id: uuid(), grantedBy: a.p.id, createdAt: now() });
      grants.push(row);
      return HttpResponse.json(row, { status: 201 });
    }),
    http.get(`${B}/calendar`, ({ request }) => {
      const a = auth(request, 'leave:read');
      if (a.res) return a.res;
      const sp = new URL(request.url).searchParams;
      const from = sp.get('from') ?? now().slice(0, 10);
      const to = sp.get('to') ?? from;
      const st = sp.get('includePending') === 'true' ? ['pending', 'approved'] : ['approved'];
      const items = requests
        .filter(
          (r) =>
            st.includes(r.status) &&
            r.fromDate <= to &&
            r.toDate >= from &&
            (can(a.p, 'leave:approve') || r.userId === a.p.id) &&
            (!sp.get('userId') || r.userId === sp.get('userId')),
        )
        .map((r) => ({
          requestId: r.id,
          userId: r.userId,
          userName: r.userName,
          typeCode: r.typeCode,
          status: r.status,
          fromDate: r.fromDate,
          toDate: r.toDate,
          half: r.half,
          dates: counted(r.fromDate > from ? r.fromDate : from, r.toDate < to ? r.toDate : to),
        }));
      return HttpResponse.json(LeaveCalendar.parse({ from, to, items }));
    }),
  ];
}
