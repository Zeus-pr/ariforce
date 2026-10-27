import { http, HttpResponse } from 'msw';
import type { Me } from '../schemas/auth';
import { ROLE_RANK } from '../schemas/roles';
import {
  SFC_DEFAULT_RATE_PER_KM,
  type SfcRoute,
  SfcSettings,
  SfcTablePut,
  sfcAmounts,
} from '../schemas/sfc';
import * as fx from './fixtures';

/**
 * Mock SFC (docs/SFC.md). Same shapes, permissions and error codes as the API. Simplifications:
 * any territory with an assigned sales user counts as an HQ (fixtures have no headquarter level);
 * the etag is a counter per table.
 */
let settings = { ratePerKm: SFC_DEFAULT_RATE_PER_KM, version: 1 };
const tables = new Map<string, { hq: string | null; rev: number; routes: SfcRoute[] }>();
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${(0x5fc000000000 + ++seq).toString(16)}`;
const e = (status: number, code: string, message: string, details?: unknown) =>
  HttpResponse.json({ error: { code, message, details } }, { status });

const sales = fx.mockUsers.filter((u) => u.roles.some((r) => ROLE_RANK[r] >= 1));
const wide = (p: Me) => p.roles.includes('director') || p.roles.includes('system_admin');
function team(p: Me): Set<string> {
  const out = new Set([p.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const u of fx.mockUsers)
      if (u.managerId && out.has(u.managerId) && !out.has(u.id)) {
        out.add(u.id);
        grew = true;
      }
  }
  return out;
}
const visible = (p: Me) => sales.filter((u) => wide(p) || team(p).has(u.id));
const canEdit = (p: Me, id: string) =>
  p.permissions.includes('sfc:write') &&
  (p.roles.includes('system_admin') || (id !== p.id && (wide(p) || team(p).has(id))));
const etagOf = (id: string) => {
  const t = tables.get(id);
  return t ? `mock-${t.rev}` : '';
};

export function sfcHandlers(baseUrl: string, who: (r: Request) => Me | undefined) {
  const B = `${baseUrl}/v1/sfc`;
  const auth = (request: Request, perm: string) => {
    const p = who(request);
    if (!p) return { res: e(401, 'UNAUTHENTICATED', 'Sign in required') };
    if (!(p.permissions as string[]).includes(perm))
      return { res: e(403, 'FORBIDDEN', 'Missing permission') };
    return { p };
  };
  const table = (p: Me, u: Me) => {
    const t = tables.get(u.id);
    return {
      userId: u.id,
      userName: u.name,
      hqTerritoryId: t?.hq ?? u.territoryIds[0] ?? null,
      ratePerKm: settings.ratePerKm,
      etag: etagOf(u.id),
      canEdit: canEdit(p, u.id),
      routes: t?.routes ?? [],
    };
  };
  return [
    http.get(`${B}/settings`, ({ request }) => {
      const a = auth(request, 'sfc:read');
      return a.res ?? HttpResponse.json(settings);
    }),
    http.put(`${B}/settings`, async ({ request }) => {
      const a = auth(request, 'settings:write');
      if (a.res) return a.res;
      const b = SfcSettings.safeParse(await request.json().catch(() => null));
      if (!b.success) return e(422, 'VALIDATION', b.error.issues[0]?.message ?? 'Invalid');
      if (b.data.version !== settings.version)
        return e(409, 'VERSION_CONFLICT', 'Stale version', settings);
      settings = { ratePerKm: b.data.ratePerKm, version: settings.version + 1 };
      return HttpResponse.json(settings);
    }),
    http.get(`${B}/hqs`, ({ request }) => {
      const a = auth(request, 'sfc:read');
      if (a.res) return a.res;
      const users = visible(a.p);
      const items = fx.territories
        .filter((t) => users.some((u) => u.territoryIds.includes(t.id)))
        .map((t) => ({
          id: t.id,
          name: t.name,
          code: t.code,
          level: t.level,
          parentId: t.parentId,
          parentName: fx.territories.find((x) => x.id === t.parentId)?.name ?? null,
          employeeCount: users.filter((u) => u.territoryIds.includes(t.id)).length,
          routeCount: [...tables.values()]
            .filter((x) => x.hq === t.id)
            .reduce((n, x) => n + x.routes.length, 0),
        }));
      return HttpResponse.json({ items });
    }),
    http.get(`${B}/employees`, ({ request }) => {
      const a = auth(request, 'sfc:read');
      if (a.res) return a.res;
      const tid = new URL(request.url).searchParams.get('territoryId');
      const items = visible(a.p)
        .filter((u) => !tid || u.territoryIds.includes(tid))
        .map((u) => {
          const role = [...u.roles].sort((x, y) => ROLE_RANK[y] - ROLE_RANK[x])[0] ?? null;
          const n = tables.get(u.id)?.routes.length ?? 0;
          return {
            id: u.id,
            name: u.name,
            employeeCode: u.employeeCode ?? null,
            role,
            rank: role ? ROLE_RANK[role] : 0,
            hqTerritoryIds: u.territoryIds,
            routeCount: n,
            hasSfc: n > 0,
            canEdit: canEdit(a.p, u.id),
          };
        });
      return HttpResponse.json({ items });
    }),
    http.get(`${B}/employees/:userId/routes`, ({ request, params }) => {
      const a = auth(request, 'sfc:read');
      if (a.res) return a.res;
      const u = visible(a.p).find((x) => x.id === params.userId);
      if (!u) return e(404, 'NOT_FOUND', 'Employee not found or not visible');
      return HttpResponse.json(table(a.p, u));
    }),
    http.put(`${B}/employees/:userId/routes`, async ({ request, params }) => {
      const a = auth(request, 'sfc:write');
      if (a.res) return a.res;
      const u = visible(a.p).find((x) => x.id === params.userId);
      if (!u) return e(404, 'NOT_FOUND', 'Employee not found or not visible');
      if (!canEdit(a.p, u.id)) return e(403, 'FORBIDDEN', 'Cannot edit this SFC');
      const b = SfcTablePut.safeParse(await request.json().catch(() => null));
      if (!b.success) return e(422, 'VALIDATION', b.error.issues[0]?.message ?? 'Invalid');
      if (b.data.etag !== etagOf(u.id))
        return e(409, 'VERSION_CONFLICT', 'SFC changed since it was loaded', {
          etag: etagOf(u.id),
        });
      if (!u.territoryIds.includes(b.data.hqTerritoryId))
        return e(422, 'SFC_HQ_NOT_ASSIGNED', 'hqTerritoryId is not assigned to this employee');
      const old = tables.get(u.id);
      const now = new Date().toISOString();
      const routes: SfcRoute[] = [];
      for (const [i, r] of b.data.routes.entries()) {
        const prev = r.id ? old?.routes.find((x) => x.id === r.id) : undefined;
        if (r.id && !prev) return e(422, 'SFC_ROUTE_NOT_FOUND', `Route ${r.id} not found`);
        routes.push({
          id: prev?.id ?? uuid(),
          sortOrder: i + 1,
          fromPlace: r.fromPlace,
          toPlace: r.toPlace,
          oneWayKm: r.oneWayKm,
          ...sfcAmounts(r.oneWayKm, r.actualFare, settings.ratePerKm),
          actualFare: r.actualFare,
          travelMode: r.travelMode,
          category: r.category,
          da: r.da,
          version: (prev?.version ?? 0) + 1,
          updatedAt: now,
        });
      }
      tables.set(u.id, { hq: b.data.hqTerritoryId, rev: (old?.rev ?? 0) + 1, routes });
      return HttpResponse.json(table(a.p, u));
    }),
  ];
}
