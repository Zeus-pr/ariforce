import { http, HttpResponse } from 'msw';
import type * as z from 'zod';
import { AllowanceDraftRequest, AllowanceDraftResult } from '../schemas/allowances';
import type { AllowanceDay } from '../schemas/allowances';
import type { Me } from '../schemas/auth';
import { mockRateFor } from './allowances';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_MAX_FILES_PER_LINE,
  ExpenseAttachmentCreate,
  ExpenseAttachmentUpload,
  ExpenseClaim,
  ExpenseClaimCreate,
  ExpenseClaimList,
  ExpenseDecision,
  ExpenseDownload,
  ExpenseLineInput,
  ExpenseLineUpdate,
  ExpensePay,
  ExpenseReconciliation,
  ExpenseReport,
} from '../schemas/expenses';

/**
 * Mock expense claims (#52). Same states and error codes as the API. Simplifications: one approval
 * step (the API defaults to 2), any `expenses:approve` user may decide others' submitted claims,
 * uploads are confirmed without real bytes, and reconciliation flags only `no_dcr`.
 */
type Claim = z.infer<typeof ExpenseClaim>;
const claims: Claim[] = [];
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${(0xe00000000000 + ++seq).toString(16)}`;
const now = () => new Date().toISOString();
const e = (status: number, code: string, message: string) =>
  HttpResponse.json({ error: { code, message } }, { status });
const can = (p: Me, perm: string) => (p.permissions as string[]).includes(perm);
const total = (c: Claim) => Math.round(c.lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
const out = (c: Claim) => ExpenseClaim.parse({ ...c, total: total(c) });

export function expenseHandlers(baseUrl: string, who: (r: Request) => Me | undefined) {
  const B = `${baseUrl}/v1`;
  const auth = (request: Request) => {
    const p = who(request);
    return p ? { p } : { res: e(401, 'UNAUTHENTICATED', 'Sign in required') };
  };
  const visible = (p: Me, c: Claim) =>
    c.userId === p.id ||
    (can(p, 'expenses:approve') && c.status !== 'draft') ||
    (can(p, 'expenses:pay') && ['approved', 'paid'].includes(c.status));
  const get = (p: Me, id: string) => {
    const c = claims.find((x) => x.id === id);
    return c && visible(p, c) ? c : undefined;
  };
  const editable = (p: Me, id: string) => {
    const c = get(p, id);
    if (!c) return { res: e(404, 'NOT_FOUND', 'Expense claim not found') };
    if (c.userId !== p.id) return { res: e(403, 'FORBIDDEN', 'Only the owner can edit a claim') };
    if (!['draft', 'rejected'].includes(c.status))
      return { res: e(409, 'EXPENSE_NOT_EDITABLE', `Claim is ${c.status}`) };
    return { c };
  };
  const findAtt = (p: Me, id: string) => {
    for (const c of claims)
      for (const l of c.lines) {
        const a = l.attachments.find((x) => x.id === id);
        if (a && visible(p, c)) return { c, l, a };
      }
    return undefined;
  };
  const recon = (c: Claim) => {
    const byDate = new Map<string, { claimed: number; lineCount: number }>();
    for (const l of c.lines) {
      const d = byDate.get(l.date) ?? { claimed: 0, lineCount: 0 };
      byDate.set(l.date, { claimed: d.claimed + l.amount, lineCount: d.lineCount + 1 });
    }
    const days = [...byDate].map(([date, d]) => ({
      date,
      ...d,
      dcrId: null,
      dcrStatus: null,
      flags: ['no_dcr' as const],
    }));
    const byCategory = Object.fromEntries(
      EXPENSE_CATEGORIES.map((k) => [
        k,
        c.lines.filter((l) => l.category === k).reduce((s, l) => s + l.amount, 0),
      ]),
    );
    return ExpenseReconciliation.parse({
      claimId: c.id,
      userId: c.userId,
      month: c.month,
      total: total(c),
      claimedDays: days.length,
      dcrDays: 0,
      matchedDays: 0,
      unmatchedAmount: total(c),
      byCategory,
      days,
    });
  };

  return [
    http.get(`${B}/expense-claims`, ({ request }) => {
      const g = auth(request);
      if (g.res) return g.res;
      const q = new URL(request.url).searchParams;
      const items = claims
        .filter((c) => visible(g.p, c))
        .filter((c) => !q.get('month') || c.month === q.get('month'))
        .filter((c) => !q.get('status') || c.status === q.get('status'))
        .filter((c) => !q.get('userId') || c.userId === q.get('userId'))
        .map(({ lines, ...c }) => ({
          ...c,
          total: total({ ...c, lines } as Claim),
          lineCount: lines.length,
        }));
      return HttpResponse.json(ExpenseClaimList.parse({ items }));
    }),
    http.post(`${B}/expense-claims`, async ({ request }) => {
      const g = auth(request);
      if (g.res) return g.res;
      if (!can(g.p, 'expenses:write')) return e(403, 'FORBIDDEN', 'Missing expenses:write');
      const b = ExpenseClaimCreate.safeParse(await request.json().catch(() => null));
      if (!b.success) return e(422, 'VALIDATION', 'Invalid');
      if (b.data.month > now().slice(0, 7))
        return e(422, 'VALIDATION', 'Cannot claim for a future month');
      const found = claims.find((c) => c.userId === g.p.id && c.month === b.data.month);
      if (found) return HttpResponse.json(out(found), { status: 200 });
      const c: Claim = {
        id: uuid(),
        userId: g.p.id,
        userName: g.p.name,
        month: b.data.month,
        status: 'draft',
        total: 0,
        currency: 'INR',
        lines: [],
        approvalId: null,
        approvalStep: null,
        submittedAt: null,
        decidedAt: null,
        decidedBy: null,
        decisionComment: null,
        rejectionReason: null,
        rejectedBy: null,
        rejectedAt: null,
        paidAt: null,
        paymentRef: null,
        dcrRejectedDates: [],
        version: 1,
      };
      claims.push(c);
      return HttpResponse.json(out(c), { status: 201 });
    }),
    http.get(`${B}/expense-claims/:id`, ({ request, params }) => {
      const g = auth(request);
      if (g.res) return g.res;
      const c = get(g.p, String(params.id));
      return c ? HttpResponse.json(out(c)) : e(404, 'NOT_FOUND', 'Expense claim not found');
    }),
    http.post(`${B}/expense-claims/:id/lines`, async ({ request, params }) => {
      const g = auth(request);
      if (g.res) return g.res;
      const f = editable(g.p, String(params.id));
      if (f.res) return f.res;
      const b = ExpenseLineInput.safeParse(await request.json().catch(() => null));
      if (!b.success) return e(422, 'VALIDATION', b.error.issues[0]?.message ?? 'Invalid');
      if (!b.data.date.startsWith(f.c.month))
        return e(422, 'VALIDATION', `date must be in ${f.c.month}`);
      const line = {
        ...b.data,
        id: uuid(),
        claimId: f.c.id,
        source: 'manual' as const,
        allowancePlaceId: null,
        autoTrigger: null,
        dcrRejectedAt: null,
        attachments: [],
        version: 1,
      };
      f.c.lines.push(line);
      return HttpResponse.json(out(f.c), { status: 201 });
    }),
    http.put(`${B}/expense-claims/:id/lines/:lineId`, async ({ request, params }) => {
      const g = auth(request);
      if (g.res) return g.res;
      const f = editable(g.p, String(params.id));
      if (f.res) return f.res;
      const l = f.c.lines.find((x) => x.id === params.lineId);
      if (!l) return e(404, 'NOT_FOUND', 'Line not found');
      const b = ExpenseLineUpdate.safeParse(await request.json().catch(() => null));
      if (!b.success) return e(422, 'VALIDATION', 'Invalid');
      if (b.data.version !== l.version) return e(409, 'VERSION_CONFLICT', 'Stale version');
      Object.assign(l, b.data.line, { source: 'manual', version: l.version + 1 });
      return HttpResponse.json(out(f.c));
    }),
    http.delete(`${B}/expense-claims/:id/lines/:lineId`, ({ request, params }) => {
      const g = auth(request);
      if (g.res) return g.res;
      const f = editable(g.p, String(params.id));
      if (f.res) return f.res;
      f.c.lines = f.c.lines.filter((x) => x.id !== params.lineId);
      return HttpResponse.json(out(f.c));
    }),
    http.post(`${B}/expense-claims/:id/lines/:lineId/attachments`, async ({ request, params }) => {
      const g = auth(request);
      if (g.res) return g.res;
      const f = editable(g.p, String(params.id));
      if (f.res) return f.res;
      const l = f.c.lines.find((x) => x.id === params.lineId);
      if (!l) return e(404, 'NOT_FOUND', 'Line not found');
      const b = ExpenseAttachmentCreate.safeParse(await request.json().catch(() => null));
      if (!b.success) return e(422, 'VALIDATION', b.error.issues[0]?.message ?? 'Invalid');
      if (l.attachments.length >= EXPENSE_MAX_FILES_PER_LINE)
        return e(422, 'TOO_MANY_FILES', `At most ${EXPENSE_MAX_FILES_PER_LINE} files per line`);
      const a = {
        id: uuid(),
        lineId: l.id,
        contentType: b.data.contentType,
        sizeBytes: b.data.sizeBytes,
        status: 'pending' as const,
        createdAt: now(),
        confirmedAt: null,
      };
      l.attachments.push(a);
      l.source = 'manual'; // a receipt makes an auto line manual (as the API)
      return HttpResponse.json(
        ExpenseAttachmentUpload.parse({
          attachment: a,
          uploadUrl: `${baseUrl}/mock-r2/${a.id}`,
          method: 'PUT',
          headers: { 'content-type': a.contentType },
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        }),
        { status: 201 },
      );
    }),
    http.put(`${baseUrl}/mock-r2/:id`, () => new HttpResponse(null, { status: 200 })),
    http.post(`${B}/expense-attachments/:id/confirm`, ({ request, params }) => {
      const g = auth(request);
      if (g.res) return g.res;
      const f = findAtt(g.p, String(params.id));
      if (!f) return e(404, 'NOT_FOUND', 'Attachment not found');
      if (!['draft', 'rejected'].includes(f.c.status))
        return e(409, 'EXPENSE_NOT_EDITABLE', `Claim is ${f.c.status}`);
      Object.assign(f.a, { status: 'confirmed', confirmedAt: now() });
      return HttpResponse.json(f.a);
    }),
    http.delete(`${B}/expense-attachments/:id`, ({ request, params }) => {
      const g = auth(request);
      if (g.res) return g.res;
      const f = findAtt(g.p, String(params.id));
      if (!f) return e(404, 'NOT_FOUND', 'Attachment not found');
      if (!['draft', 'rejected'].includes(f.c.status))
        return e(409, 'EXPENSE_NOT_EDITABLE', `Claim is ${f.c.status}`);
      f.l.attachments = f.l.attachments.filter((x) => x.id !== f.a.id);
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(`${B}/expense-attachments/:id/download-url`, ({ request, params }) => {
      const g = auth(request);
      if (g.res) return g.res;
      const f = findAtt(g.p, String(params.id));
      if (!f) return e(404, 'NOT_FOUND', 'Attachment not found');
      if (f.a.status !== 'confirmed') return e(409, 'UPLOAD_NOT_CONFIRMED', 'Not confirmed yet');
      return HttpResponse.json(
        ExpenseDownload.parse({
          downloadUrl: `${baseUrl}/mock-r2/${f.a.id}`,
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        }),
      );
    }),
    // TA/DA draft (#39). Mock: every weekday of the month up to today is an HQ day of a submitted
    // DCR; DA + flat TA from the HQ rate. Fare-chart places are accepted but not used.
    http.post(`${B}/expense-claims/:id/allowances`, async ({ request, params }) => {
      const g = auth(request);
      if (g.res) return g.res;
      const f = editable(g.p, String(params.id));
      if (f.res) return f.res;
      const b = AllowanceDraftRequest.safeParse((await request.json().catch(() => null)) ?? {});
      if (!b.success) return e(422, 'VALIDATION', b.error.issues[0]?.message ?? 'Invalid');
      const today = new Date().toISOString().slice(0, 10);
      const [y, m] = f.c.month.split('-').map(Number) as [number, number];
      const days: AllowanceDay[] = [];
      const lines: Claim['lines'] = [];
      for (let d = 1; d <= new Date(Date.UTC(y, m, 0)).getUTCDate(); d++) {
        const dt = new Date(Date.UTC(y, m - 1, d));
        const date = dt.toISOString().slice(0, 10);
        if (date > today || dt.getUTCDay() === 0) continue;
        const rate = mockRateFor('hq', g.p.roles[0] ?? null, date);
        const day: AllowanceDay = {
          date,
          dcrId: uuid(),
          workTypeCode: 'FIELD',
          band: 'hq',
          rateId: rate?.id ?? null,
          placeId: null,
          placeName: null,
          km: null,
          da: 0,
          ta: 0,
          issues: [],
        };
        const manual = f.c.lines.some(
          (l) =>
            l.date === date &&
            l.source === 'manual' &&
            ['allowance', 'mileage'].includes(l.category),
        );
        if (manual) day.issues.push('manual_line_exists');
        else if (!rate) day.issues.push('no_rate');
        else {
          day.da = rate.daAmount;
          day.ta = rate.taFixed;
          const base = { date, notes: null, mileageKm: null, dcrId: day.dcrId, tourPlanId: null };
          const auto = {
            claimId: f.c.id,
            source: 'auto' as const,
            allowancePlaceId: null,
            autoTrigger: 'allowances_run' as const,
            dcrRejectedAt: null,
          };
          if (day.da)
            lines.push({
              ...base,
              ...auto,
              id: uuid(),
              category: 'allowance',
              amount: day.da,
              notes: 'DA (HQ)',
              attachments: [],
              version: 1,
            });
          if (day.ta)
            lines.push({
              ...base,
              ...auto,
              id: uuid(),
              category: 'travel',
              amount: day.ta,
              notes: 'TA (HQ)',
              attachments: [],
              version: 1,
            });
        }
        days.push(day);
      }
      if (!b.data.dryRun) f.c.lines = [...f.c.lines.filter((l) => l.source !== 'auto'), ...lines];
      const sum = (k: 'da' | 'ta') => Math.round(days.reduce((s2, d) => s2 + d[k], 0) * 100) / 100;
      return HttpResponse.json(
        AllowanceDraftResult.parse({
          dryRun: b.data.dryRun,
          days,
          totals: { da: sum('da'), ta: sum('ta'), km: 0, lines: lines.length },
          claim: b.data.dryRun ? null : out(f.c),
        }),
      );
    }),
    http.post(`${B}/expense-claims/:id/submit`, ({ request, params }) => {
      const g = auth(request);
      if (g.res) return g.res;
      const f = editable(g.p, String(params.id));
      if (f.res) return f.res;
      if (!f.c.lines.length) return e(422, 'EXPENSE_EMPTY', 'Add at least one line first');
      if (
        f.c.lines.some(
          (l) => l.category === 'hotel' && !l.attachments.some((a) => a.status === 'confirmed'),
        )
      )
        return e(422, 'RECEIPT_REQUIRED', 'Hotel lines need a confirmed receipt');
      Object.assign(f.c, {
        status: 'submitted',
        submittedAt: now(),
        approvalId: uuid(),
        approvalStep: 1,
        rejectionReason: null,
        rejectedBy: null,
        rejectedAt: null,
        version: f.c.version + 1,
      });
      return HttpResponse.json(out(f.c));
    }),
    http.post(`${B}/expense-claims/:id/decision`, async ({ request, params }) => {
      const g = auth(request);
      if (g.res) return g.res;
      if (!can(g.p, 'expenses:approve')) return e(403, 'FORBIDDEN', 'Missing expenses:approve');
      const c = get(g.p, String(params.id));
      if (!c) return e(404, 'NOT_FOUND', 'Expense claim not found');
      if (c.userId === g.p.id) return e(403, 'FORBIDDEN', 'You cannot decide your own claim');
      if (c.status !== 'submitted') return e(409, 'CONFLICT', `Claim is ${c.status}`);
      const b = ExpenseDecision.safeParse(await request.json().catch(() => null));
      if (!b.success) return e(422, 'VALIDATION', 'Invalid decision');
      const rej = b.data.decision === 'reject';
      if (rej && !b.data.comment)
        return e(422, 'REJECTION_REASON_REQUIRED', 'A reason is required to reject');
      const at = now();
      Object.assign(c, {
        status: rej ? 'rejected' : 'approved',
        decidedAt: at,
        decidedBy: g.p.id,
        decisionComment: b.data.comment || null,
        rejectionReason: rej ? b.data.comment! : null,
        rejectedBy: rej ? { id: g.p.id, name: g.p.name } : null,
        rejectedAt: rej ? at : null,
        version: c.version + 1,
      });
      return HttpResponse.json(out(c));
    }),
    http.post(`${B}/expense-claims/:id/pay`, async ({ request, params }) => {
      const g = auth(request);
      if (g.res) return g.res;
      if (!can(g.p, 'expenses:pay')) return e(403, 'FORBIDDEN', 'Missing expenses:pay');
      const c = get(g.p, String(params.id));
      if (!c) return e(404, 'NOT_FOUND', 'Expense claim not found');
      if (c.status !== 'approved') return e(409, 'CONFLICT', `Claim is ${c.status}`);
      const b = ExpensePay.safeParse(await request.json().catch(() => null));
      if (!b.success) return e(422, 'VALIDATION', 'paymentRef required');
      Object.assign(c, { status: 'paid', paidAt: now(), paymentRef: b.data.paymentRef });
      return HttpResponse.json(out(c));
    }),
    http.get(`${B}/expense-claims/:id/reconciliation`, ({ request, params }) => {
      const g = auth(request);
      if (g.res) return g.res;
      const c = get(g.p, String(params.id));
      return c ? HttpResponse.json(recon(c)) : e(404, 'NOT_FOUND', 'Expense claim not found');
    }),
    http.get(`${B}/expense-reports`, ({ request }) => {
      const g = auth(request);
      if (g.res) return g.res;
      const month = new URL(request.url).searchParams.get('month');
      if (!month) return e(422, 'VALIDATION', 'month is required');
      const rows = claims
        .filter((c) => c.month === month && visible(g.p, c))
        .map((c) => {
          const { days: _d, ...r } = recon(c);
          return { ...r, userName: c.userName, status: c.status };
        });
      const byCategory = Object.fromEntries(
        EXPENSE_CATEGORIES.map((k) => [k, rows.reduce((s, r) => s + (r.byCategory[k] ?? 0), 0)]),
      );
      return HttpResponse.json(
        ExpenseReport.parse({
          month,
          rows,
          total: rows.reduce((s, r) => s + r.total, 0),
          byCategory,
        }),
      );
    }),
    http.get(`${B}/expense-reports/export`, ({ request }) => {
      const g = auth(request);
      if (g.res) return g.res;
      const q = new URL(request.url).searchParams;
      const format = q.get('format');
      if (!q.get('month') || (format !== 'xlsx' && format !== 'pdf'))
        return e(422, 'VALIDATION', 'month and format=xlsx|pdf are required');
      const type =
        format === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      return new HttpResponse(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
        headers: {
          'content-type': type,
          'content-disposition': `attachment; filename="expenses-${q.get('month')}.${format}"`,
        },
      });
    }),
  ];
}
