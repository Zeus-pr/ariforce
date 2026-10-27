/**
 * Mock mode only: SFC endpoints (assumed contract, see ./adapter.ts) until the Architect's API lands.
 * State lives in the page (lost on reload). Scope follows the mock persona (x-mock-user).
 */
import { http, HttpResponse } from 'msw';
import { DEFAULT_RATE, type SfcRow, type SfcSheet } from './adapter';
import { SFC_EMPLOYEES, SFC_HQS, SFC_SCOPE, seedRows } from './fixtures';

const err = (status: number, code: string, message: string, details?: unknown) =>
  HttpResponse.json({ error: { code, message, details } }, { status });

export function mockSfc(base: string) {
  const sheets = new Map<string, SfcSheet>();
  const sheet = (userId: string, hqId: string) => {
    let s = sheets.get(userId);
    if (!s) {
      const rows = seedRows(userId);
      s = {
        userId,
        hqId,
        version: 1,
        rows,
        updatedAt: rows.length ? '2026-10-01T05:30:00Z' : null,
      };
      sheets.set(userId, s);
    }
    return s;
  };
  const scope = (request: Request) => {
    const who = request.headers.get('x-mock-user') ?? 'director';
    const s = SFC_SCOPE[who];
    if (!s) return null;
    return SFC_HQS.filter((h) => s === 'all' || s.includes(h.areaId));
  };
  const person = (request: Request, id: string) => {
    const hqs = scope(request);
    if (!hqs) return { fail: err(403, 'FORBIDDEN', 'SFC is for ABM and above') };
    const u = SFC_EMPLOYEES.find((e) => e.id === id);
    if (!u) return { fail: err(404, 'NOT_FOUND', 'Not found') };
    if (!hqs.some((h) => h.id === u.hqId))
      return { fail: err(403, 'FORBIDDEN', 'Outside your team') };
    return { u };
  };

  return [
    http.get(`${base}/v1/sfc/settings`, ({ request }) =>
      scope(request)
        ? HttpResponse.json({ ratePerKm: DEFAULT_RATE })
        : err(403, 'FORBIDDEN', 'No access'),
    ),
    http.get(`${base}/v1/sfc/hqs`, ({ request }) => {
      const hqs = scope(request);
      return hqs
        ? HttpResponse.json({ items: hqs })
        : err(403, 'FORBIDDEN', 'SFC is for ABM and above');
    }),
    http.get(`${base}/v1/sfc/employees`, ({ request }) => {
      const hqs = scope(request);
      if (!hqs) return err(403, 'FORBIDDEN', 'SFC is for ABM and above');
      const hqId = new URL(request.url).searchParams.get('hqId');
      if (!hqId || !hqs.some((h) => h.id === hqId))
        return err(403, 'FORBIDDEN', 'HQ outside your scope');
      return HttpResponse.json({ items: SFC_EMPLOYEES.filter((e) => e.hqId === hqId) });
    }),
    http.get(`${base}/v1/sfc/:userId`, ({ request, params }) => {
      const p = person(request, String(params.userId));
      if (p.fail) return p.fail;
      return HttpResponse.json(sheet(p.u.id, p.u.hqId));
    }),
    http.put(`${base}/v1/sfc/:userId`, async ({ request, params }) => {
      const p = person(request, String(params.userId));
      if (p.fail) return p.fail;
      const b = (await request.json().catch(() => null)) as {
        version?: number;
        rows?: SfcRow[];
      } | null;
      if (!b || typeof b.version !== 'number' || !Array.isArray(b.rows))
        return err(422, 'VALIDATION', 'version and rows are required');
      const s = sheet(p.u.id, p.u.hqId);
      if (b.version !== s.version) return err(409, 'VERSION_CONFLICT', 'Stale version');
      if (b.rows.length > 200) return err(422, 'VALIDATION', 'At most 200 rows');
      const bad = b.rows.findIndex(
        (r) =>
          !r.fromPlace?.trim() ||
          !r.toPlace?.trim() ||
          !r.travelMode?.trim() ||
          !r.category?.trim() ||
          (r.distanceKm != null && !(r.distanceKm >= 0 && r.distanceKm <= 2000)) ||
          (r.da ?? '').length > 100,
      );
      if (bad >= 0)
        return err(
          422,
          'VALIDATION',
          `Row ${bad + 1}: places, mode and category are required, and distance must be 0 to 2000 km.`,
          {
            rows: [bad],
          },
        );
      s.rows = b.rows.map((r, i) => ({
        ...r,
        id: r.id || `${p.u.id}-n${s.version}-${i}`,
        da: r.da ?? '',
      }));
      s.version += 1;
      s.updatedAt = new Date().toISOString();
      return HttpResponse.json(s);
    }),
  ];
}
