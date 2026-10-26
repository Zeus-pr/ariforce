/**
 * MSW handlers generated from the contracts, so apps/web can be built before the API is done.
 * Browser: `setupWorker(...createHandlers(baseUrl)).start()`; Node/tests: `setupServer(...)`.
 * Every response is parsed through the zod schema, so mocks can never drift from the contract.
 */
import { http, HttpResponse } from 'msw';
import * as z from 'zod';
import {
  Chemist,
  ChemistCreate,
  Doctor,
  DoctorCategory,
  DoctorCreate,
  Me,
  Role,
  Specialty,
  Stockist,
  StockistCreate,
  Territory,
} from '../index';
import * as fx from './fixtures';
import {
  Approval,
  ApprovalDecision,
  AttendanceDay,
  CheckIn,
  CheckInCreate,
  ConsentState,
  Dcr,
  DcrUpsert,
  Division,
  GeofenceSettings,
  ImportJob,
  ImportRequest,
  type ImportRowResult,
  Product,
  ProductCreate,
  ProductHqMapping,
  TourPlan,
  TourPlanUpsert,
  WorkType,
  WorkTypeCreate,
} from '../index';

const jobs = new Map<string, ImportJob>();

export { fx as fixtures };

const serverTime = () => new Date().toISOString();
const notFound = () =>
  HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });

const FILTER_SKIP = new Set(['limit', 'cursor', 'updatedSince', 'q', 'sort', 'includeTotal']);
const encodeCursor = (n: number) => btoa(`o:${n}`);
const decodeCursor = (c: string | null) => {
  if (!c) return 0;
  const m = /^o:(\d+)$/.exec(atob(c));
  return m ? Number(m[1]) : 0;
};
const validation = (message: string, details?: unknown) =>
  HttpResponse.json({ error: { code: 'VALIDATION', message, details } }, { status: 422 });

/** Territory filter includes descendants, like the API. */
function inTerritory(row: Record<string, unknown>, territoryId: string) {
  const tid = row.territoryId as string | undefined;
  if (!tid) return false;
  const t = fx.territories.find((x) => x.id === tid);
  return tid === territoryId || !!t?.path.split('.').includes(territoryId);
}

/**
 * Generic list: honours updatedSince, q (name/code/city), field filters (exact match;
 * territoryId/ancestorId include descendants; from/to on `date`), sort, limit, cursor, includeTotal.
 */
export function list<T extends { id: string }>(schema: z.ZodType<T>, rows: T[], url: URL) {
  const sp = url.searchParams;
  const since = sp.get('updatedSince');
  const q = sp.get('q')?.toLowerCase();
  const limit = Math.min(Number(sp.get('limit') ?? 50), 200);
  let out = rows.filter((r) => {
    const o = r as unknown as Record<string, unknown>;
    if (since && String(o.updatedAt ?? o.createdAt) <= since) return false;
    if (!since && o.deletedAt) return false;
    if (
      q &&
      !['name', 'code', 'city', 'summary'].some((k) =>
        String(o[k] ?? '')
          .toLowerCase()
          .includes(q),
      )
    )
      return false;
    for (const [k, v] of sp) {
      if (FILTER_SKIP.has(k)) continue;
      if (k === 'territoryId' && 'territoryId' in o) {
        if (!inTerritory(o, v)) return false;
      } else if (k === 'ancestorId') {
        if (
          !String(o.path ?? '')
            .split('.')
            .includes(v) ||
          o.id === v
        )
          return false;
      } else if (k === 'from') {
        if (String(o.date ?? '') < v) return false;
      } else if (k === 'to') {
        if (String(o.date ?? '') > v) return false;
      } else if (k in o && String(o[k]) !== v) return false;
    }
    return true;
  });
  const sort = sp.get('sort');
  if (sort) {
    const desc = sort.startsWith('-');
    const f = desc ? sort.slice(1) : sort;
    out = [...out].sort((x, y) => {
      const a = String((x as Record<string, unknown>)[f] ?? '');
      const b = String((y as Record<string, unknown>)[f] ?? '');
      return (a < b ? -1 : a > b ? 1 : 0) * (desc ? -1 : 1);
    });
  }
  const offset = decodeCursor(sp.get('cursor'));
  const items = out.slice(offset, offset + limit);
  return HttpResponse.json({
    items: z.array(schema).parse(items),
    nextCursor: offset + limit < out.length ? encodeCursor(offset + limit) : null,
    serverTime: serverTime(),
    ...(sp.get('includeTotal') === 'true' && !since ? { total: out.length } : {}),
  });
}

type DupRule = {
  rule: 'registration_no' | 'name_pincode' | 'gstin' | 'drug_license_no' | 'code';
  key: (r: Record<string, unknown>) => string | null;
};
const DUP_RULES: Record<string, DupRule[]> = {
  '/v1/doctors': [
    {
      rule: 'registration_no',
      key: (r) => (r.registrationNo ? String(r.registrationNo).toUpperCase() : null),
    },
    {
      rule: 'name_pincode',
      key: (r) =>
        r.name && r.pincode
          ? `${String(r.name)
              .toLowerCase()
              .replace(/^dr\.?\s*/, '')
              .trim()}|${r.pincode}`
          : null,
    },
  ],
  '/v1/chemists': [
    { rule: 'gstin', key: (r) => (r.gstin ? String(r.gstin).toUpperCase() : null) },
    {
      rule: 'drug_license_no',
      key: (r) => (r.drugLicenseNo ? String(r.drugLicenseNo).toUpperCase() : null),
    },
    {
      rule: 'name_pincode',
      key: (r) =>
        r.name && r.pincode ? `${String(r.name).toLowerCase().trim()}|${r.pincode}` : null,
    },
  ],
  '/v1/products': [{ rule: 'code', key: (r) => (r.code ? String(r.code).toUpperCase() : null) }],
};
DUP_RULES['/v1/stockists'] = DUP_RULES['/v1/chemists']!;

function crud<
  T extends { id: string; updatedAt: string; version: number; deletedAt: string | null },
>(baseUrl: string, path: string, schema: z.ZodType<T>, createSchema: z.ZodType, seed: T[]) {
  const rows = structuredClone(seed);
  return [
    http.post(`${baseUrl}${path}/import`, async ({ request }) => {
      const parsed = ImportRequest.safeParse(await request.json());
      if (!parsed.success) return validation('Invalid import', z.treeifyError(parsed.error));
      const { dryRun, rows: input, onDuplicate, fileName } = parsed.data;
      const rules = DUP_RULES[path] ?? [];
      const seen = new Map<string, number>();
      const results: ImportRowResult[] = input.map((raw, i) => {
        const row = i + 1;
        const body = createSchema.safeParse(raw);
        if (!body.success)
          return {
            row,
            status: 'error',
            errors: body.error.issues.map((e) => ({
              column: e.path.length ? String(e.path[0]) : null,
              code: e.code,
              message: e.message,
            })),
            id: null,
            duplicateOf: null,
            duplicateRule: null,
          };
        const data = body.data as Record<string, unknown>;
        for (const r of rules) {
          const k = r.key(data);
          if (!k) continue;
          const prev = seen.get(`${r.rule}:${k}`);
          if (prev)
            return {
              row,
              status: 'error',
              errors: [
                {
                  column: null,
                  code: 'duplicate_in_file',
                  message: `Same ${r.rule} as row ${prev}`,
                },
              ],
              id: null,
              duplicateOf: null,
              duplicateRule: 'in_file',
            };
          seen.set(`${r.rule}:${k}`, row);
          const hit = rows.find(
            (x) => !x.deletedAt && r.key(x as unknown as Record<string, unknown>) === k,
          );
          if (hit) {
            if (onDuplicate === 'error')
              return {
                row,
                status: 'error',
                errors: [
                  {
                    column: null,
                    code: 'duplicate',
                    message: `Matches existing record by ${r.rule}`,
                  },
                ],
                id: hit.id,
                duplicateOf: hit.id,
                duplicateRule: r.rule,
              };
            if (onDuplicate === 'update' && !dryRun) {
              Object.assign(hit, data, { version: hit.version + 1, updatedAt: serverTime() });
              return {
                row,
                status: 'updated',
                errors: [],
                id: hit.id,
                duplicateOf: hit.id,
                duplicateRule: r.rule,
              };
            }
            return {
              row,
              status: onDuplicate === 'update' ? 'valid' : dryRun ? 'duplicate' : 'skipped',
              errors: [],
              id: hit.id,
              duplicateOf: hit.id,
              duplicateRule: r.rule,
            };
          }
        }
        if (dryRun)
          return {
            row,
            status: 'valid',
            errors: [],
            id: null,
            duplicateOf: null,
            duplicateRule: null,
          };
        const ts = serverTime();
        const created = {
          ...data,
          id: crypto.randomUUID(),
          companyId: fx.COMPANY_ID,
          createdAt: ts,
          updatedAt: ts,
          deletedAt: null,
          version: 1,
        } as unknown as T;
        rows.push(created);
        return {
          row,
          status: 'created',
          errors: [],
          id: created.id,
          duplicateOf: null,
          duplicateRule: null,
        };
      });
      const count = (st: string) => results.filter((r) => r.status === st).length;
      const job = ImportJob.parse({
        id: crypto.randomUUID(),
        companyId: fx.COMPANY_ID,
        entity: path.replace('/v1/', ''),
        dryRun,
        status: dryRun ? 'validated' : 'completed',
        fileName: fileName ?? null,
        totals: {
          rows: results.length,
          valid: count('valid'),
          created: count('created'),
          updated: count('updated'),
          duplicate: count('duplicate'),
          skipped: count('skipped'),
          error: count('error'),
        },
        results,
        createdBy: fx.me.id,
        createdAt: serverTime(),
      });
      jobs.set(job.id, job);
      return HttpResponse.json(job, { status: dryRun ? 200 : 201 });
    }),
    http.get(`${baseUrl}${path}`, ({ request }) => list(schema, rows, new URL(request.url))),
    http.get(`${baseUrl}${path}/:id`, ({ params }) => {
      const row = rows.find((r) => r.id === params.id);
      return row ? HttpResponse.json(schema.parse(row)) : notFound();
    }),
    http.post(`${baseUrl}${path}`, async ({ request }) => {
      const body = createSchema.safeParse(await request.json());
      if (!body.success)
        return HttpResponse.json(
          {
            error: {
              code: 'VALIDATION',
              message: 'Invalid body',
              details: z.treeifyError(body.error),
            },
          },
          { status: 422 },
        );
      const ts = serverTime();
      const row = {
        ...(body.data as object),
        id: crypto.randomUUID(),
        companyId: fx.COMPANY_ID,
        createdAt: ts,
        updatedAt: ts,
        deletedAt: null,
        version: 1,
      } as unknown as T;
      rows.push(row);
      return HttpResponse.json(schema.parse(row), { status: 201 });
    }),
    http.patch(`${baseUrl}${path}/:id`, async ({ params, request }) => {
      const i = rows.findIndex((r) => r.id === params.id);
      if (i < 0) return notFound();
      const patch = (await request.json()) as Partial<T> & { version: number };
      if (patch.version !== rows[i]!.version)
        return HttpResponse.json(
          { error: { code: 'VERSION_CONFLICT', message: 'Stale version' } },
          { status: 409 },
        );
      rows[i] = { ...rows[i]!, ...patch, version: rows[i]!.version + 1, updatedAt: serverTime() };
      return HttpResponse.json(schema.parse(rows[i]));
    }),
    http.delete(`${baseUrl}${path}/:id`, ({ params }) => {
      const row = rows.find((r) => r.id === params.id);
      if (!row) return notFound();
      row.deletedAt = row.updatedAt = serverTime();
      row.version += 1;
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}

export function createHandlers(baseUrl = '') {
  return [
    http.get(`${baseUrl}/v1/health`, () => HttpResponse.json({ status: 'ok' })),
    http.post(`${baseUrl}/v1/files/upload-url`, () =>
      HttpResponse.json({
        fileKey: 'mock/doctor_photo/2026/10/mock.jpg',
        uploadUrl: 'https://mock-r2.invalid/upload',
        method: 'PUT',
        headers: { 'content-type': 'image/jpeg' },
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      }),
    ),
    http.post(`${baseUrl}/v1/files/download-url`, () =>
      HttpResponse.json({
        downloadUrl: 'https://mock-r2.invalid/download',
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      }),
    ),
    http.post(`${baseUrl}/v1/auth/sign-in/email`, () =>
      HttpResponse.json({
        token: 'mock-token',
        user: { id: fx.me.id, email: fx.me.email, name: fx.me.name },
      }),
    ),
    http.post(`${baseUrl}/v1/auth/sign-out`, () => HttpResponse.json({ success: true })),
    http.get(`${baseUrl}/v1/auth/get-session`, () =>
      HttpResponse.json({
        session: { id: 'mock-session', expiresAt: new Date(Date.now() + 864e5).toISOString() },
        user: { id: fx.me.id, email: fx.me.email, name: fx.me.name },
      }),
    ),
    http.get(`${baseUrl}/v1/me`, () => HttpResponse.json(Me.parse(fx.me))),
    http.get(`${baseUrl}/v1/roles`, () =>
      HttpResponse.json({ items: z.array(Role).parse(fx.roles) }),
    ),
    http.get(`${baseUrl}/v1/territories`, ({ request }) =>
      list(Territory, fx.territories, new URL(request.url)),
    ),
    http.get(`${baseUrl}/v1/territories/:id`, ({ params }) => {
      const t = fx.territories.find((r) => r.id === params.id);
      return t ? HttpResponse.json(Territory.parse(t)) : notFound();
    }),
    http.get(`${baseUrl}/v1/specialties`, ({ request }) =>
      list(Specialty, fx.specialties, new URL(request.url)),
    ),
    http.get(`${baseUrl}/v1/doctor-categories`, ({ request }) =>
      list(DoctorCategory, fx.doctorCategories, new URL(request.url)),
    ),
    ...crud(baseUrl, '/v1/doctors', Doctor, DoctorCreate, fx.doctors),
    ...crud(baseUrl, '/v1/chemists', Chemist, ChemistCreate, fx.chemists),
    ...crud(baseUrl, '/v1/stockists', Stockist, StockistCreate, fx.stockists),
    ...crud(baseUrl, '/v1/products', Product, ProductCreate, fx.products),
    ...crud(baseUrl, '/v1/work-types', WorkType, WorkTypeCreate, fx.workTypes),
    ...fieldHandlers(baseUrl),
  ];
}

function fieldHandlers(baseUrl: string) {
  const checkIns: CheckIn[] = [];
  const tourPlans: TourPlan[] = [];
  const dcrs: Dcr[] = [];
  const approvals = structuredClone(fx.approvals);
  let geofence = { ...fx.geofence };
  const outletRows = (kind: string) =>
    (kind === 'doctor' ? fx.doctors : kind === 'chemist' ? fx.chemists : fx.stockists) as {
      id: string;
      territoryId: string;
      location: { lat: number; lng: number } | null;
    }[];
  const meters = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
    const r = Math.PI / 180;
    const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r);
    const y = (b.lat - a.lat) * r;
    return Math.round(Math.sqrt(x * x + y * y) * 6371000);
  };
  const today = () => new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10);
  const stamp = () => {
    const ts = serverTime();
    return { companyId: fx.COMPANY_ID, createdAt: ts, updatedAt: ts, deletedAt: null, version: 1 };
  };
  const conflict = (message: string, status = 409) =>
    HttpResponse.json({ error: { code: 'CONFLICT', message } }, { status });
  const emptyPlan = (month: string): TourPlan => ({
    ...stamp(),
    id: crypto.randomUUID(),
    userId: fx.me.id,
    month,
    kind: 'mtp',
    status: 'draft',
    days: [],
    submittedAt: null,
    decidedAt: null,
    decidedBy: null,
    decisionComment: null,
  });

  return [
    http.get(`${baseUrl}/v1/divisions`, ({ request }) =>
      list(Division, fx.divisions, new URL(request.url)),
    ),
    http.get(`${baseUrl}/v1/product-hq-mappings`, ({ request }) =>
      list(ProductHqMapping, fx.productHqMappings, new URL(request.url)),
    ),
    http.get(`${baseUrl}/v1/imports/:id`, ({ params }) => {
      const j = jobs.get(String(params.id));
      return j ? HttpResponse.json(j) : notFound();
    }),
    http.get(`${baseUrl}/v1/settings/geofence`, () =>
      HttpResponse.json(GeofenceSettings.parse(geofence)),
    ),
    http.put(`${baseUrl}/v1/settings/geofence`, async ({ request }) => {
      const b = GeofenceSettings.safeParse(await request.json());
      if (!b.success) return validation('Invalid settings', z.treeifyError(b.error));
      if (b.data.version !== geofence.version) return conflict('Stale version');
      geofence = { ...b.data, version: geofence.version + 1 };
      return HttpResponse.json(geofence);
    }),
    http.get(`${baseUrl}/v1/me/consent`, () =>
      HttpResponse.json(ConsentState.parse(fx.consentState)),
    ),
    http.get(`${baseUrl}/v1/check-ins`, ({ request }) =>
      list(CheckIn, checkIns, new URL(request.url)),
    ),
    http.post(`${baseUrl}/v1/check-ins`, async ({ request }) => {
      const b = CheckInCreate.safeParse(await request.json());
      if (!b.success) return validation('Invalid check-in', z.treeifyError(b.error));
      const existing = checkIns.find((c) => c.id === b.data.clientId);
      if (existing) return HttpResponse.json(existing, { status: 200 });
      const date = today();
      const mine = checkIns.filter((c) => c.userId === fx.me.id && c.date === date);
      const hasIn = mine.some((c) => c.kind === 'punch_in');
      const hasOut = mine.some((c) => c.kind === 'punch_out');
      if (b.data.kind === 'punch_in' && hasIn) return conflict('Already punched in');
      if (b.data.kind !== 'punch_in' && (!hasIn || hasOut)) return conflict('Not punched in');
      if (geofence.blockMockLocation && b.data.isMock) return validation('Mock location blocked');
      let distanceM: number | null = null;
      let territoryId: string | null = fx.me.territoryIds[0] ?? null;
      if (b.data.outletKind && b.data.outletId) {
        const o = outletRows(b.data.outletKind).find((x) => x.id === b.data.outletId);
        if (!o) return notFound();
        territoryId = o.territoryId;
        distanceM = o.location ? meters(o.location, b.data.location) : null;
      }
      const inFence = distanceM === null ? null : distanceM <= geofence.radiusM;
      if (inFence === false && geofence.blockOutOfFence)
        return validation(`Outside geofence (${distanceM} m)`);
      const row = CheckIn.parse({
        ...stamp(),
        id: b.data.clientId,
        userId: fx.me.id,
        territoryId,
        date,
        kind: b.data.kind,
        outletKind: b.data.outletKind ?? null,
        outletId: b.data.outletId ?? null,
        location: b.data.location,
        accuracyM: b.data.accuracyM,
        capturedAt: b.data.capturedAt,
        isMock: b.data.isMock,
        receivedAt: serverTime(),
        distanceM,
        inFence,
        selfieFileId: b.data.selfieFileId ?? null,
      });
      checkIns.push(row);
      return HttpResponse.json(row, { status: 201 });
    }),
    http.get(`${baseUrl}/v1/attendance`, ({ request }) => {
      const days = new Map<string, AttendanceDay>();
      for (const c of checkIns) {
        const k = `${c.userId}|${c.date}`;
        const d = days.get(k) ?? {
          userId: c.userId,
          userName: fx.me.name,
          date: c.date,
          status: 'incomplete',
          punchIn: null,
          punchOut: null,
          visits: 0,
          workTypeId: null,
        };
        if (c.kind === 'punch_in') d.punchIn = c;
        else if (c.kind === 'punch_out') d.punchOut = c;
        else d.visits += 1;
        d.status = d.punchIn && d.punchOut ? 'present' : 'incomplete';
        days.set(k, d);
      }
      return list(
        AttendanceDay as unknown as z.ZodType<{ id: string }>,
        [...days.values()].map((d) => ({ ...d, id: `${d.userId}|${d.date}` })) as never,
        new URL(request.url),
      );
    }),
    http.get(`${baseUrl}/v1/tour-plans`, ({ request }) =>
      list(TourPlan, tourPlans, new URL(request.url)),
    ),
    http.get(`${baseUrl}/v1/tour-plans/:month`, ({ params }) => {
      const p = tourPlans.find((t) => t.month === params.month && t.userId === fx.me.id);
      return p ? HttpResponse.json(p) : notFound();
    }),
    http.put(`${baseUrl}/v1/tour-plans/:month`, async ({ params, request }) => {
      const b = TourPlanUpsert.safeParse(await request.json());
      if (!b.success) return validation('Invalid plan', z.treeifyError(b.error));
      const month = String(params.month);
      let p = tourPlans.find((t) => t.month === month && t.userId === fx.me.id);
      if (!p) tourPlans.push((p = emptyPlan(month)));
      else if (!['draft', 'rejected', 'recalled'].includes(p.status))
        return conflict('Plan not editable');
      else if (b.data.version && b.data.version !== p.version) return conflict('Stale version');
      else p.version += 1;
      Object.assign(p, { days: b.data.days, status: 'draft', updatedAt: serverTime() });
      return HttpResponse.json(TourPlan.parse(p));
    }),
    http.post(`${baseUrl}/v1/tour-plans/:month/copy`, ({ params }) => {
      const month = String(params.month);
      if (tourPlans.some((t) => t.month === month && t.userId === fx.me.id))
        return conflict('Plan exists');
      const p = emptyPlan(month);
      tourPlans.push(p);
      return HttpResponse.json(p);
    }),
    http.post(`${baseUrl}/v1/tour-plans/:month/submit`, ({ params }) => {
      const p = tourPlans.find((t) => t.month === params.month && t.userId === fx.me.id);
      if (!p) return notFound();
      if (p.status !== 'draft') return conflict('Not in draft');
      Object.assign(p, { status: 'submitted', submittedAt: serverTime(), version: p.version + 1 });
      approvals.push({
        id: crypto.randomUUID(),
        companyId: fx.COMPANY_ID,
        subjectType: 'tour_plan',
        subjectId: p.id,
        requestedBy: fx.me.id,
        requestedByName: fx.me.name,
        approverId: fx.me.managerId,
        status: 'pending',
        summary: `Tour plan ${p.month}`,
        comment: null,
        createdAt: serverTime(),
        decidedAt: null,
        decidedBy: null,
      });
      return HttpResponse.json(TourPlan.parse(p));
    }),
    http.get(`${baseUrl}/v1/dcrs`, ({ request }) => list(Dcr, dcrs, new URL(request.url))),
    http.get(`${baseUrl}/v1/dcrs/:id`, ({ params }) => {
      const d = dcrs.find((x) => x.id === params.id);
      return d ? HttpResponse.json(d) : notFound();
    }),
    http.put(`${baseUrl}/v1/dcrs`, async ({ request }) => {
      const b = DcrUpsert.safeParse(await request.json());
      if (!b.success) return validation('Invalid DCR', z.treeifyError(b.error));
      let d = dcrs.find((x) => x.date === b.data.date && x.userId === fx.me.id);
      if (d?.status === 'locked') return conflict('Day locked');
      if (d && b.data.version && b.data.version !== d.version) return conflict('Stale version');
      const wt = fx.workTypes.find((w) => w.id === b.data.workTypeId);
      if (wt?.requiresCalls && b.data.submit && b.data.calls.length === 0)
        return validation('Field work needs at least one call');
      const calls = b.data.calls.map(({ clientId, ...c }) => ({ ...c, id: clientId }));
      if (!d) {
        d = {
          ...stamp(),
          id: crypto.randomUUID(),
          userId: fx.me.id,
          tourPlanId: null,
          submittedAt: null,
          status: 'draft',
          date: b.data.date,
          workTypeId: b.data.workTypeId,
          territoryIds: b.data.territoryIds,
          deviationReason: null,
          calls: [],
        };
        dcrs.push(d);
      } else d.version += 1;
      Object.assign(d, {
        workTypeId: b.data.workTypeId,
        territoryIds: b.data.territoryIds,
        deviationReason: b.data.deviationReason ?? null,
        calls,
        updatedAt: serverTime(),
        ...(b.data.submit ? { status: 'submitted', submittedAt: serverTime() } : {}),
      });
      return HttpResponse.json(Dcr.parse(d));
    }),
    http.get(`${baseUrl}/v1/approvals`, ({ request }) =>
      list(Approval, approvals, new URL(request.url)),
    ),
    http.post(`${baseUrl}/v1/approvals/:id/decision`, async ({ params, request }) => {
      const a = approvals.find((x) => x.id === params.id);
      if (!a) return notFound();
      const b = ApprovalDecision.safeParse(await request.json());
      if (!b.success) return validation('Invalid decision', z.treeifyError(b.error));
      if (a.status !== 'pending') return conflict('Already decided');
      Object.assign(a, {
        status: b.data.decision === 'approve' ? 'approved' : 'rejected',
        comment: b.data.comment ?? null,
        decidedAt: serverTime(),
        decidedBy: fx.me.id,
      });
      const tp = tourPlans.find((t) => t.id === a.subjectId);
      if (tp)
        Object.assign(tp, {
          status: a.status,
          decidedAt: a.decidedAt,
          decidedBy: a.decidedBy,
          decisionComment: a.comment,
        });
      return HttpResponse.json(Approval.parse(a));
    }),
  ];
}
