/**
 * Mock mode only: SFC endpoints in the shapes of the Architect's contract (docs/SFC.md), with the
 * web's own Burdwan-area demo fixtures (the contracts mock has no HQ-level fixtures). Registered before
 * the contracts mock, so it answers /v1/sfc/*. State lives in the page (lost on reload). Scope follows
 * the mock persona (x-mock-user): a Burdwan ABM sees the Burdwan area, RBM and above see everything.
 */
import { http, HttpResponse } from 'msw';
import { DEFAULT_RATE } from './adapter';
import { SFC_EMPLOYEES, SFC_HQS, SFC_SCOPE, seedRows } from './fixtures';

const MODE: Record<string, string> = {
  BIKE: 'bike',
  BUS: 'bus',
  TRAIN: 'train',
  'BUS / TRAIN': 'bus_train',
  CAR: 'car',
  OTHER: 'other',
};
const MODES = new Set(Object.values(MODE));
type Route = {
  id: string;
  sortOrder: number;
  fromPlace: string;
  toPlace: string;
  oneWayKm: number;
  bothWayKm: number;
  oneWayAmount: number | null;
  bothWayAmount: number | null;
  actualFare: boolean;
  travelMode: string | null;
  category: string | null;
  da: number | null;
  version: number;
  updatedAt: string;
};
type In = Partial<
  Pick<
    Route,
    'id' | 'fromPlace' | 'toPlace' | 'oneWayKm' | 'actualFare' | 'travelMode' | 'category' | 'da'
  >
>;

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const amounts = (km: number, af: boolean, rate: number) => {
  const one = af ? null : r2(km * rate);
  return {
    bothWayKm: r2(km * 2),
    oneWayAmount: one,
    bothWayAmount: one == null ? null : r2(one * 2),
  };
};
const money = (n: unknown, max: number) =>
  typeof n === 'number' && n >= 0 && n <= max && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
const err = (status: number, code: string, message: string, details?: unknown) =>
  HttpResponse.json({ error: { code, message, details } }, { status });

export function mockSfc(base: string) {
  const rate = DEFAULT_RATE;
  const tables = new Map<string, { rev: number; hq: string; routes: Route[] }>();
  let seq = 0;
  const table = (userId: string, hq: string) => {
    let t = tables.get(userId);
    if (!t) {
      const now = '2026-10-01T05:30:00Z';
      t = {
        rev: 1,
        hq,
        routes: seedRows(userId).map((r, i) => ({
          id: r.id,
          sortOrder: i + 1,
          fromPlace: r.fromPlace,
          toPlace: r.toPlace,
          oneWayKm: r.distanceKm ?? 0,
          ...amounts(r.distanceKm ?? 0, r.actualFare, rate),
          actualFare: r.actualFare,
          travelMode: MODE[r.travelMode] ?? null,
          category: r.category || null,
          da: r.da,
          version: 1,
          updatedAt: now,
        })),
      };
      tables.set(userId, t);
    }
    return t;
  };
  const etag = (t: { rev: number; routes: Route[] }) =>
    t.rev === 1 && !t.routes.length ? '' : `mock-${t.rev}`;
  const scope = (request: Request) => {
    const s = SFC_SCOPE[request.headers.get('x-mock-user') ?? 'director'];
    return s ? SFC_HQS.filter((h) => s === 'all' || s.includes(h.areaId ?? '')) : null;
  };
  const person = (request: Request, id: string) => {
    const hqs = scope(request);
    if (!hqs) return { fail: err(403, 'FORBIDDEN', 'Missing permission') };
    const u = SFC_EMPLOYEES.find((e) => e.id === id && hqs.some((h) => h.id === e.hqId));
    if (!u) return { fail: err(404, 'NOT_FOUND', 'Employee not found or not visible') };
    return { u };
  };
  const out = (userId: string, name: string, t: { rev: number; hq: string; routes: Route[] }) => ({
    userId,
    userName: name,
    hqTerritoryId: t.hq,
    ratePerKm: rate,
    etag: etag(t),
    canEdit: true,
    routes: t.routes,
  });

  return [
    http.get(`${base}/v1/sfc/settings`, ({ request }) =>
      scope(request)
        ? HttpResponse.json({ ratePerKm: rate, version: 1 })
        : err(403, 'FORBIDDEN', 'Missing permission'),
    ),
    http.get(`${base}/v1/sfc/hqs`, ({ request }) => {
      const hqs = scope(request);
      if (!hqs) return err(403, 'FORBIDDEN', 'Missing permission');
      return HttpResponse.json({
        items: hqs.map((h) => ({
          id: h.id,
          name: h.name,
          code: h.code,
          level: 'hq',
          parentId: h.areaId,
          parentName: h.areaName,
          employeeCount: SFC_EMPLOYEES.filter((e) => e.hqId === h.id).length,
          routeCount: 0,
        })),
      });
    }),
    http.get(`${base}/v1/sfc/employees`, ({ request }) => {
      const hqs = scope(request);
      if (!hqs) return err(403, 'FORBIDDEN', 'Missing permission');
      const tid = new URL(request.url).searchParams.get('territoryId');
      const items = SFC_EMPLOYEES.filter(
        (e) => hqs.some((h) => h.id === e.hqId) && (!tid || e.hqId === tid),
      ).map((e) => {
        const n = seedRows(e.id).length;
        return {
          id: e.id,
          name: e.name,
          employeeCode: e.employeeCode,
          role: e.role,
          rank: 1,
          hqTerritoryIds: e.hqId ? [e.hqId] : [],
          routeCount: n,
          hasSfc: n > 0,
          canEdit: true,
        };
      });
      return HttpResponse.json({ items });
    }),
    http.get(`${base}/v1/sfc/employees/:userId/routes`, ({ request, params }) => {
      const p = person(request, String(params.userId));
      if (p.fail) return p.fail;
      return HttpResponse.json(out(p.u.id, p.u.name, table(p.u.id, p.u.hqId ?? '')));
    }),
    http.put(`${base}/v1/sfc/employees/:userId/routes`, async ({ request, params }) => {
      const p = person(request, String(params.userId));
      if (p.fail) return p.fail;
      const b = (await request.json().catch(() => null)) as {
        etag?: string;
        hqTerritoryId?: string;
        routes?: In[];
      } | null;
      if (!b || typeof b.etag !== 'string' || !b.hqTerritoryId || !Array.isArray(b.routes))
        return err(422, 'VALIDATION', 'etag, hqTerritoryId and routes are required');
      const t = table(p.u.id, p.u.hqId ?? '');
      if (b.etag !== etag(t))
        return err(409, 'VERSION_CONFLICT', 'SFC changed since it was loaded', { etag: etag(t) });
      if (b.hqTerritoryId !== p.u.hqId)
        return err(422, 'SFC_HQ_NOT_ASSIGNED', 'hqTerritoryId is not assigned to this employee');
      if (b.routes.length > 200) return err(422, 'VALIDATION', 'At most 200 routes');
      const bad = b.routes.findIndex(
        (r) =>
          !r.fromPlace?.trim() ||
          r.fromPlace.length > 120 ||
          !r.toPlace?.trim() ||
          r.toPlace.length > 120 ||
          !money(r.oneWayKm, 2500) ||
          (r.travelMode != null && !MODES.has(r.travelMode)) ||
          (r.category ?? '').length > 40 ||
          (r.da != null && !money(r.da, 1_000_000)),
      );
      if (bad >= 0)
        return err(
          422,
          'VALIDATION',
          `Row ${bad + 1}: distance must be 0 to 2500 km and DA 0 to 10,00,000.`,
          { rows: [bad] },
        );
      const now = new Date().toISOString();
      const next: Route[] = [];
      for (const [i, r] of b.routes.entries()) {
        const prev = r.id ? t.routes.find((x) => x.id === r.id) : undefined;
        if (r.id && !prev) return err(422, 'SFC_ROUTE_NOT_FOUND', `Route ${r.id} not found`);
        next.push({
          id: prev?.id ?? `${p.u.id}-n${++seq}`,
          sortOrder: i + 1,
          fromPlace: r.fromPlace!.trim(),
          toPlace: r.toPlace!.trim(),
          oneWayKm: r.oneWayKm!,
          ...amounts(r.oneWayKm!, !!r.actualFare, rate),
          actualFare: !!r.actualFare,
          travelMode: r.travelMode ?? null,
          category: r.category ?? null,
          da: r.da ?? null,
          version: (prev?.version ?? 0) + 1,
          updatedAt: now,
        });
      }
      t.routes = next;
      t.rev += 1;
      return HttpResponse.json(out(p.u.id, p.u.name, t));
    }),
  ];
}
