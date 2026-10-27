import { http, HttpResponse } from 'msw';
import type * as z from 'zod';
import {
  AllowancePlace,
  AllowancePlaceInput,
  AllowancePlaceList,
  AllowancePlaceQuery,
  AllowancePlaceUpdate,
  AllowanceRate,
  AllowanceRateInput,
  AllowanceRateList,
  AllowanceRateQuery,
  AllowanceRateUpdate,
} from '../schemas/allowances';
import type { Me } from '../schemas/auth';
import * as fx from './fixtures';

/**
 * Mock TA/DA rate card and fare chart (#39, docs/TADA.md). Same shapes, permissions (read:
 * expenses:read, finance:read or settings:write; write: settings:write) and error codes as the API. Simplification: any fixture
 * territory counts as a headquarter (fixtures have no headquarter level).
 */
type Rate = z.infer<typeof AllowanceRate>;
type Place = z.infer<typeof AllowancePlace>;
export const mockRates: Rate[] = [];
const places: Place[] = [];
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${(0xa10000000000 + ++seq).toString(16)}`;
const e = (status: number, code: string, message: string) =>
  HttpResponse.json({ error: { code, message } }, { status });

/** Rate for a band on a date: role-specific row wins, latest effectiveFrom <= date (as the API). */
export const mockRateFor = (band: Rate['band'], roleKey: string | null, date: string) =>
  mockRates
    .filter(
      (r) =>
        r.band === band && r.effectiveFrom <= date && (r.roleKey === null || r.roleKey === roleKey),
    )
    .sort(
      (a, b) =>
        Number(b.roleKey !== null) - Number(a.roleKey !== null) ||
        b.effectiveFrom.localeCompare(a.effectiveFrom),
    )[0];

export function allowanceHandlers(baseUrl: string, who: (r: Request) => Me | undefined) {
  const B = `${baseUrl}/v1`;
  const auth = (request: Request, write = false) => {
    const p = who(request);
    if (!p) return { res: e(401, 'UNAUTHENTICATED', 'Sign in required') };
    const has = (k: string) => (p.permissions as string[]).includes(k);
    if (
      write
        ? !has('settings:write')
        : !['expenses:read', 'finance:read', 'settings:write'].some(has)
    )
      return { res: e(403, 'FORBIDDEN', 'Missing permission') };
    return { p };
  };
  const json = (request: Request) => request.json().catch(() => null);
  const bad = (i: { message: string }[]) => e(422, 'VALIDATION', i[0]?.message ?? 'Invalid');
  const dupRate = (b: z.infer<typeof AllowanceRateInput>, id?: string) =>
    mockRates.some(
      (r) =>
        r.id !== id &&
        r.band === b.band &&
        r.roleKey === b.roleKey &&
        r.effectiveFrom === b.effectiveFrom,
    );
  const dupPlace = (b: z.infer<typeof AllowancePlaceInput>, id?: string) =>
    places.some(
      (x) =>
        x.id !== id &&
        x.hqTerritoryId === b.hqTerritoryId &&
        x.name.toLowerCase() === b.name.toLowerCase(),
    );
  const hqName = (id: string) => fx.territories.find((t) => t.id === id)?.name;

  return [
    http.get(`${B}/allowance-rates`, ({ request }) => {
      const a = auth(request);
      if (a.res) return a.res;
      const q = AllowanceRateQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
      if (!q.success) return bad(q.error.issues);
      const items = mockRates.filter(
        (r) =>
          (!q.data.band || r.band === q.data.band) &&
          (!q.data.roleKey || r.roleKey === q.data.roleKey),
      );
      return HttpResponse.json(AllowanceRateList.parse({ items }));
    }),
    http.post(`${B}/allowance-rates`, async ({ request }) => {
      const a = auth(request, true);
      if (a.res) return a.res;
      const b = AllowanceRateInput.safeParse(await json(request));
      if (!b.success) return bad(b.error.issues);
      if (dupRate(b.data))
        return e(409, 'DUPLICATE_RATE', 'A rate for this band, role and date exists');
      const r: Rate = { ...b.data, id: uuid(), updatedAt: new Date().toISOString(), version: 1 };
      mockRates.push(r);
      return HttpResponse.json(r, { status: 201 });
    }),
    http.put(`${B}/allowance-rates/:id`, async ({ request, params }) => {
      const a = auth(request, true);
      if (a.res) return a.res;
      const r = mockRates.find((x) => x.id === params.id);
      if (!r) return e(404, 'NOT_FOUND', 'Rate not found');
      const b = AllowanceRateUpdate.safeParse(await json(request));
      if (!b.success) return bad(b.error.issues);
      if (b.data.version !== r.version) return e(409, 'VERSION_CONFLICT', 'Stale version');
      const { version: _v, ...rest } = b.data;
      if (dupRate(rest, r.id))
        return e(409, 'DUPLICATE_RATE', 'A rate for this band, role and date exists');
      Object.assign(r, rest, { version: r.version + 1, updatedAt: new Date().toISOString() });
      return HttpResponse.json(r);
    }),
    http.delete(`${B}/allowance-rates/:id`, ({ request, params }) => {
      const a = auth(request, true);
      if (a.res) return a.res;
      const i = mockRates.findIndex((x) => x.id === params.id);
      if (i < 0) return e(404, 'NOT_FOUND', 'Rate not found');
      mockRates.splice(i, 1);
      return new HttpResponse(null, { status: 204 });
    }),
    http.get(`${B}/allowance-places`, ({ request }) => {
      const a = auth(request);
      if (a.res) return a.res;
      const q = AllowancePlaceQuery.safeParse(
        Object.fromEntries(new URL(request.url).searchParams),
      );
      if (!q.success) return bad(q.error.issues);
      const t = q.data.q?.toLowerCase();
      const items = places.filter(
        (x) =>
          (!q.data.hqTerritoryId || x.hqTerritoryId === q.data.hqTerritoryId) &&
          (!q.data.band || x.band === q.data.band) &&
          (!t || x.name.toLowerCase().includes(t)) &&
          (q.data.includeInactive === 'true' || x.active),
      );
      return HttpResponse.json(AllowancePlaceList.parse({ items }));
    }),
    http.post(`${B}/allowance-places`, async ({ request }) => {
      const a = auth(request, true);
      if (a.res) return a.res;
      const b = AllowancePlaceInput.safeParse(await json(request));
      if (!b.success) return bad(b.error.issues);
      const name = hqName(b.data.hqTerritoryId);
      if (!name) return e(422, 'NOT_HQ_TERRITORY', 'hqTerritoryId must be a headquarter');
      if (dupPlace(b.data)) return e(409, 'DUPLICATE_PLACE', 'This place exists for the HQ');
      const x: Place = {
        ...b.data,
        id: uuid(),
        hqName: name,
        updatedAt: new Date().toISOString(),
        version: 1,
      };
      places.push(x);
      return HttpResponse.json(x, { status: 201 });
    }),
    http.put(`${B}/allowance-places/:id`, async ({ request, params }) => {
      const a = auth(request, true);
      if (a.res) return a.res;
      const x = places.find((y) => y.id === params.id);
      if (!x) return e(404, 'NOT_FOUND', 'Place not found');
      const b = AllowancePlaceUpdate.safeParse(await json(request));
      if (!b.success) return bad(b.error.issues);
      if (b.data.version !== x.version) return e(409, 'VERSION_CONFLICT', 'Stale version');
      const { version: _v, ...rest } = b.data;
      const name = hqName(rest.hqTerritoryId);
      if (!name) return e(422, 'NOT_HQ_TERRITORY', 'hqTerritoryId must be a headquarter');
      if (dupPlace(rest, x.id)) return e(409, 'DUPLICATE_PLACE', 'This place exists for the HQ');
      Object.assign(x, rest, {
        hqName: name,
        version: x.version + 1,
        updatedAt: new Date().toISOString(),
      });
      return HttpResponse.json(x);
    }),
    http.delete(`${B}/allowance-places/:id`, ({ request, params }) => {
      const a = auth(request, true);
      if (a.res) return a.res;
      const i = places.findIndex((y) => y.id === params.id);
      if (i < 0) return e(404, 'NOT_FOUND', 'Place not found');
      places.splice(i, 1);
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}
