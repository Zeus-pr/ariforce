import { http, HttpResponse } from 'msw';
import type { Me } from '../schemas/auth';
import {
  EXCEPTION_RULE_CODES,
  EXCEPTION_RULES,
  ExceptionEvaluateRequest,
  ExceptionItem,
  ExceptionListQuery,
  ExceptionNote,
  ExceptionRule,
  ExceptionRuleUpdate,
  ExceptionSummary,
  ExceptionUpdate,
  SEVERITY_RANK,
  type ExceptionRuleCode,
  type ProfileExceptions,
} from '../schemas/exceptions';
import * as fx from './fixtures';

/**
 * Mock exceptions (#56). Same shapes, permissions and error codes as the API. Simplifications: a
 * fixed seed set instead of the daily engine, evaluate only acknowledges the request, scope is the
 * mockUsers manager chain (no-territory/top roles see everyone), and the cursor is an offset.
 */
type Item = ExceptionItem;
const can = (p: Me, perm: string) => (p.permissions as string[]).includes(perm);
const e = (status: number, code: string, message: string, details?: unknown) =>
  HttpResponse.json({ error: { code, message, details } }, { status });
const now = () => new Date().toISOString();
const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const byId = (id: string) => fx.mockUsers.find((u) => u.id === id);
const ref = (id: string | null) => {
  const u = id ? byId(id) : undefined;
  return u ? { id: u.id, name: u.name } : null;
};

const overrides = new Map<ExceptionRuleCode, ExceptionRule>();
const rule = (code: ExceptionRuleCode): ExceptionRule => {
  const o = overrides.get(code);
  if (o) return o;
  const d = EXCEPTION_RULES[code];
  return {
    code,
    name: d.name,
    description: d.description,
    grain: d.grain,
    enabled: true,
    severity: d.severity,
    threshold: d.threshold,
    thresholdUnit: d.thresholdUnit,
    action: d.action,
    isDefault: true,
    version: null,
  };
};

const bm = fx.mockUsers.find((u) => u.roles[0] === 'business_manager')!;
let seq = 0;
const mk = (code: ExceptionRuleCode, ago: number, value: number | null, context = {}): Item => {
  const r = rule(code);
  const t = now();
  return {
    id: `00000000-0000-4000-8000-${(0xe00000000000 + ++seq).toString(16)}`,
    ruleCode: code,
    ruleName: r.name,
    severity: r.severity,
    status: 'open',
    periodDate: day(ago),
    user: { id: bm.id, name: bm.name },
    assignee: ref(bm.managerId),
    followUpOn: null,
    value,
    threshold: r.threshold,
    context,
    suggestedAction: r.action,
    explanation: null,
    explainedAt: null,
    resolutionNote: null,
    resolvedBy: null,
    resolvedAt: null,
    autoResolved: false,
    createdAt: t,
    updatedAt: t,
    version: 1,
  };
};
const items: Item[] = [
  mk('dcr_missing', 1, null, { lockPassed: true }),
  mk('low_call_average', 2, 5, { doctorCalls: 5 }),
  mk('geofence_breach', 2, 1, { visits: 6, outOfFence: 1, mockLocation: 0 }),
  mk('dcr_late', 3, 30, { hoursLate: 30 }),
];

const subtree = (rootId: string) => {
  const out = new Set([rootId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const u of fx.mockUsers)
      if (u.managerId && out.has(u.managerId) && !out.has(u.id)) {
        out.add(u.id);
        grew = true;
      }
  }
  return out;
};
const wide = (p: Me) => p.managerId === null && p.territoryIds.length > 0;
const closed = (it: Item) => it.status === 'resolved' || it.status === 'dismissed';
const visible = (p: Me, it: Item) => wide(p) || subtree(p.id).has(it.user.id);

/** TeamProfile.exceptions for the team profile mock. */
export function mockProfileExceptions(userId: string): ProfileExceptions {
  const mine = items.filter((x) => x.user.id === userId);
  const open = mine.filter((x) => x.status === 'open' || x.status === 'acknowledged');
  const recent = mine.filter((x) => x.periodDate >= day(30));
  return {
    open: open.length,
    openHigh: open.filter((x) => x.severity === 'high').length,
    last30Days: recent.length,
    byRule: EXCEPTION_RULE_CODES.map((ruleCode) => ({
      ruleCode,
      count: recent.filter((x) => x.ruleCode === ruleCode).length,
    })).filter((r) => r.count > 0),
  };
}

export function exceptionHandlers(baseUrl: string, who: (r: Request) => Me | undefined) {
  const B = `${baseUrl}/v1/exceptions`;
  const auth = (request: Request, perm: string) => {
    const p = who(request);
    if (!p) return { res: e(401, 'UNAUTHENTICATED', 'Sign in required') };
    if (perm && !can(p, perm)) return { res: e(403, 'FORBIDDEN', `Missing permission: ${perm}`) };
    return { p };
  };
  const body = async (request: Request) => request.json().catch(() => ({}));
  const editable = (request: Request, id: string, v?: number) => {
    const a = auth(request, 'approvals:decide');
    if (a.res) return { res: a.res };
    const it = items.find((x) => x.id === id && visible(a.p, x));
    if (!it) return { res: e(404, 'NOT_FOUND', 'Exception not found') };
    if (it.user.id === a.p.id)
      return {
        res: e(403, 'FORBIDDEN', 'You cannot resolve, dismiss or assign your own exceptions'),
      };
    if (v !== undefined && v !== it.version)
      return { res: e(409, 'VERSION_CONFLICT', 'Exception was changed by someone else') };
    return { it, p: a.p };
  };
  const touch = (it: Item) => {
    it.version += 1;
    it.updatedAt = now();
    return HttpResponse.json(ExceptionItem.parse(it));
  };
  /** GET /v1/exceptions (field:read, your scope) and GET /v1/me/exceptions (any user, your own rows). */
  const listFor = (request: Request, self: boolean) => {
    const a = auth(request, self ? '' : 'field:read');
    if (a.res) return a.res;
    const q = ExceptionListQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!q.success) return e(422, 'VALIDATION', q.error.message);
    const f = q.data;
    const rows = items
      .filter(
        (x) =>
          (self ? x.user.id === a.p.id : visible(a.p, x)) &&
          (!f.status || f.status.includes(x.status)) &&
          (!f.severity || f.severity.includes(x.severity)) &&
          (!f.ruleCode || f.ruleCode.includes(x.ruleCode)) &&
          (self || !f.userId || x.user.id === f.userId) &&
          (self || f.assignedToMe !== 'true' || x.assignee?.id === a.p.id) &&
          (!f.from || x.periodDate >= f.from) &&
          (!f.to || x.periodDate <= f.to),
      )
      .sort(
        (x, y) =>
          SEVERITY_RANK[y.severity] - SEVERITY_RANK[x.severity] ||
          y.periodDate.localeCompare(x.periodDate) ||
          y.id.localeCompare(x.id),
      );
    const off = Number(f.cursor ?? 0) || 0;
    const lim = f.limit ?? 50;
    return HttpResponse.json({
      items: rows.slice(off, off + lim),
      nextCursor: off + lim < rows.length ? String(off + lim) : null,
      serverTime: now(),
    });
  };
  const close = (status: 'resolved' | 'dismissed') =>
    http.post(
      `${B}/:id/${status === 'resolved' ? 'resolve' : 'dismiss'}`,
      async ({ request, params }) => {
        const b = ExceptionNote.safeParse(await body(request));
        if (!b.success) return e(422, 'VALIDATION', b.error.message);
        const g = editable(request, String(params.id));
        if (g.res) return g.res;
        if (closed(g.it)) return e(409, 'EXCEPTION_CLOSED', `Exception is ${g.it.status}`);
        Object.assign(g.it, {
          status,
          resolutionNote: b.data.note,
          resolvedBy: ref(g.p.id),
          resolvedAt: now(),
          autoResolved: false,
        });
        return touch(g.it);
      },
    );

  return [
    http.get(`${B}/summary`, ({ request }) => {
      const a = auth(request, 'field:read');
      if (a.res) return a.res;
      const sp = Object.fromEntries(new URL(request.url).searchParams);
      const from = sp.from ?? day(30);
      const to = sp.to ?? day(0);
      const rows = items.filter(
        (x) =>
          visible(a.p, x) &&
          x.periodDate >= from &&
          x.periodDate <= to &&
          (!sp.userId || x.user.id === sp.userId),
      );
      const isOpen = (x: Item) => x.status === 'open' || x.status === 'acknowledged';
      const sev = (xs: Item[]) => ({
        low: xs.filter((x) => x.severity === 'low').length,
        medium: xs.filter((x) => x.severity === 'medium').length,
        high: xs.filter((x) => x.severity === 'high').length,
      });
      return HttpResponse.json(
        ExceptionSummary.parse({
          from,
          to,
          total: rows.length,
          open: rows.filter(isOpen).length,
          bySeverity: sev(rows),
          openBySeverity: sev(rows.filter(isOpen)),
          byRule: EXCEPTION_RULE_CODES.map((ruleCode) => {
            const rs = rows.filter((x) => x.ruleCode === ruleCode);
            return {
              ruleCode,
              severity: rule(ruleCode).severity,
              total: rs.length,
              open: rs.filter(isOpen).length,
            };
          }).filter((r) => r.total > 0),
        }),
      );
    }),
    http.get(`${baseUrl}/v1/me/exceptions`, ({ request }) => listFor(request, true)),
    http.get(B, ({ request }) => listFor(request, false)),
    http.get(`${B}/:id`, ({ request, params }) => {
      const a = auth(request, 'field:read');
      if (a.res) return a.res;
      const it = items.find((x) => x.id === params.id && visible(a.p, x));
      return it ? HttpResponse.json(it) : e(404, 'NOT_FOUND', 'Exception not found');
    }),
    http.post(`${B}/:id/explain`, async ({ request, params }) => {
      const a = auth(request, 'field:read');
      if (a.res) return a.res;
      const b = ExceptionNote.safeParse(await body(request));
      if (!b.success) return e(422, 'VALIDATION', b.error.message);
      const it = items.find((x) => x.id === params.id && visible(a.p, x));
      if (!it) return e(404, 'NOT_FOUND', 'Exception not found');
      if (it.user.id !== a.p.id)
        return e(403, 'FORBIDDEN', 'Only the person the exception is about can explain it');
      if (closed(it)) return e(409, 'EXCEPTION_CLOSED', `Exception is ${it.status}`);
      Object.assign(it, { explanation: b.data.note, explainedAt: now(), status: 'acknowledged' });
      return touch(it);
    }),
    close('resolved'),
    close('dismissed'),
    http.patch(`${B}/:id`, async ({ request, params }) => {
      const b = ExceptionUpdate.safeParse(await body(request));
      if (!b.success) return e(422, 'VALIDATION', b.error.message);
      const g = editable(request, String(params.id), b.data.version);
      if (g.res) return g.res;
      if (b.data.assigneeId) {
        const u = byId(b.data.assigneeId);
        if (!u || !(wide(g.p) || subtree(g.p.id).has(u.id)))
          return e(422, 'ASSIGNEE_OUT_OF_SCOPE', 'Assignee must be you or someone in your team');
      }
      if (b.data.assigneeId !== undefined) g.it.assignee = ref(b.data.assigneeId);
      if (b.data.followUpOn !== undefined) g.it.followUpOn = b.data.followUpOn;
      return touch(g.it);
    }),
    http.post(`${B}/evaluate`, async ({ request }) => {
      const a = auth(request, 'settings:write');
      if (a.res) return a.res;
      const b = ExceptionEvaluateRequest.safeParse(await body(request));
      if (!b.success) return e(422, 'VALIDATION', b.error.message);
      return HttpResponse.json({ queued: true, ...b.data }, { status: 202 });
    }),
    http.get(`${baseUrl}/v1/exception-rules`, ({ request }) => {
      const a = auth(request, 'field:read');
      if (a.res) return a.res;
      return HttpResponse.json({ items: EXCEPTION_RULE_CODES.map(rule) });
    }),
    http.put(`${baseUrl}/v1/exception-rules/:code`, async ({ request, params }) => {
      const a = auth(request, 'settings:write');
      if (a.res) return a.res;
      const code = String(params.code) as ExceptionRuleCode;
      if (!EXCEPTION_RULE_CODES.includes(code)) return e(404, 'NOT_FOUND', 'Unknown rule');
      const b = ExceptionRuleUpdate.safeParse(await body(request));
      if (!b.success) return e(422, 'VALIDATION', b.error.message);
      const cur = rule(code);
      if (b.data.version !== undefined && b.data.version !== cur.version)
        return e(409, 'VERSION_CONFLICT', 'Rule was changed by someone else');
      if (b.data.reset) {
        overrides.delete(code);
        return HttpResponse.json(rule(code));
      }
      const d = EXCEPTION_RULES[code];
      const t = b.data.threshold;
      if (
        t !== undefined &&
        (d.threshold === null || (d.thresholdMin ?? 0) > t || t > (d.thresholdMax ?? 1000))
      )
        return e(422, 'THRESHOLD_OUT_OF_RANGE', 'Threshold is out of range for this rule');
      const next: ExceptionRule = {
        ...cur,
        enabled: b.data.enabled ?? cur.enabled,
        severity: b.data.severity ?? cur.severity,
        threshold: t ?? cur.threshold,
        action: b.data.action ?? cur.action,
        isDefault: false,
        version: (cur.version ?? 0) + 1,
      };
      overrides.set(code, next);
      return HttpResponse.json(next);
    }),
  ];
}
