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
import { duplicateKeys, mapImportRow, type ImportLookup } from '../import/templates';
import type { ImportEntity } from '../schemas/imports';
import { SignInEmailBody } from '../schemas/auth';
import { kpiReport, productKpiReport } from './kpis';
import { listNotifications, seedNotifications } from './notifications';
import { teamHandlers, teamProfileHandlers } from './team';
import { signupHandlers } from './signup';
import { expenseHandlers } from './expenses';
import { leaveHandlers, mockLeaveOn, mockWeeklyOffDays } from './leave';
import { mastersGuardHandlers } from './masters-guard';
import {
  Approval,
  ApprovalDecision,
  AttendanceDay,
  CheckIn,
  CheckInCreate,
  UserSummary,
  ConsentState,
  Dcr,
  DcrCorrectionRequest,
  DcrUpsert,
  DCR_UNLOCK_HOURS,
  isDeviation,
  Division,
  GeofenceSettings,
  ImportJob,
  ImportRequest,
  type ImportRowResult,
  Product,
  ProductCreate,
  ProductHqMapping,
  StandardTourPlan,
  StandardTourPlanUpsert,
  TourPlan,
  TourPlanCalendar,
  TourPlanCopy,
  TourPlanUpsert,
  copyFromMonth,
  copyFromStandard,
  istDate,
  missingRequiredDates,
  requiredDates,
  prevMonth,
  WorkType,
  WorkTypeCreate,
} from '../index';

const jobs = new Map<string, ImportJob>();

export { fx as fixtures };

const serverTime = () => new Date().toISOString();
const notFound = () =>
  HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });

const FILTER_SKIP = new Set([
  'limit',
  'cursor',
  'updatedSince',
  'q',
  'sort',
  'includeTotal',
  'unlinked',
  'role',
  'mine',
]);
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
const nextDay = (d: string) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

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

const IMPORT_ENTITY_BY_PATH: Record<string, Exclude<ImportEntity, 'users'>> = {
  '/v1/doctors': 'doctors',
  '/v1/chemists': 'chemists',
  '/v1/stockists': 'stockists',
  '/v1/products': 'products',
};
const lower = (v: unknown) => String(v ?? '').toUpperCase();
const mockLookup: ImportLookup = {
  territory: (c) => fx.territories.find((t) => lower(t.code) === c)?.id,
  specialty: (c) => fx.specialties.find((t) => lower(t.code) === c)?.id,
  category: (c) => fx.doctorCategories.find((t) => lower(t.code) === c)?.id,
  division: (c) => mockDivisions.find((t) => lower(t.code) === c)?.id,
  product: (c) => fx.products.find((t) => lower(t.code) === c)?.id,
};
const mockDivisions = structuredClone(fx.divisions);
const mockTerritoryRows = structuredClone(fx.territories);
const mockHq = structuredClone(fx.productHqMappings);

/** Same algorithm as the API (ImportService): map template row -> validate -> duplicate rules. */
async function mockImport(
  entity: Exclude<ImportEntity, 'users'>,
  existing: Record<string, unknown>[],
  request: Request,
) {
  const parsed = ImportRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return validation('Invalid import', z.treeifyError(parsed.error));
  const { dryRun, rows: input, onDuplicate, fileName, fileKey } = parsed.data;
  const seen = new Map<string, number>();
  const index = new Map<string, Record<string, unknown>>();
  for (const x of existing)
    if (!x.deletedAt) for (const k of duplicateKeys(entity, x)) index.set(`${k.rule}:${k.key}`, x);
  const results: ImportRowResult[] = input.map((raw, i) => {
    const row = i + 1;
    const res = (o: Partial<ImportRowResult>): ImportRowResult => ({
      row,
      status: 'valid',
      errors: [],
      id: null,
      duplicateOf: null,
      duplicateRule: null,
      ...o,
    });
    const m = mapImportRow(entity, raw, mockLookup);
    if (!m.body) return res({ status: 'error', errors: m.errors });
    const data = m.body;
    for (const k of duplicateKeys(entity, data)) {
      const prev = seen.get(`${k.rule}:${k.key}`);
      if (prev)
        return res({
          status: 'error',
          errors: [
            { column: null, code: 'duplicate_in_file', message: `Same ${k.rule} as row ${prev}` },
          ],
          duplicateRule: 'in_file',
        });
    }
    for (const k of duplicateKeys(entity, data)) seen.set(`${k.rule}:${k.key}`, row);
    for (const k of duplicateKeys(entity, data)) {
      const hit = index.get(`${k.rule}:${k.key}`);
      if (!hit) continue;
      const dup = { id: hit.id as string, duplicateOf: hit.id as string, duplicateRule: k.rule };
      if (onDuplicate === 'error')
        return res({
          status: 'error',
          errors: [
            { column: null, code: 'duplicate', message: `Matches existing record by ${k.rule}` },
          ],
          ...dup,
        });
      if (onDuplicate === 'update') {
        if (dryRun) return res({ status: 'valid', ...dup });
        Object.assign(hit, data, { version: Number(hit.version) + 1, updatedAt: serverTime() });
        return res({ status: 'updated', ...dup });
      }
      return res({ status: dryRun ? 'duplicate' : 'skipped', ...dup });
    }
    if (dryRun) return res({ status: 'valid' });
    const ts = serverTime();
    const created = {
      ...data,
      id: crypto.randomUUID(),
      companyId: fx.COMPANY_ID,
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null,
      version: 1,
    };
    existing.push(created);
    return res({ status: 'created', id: created.id });
  });
  const count = (st: string) => results.filter((r) => r.status === st).length;
  const job = ImportJob.parse({
    id: crypto.randomUUID(),
    companyId: fx.COMPANY_ID,
    entity,
    dryRun,
    status: dryRun ? 'validated' : 'completed',
    fileName: fileName ?? null,
    fileKey: fileKey ?? null,
    onDuplicate,
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
}

function crud<
  T extends { id: string; updatedAt: string; version: number; deletedAt: string | null },
>(baseUrl: string, path: string, schema: z.ZodType<T>, createSchema: z.ZodType, seed: T[]) {
  const rows = structuredClone(seed);
  return [
    ...(IMPORT_ENTITY_BY_PATH[path]
      ? [
          http.post(`${baseUrl}${path}/import`, ({ request }) =>
            mockImport(IMPORT_ENTITY_BY_PATH[path]!, rows as never, request),
          ),
        ]
      : []),
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

/**
 * Mock session: `x-mock-user: <role key | email | local part>` header, else a `mock:<role>` token from
 * `authorization: Bearer` or the `better-auth.session_token` cookie, else the default persona (director)
 * unless `x-mock-user: none` (behaves as signed out -> 401).
 */
export function mockPrincipal(request: Request): Me | undefined {
  const h = request.headers.get('x-mock-user');
  if (h) return h === 'none' ? undefined : fx.findMockUser(h);
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+mock:(\S+)$/i)?.[1];
  const cookie = request.headers
    .get('cookie')
    ?.match(/better-auth\.session_token=mock:([^;]+)/)?.[1];
  if (bearer || cookie) return fx.findMockUser(bearer ?? cookie);
  return fx.me;
}
const unauthenticated = () =>
  HttpResponse.json(
    { error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } },
    { status: 401 },
  );

export function createHandlers(baseUrl = '') {
  return [
    ...mastersGuardHandlers(baseUrl, mockPrincipal),
    ...signupHandlers(baseUrl, mockPrincipal),
    ...expenseHandlers(baseUrl, mockPrincipal),
    ...leaveHandlers(baseUrl, mockPrincipal),
    http.get(`${baseUrl}/v1/health`, () => HttpResponse.json({ status: 'ok', warnings: [] })),
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
    http.post(`${baseUrl}/v1/auth/sign-in/email`, async ({ request }) => {
      const b = SignInEmailBody.safeParse(await request.json().catch(() => null));
      const u = b.success ? fx.findMockUser(b.data.email) : undefined;
      if (!u)
        return HttpResponse.json(
          { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' },
          { status: 401 },
        );
      const token = `mock:${u.roles[0]}`;
      return HttpResponse.json(
        { token, user: { id: u.id, email: u.email, name: u.name } },
        {
          headers: {
            'set-auth-token': token,
            'set-cookie': `better-auth.session_token=${token}; Path=/; HttpOnly; SameSite=Lax`,
          },
        },
      );
    }),
    http.post(`${baseUrl}/v1/auth/sign-out`, () =>
      HttpResponse.json(
        { success: true },
        { headers: { 'set-cookie': 'better-auth.session_token=; Path=/; Max-Age=0' } },
      ),
    ),
    http.get(`${baseUrl}/v1/auth/get-session`, ({ request }) => {
      const u = mockPrincipal(request);
      if (!u) return HttpResponse.json(null);
      return HttpResponse.json({
        session: {
          id: `mock-session-${u.roles[0]}`,
          expiresAt: new Date(Date.now() + 864e5).toISOString(),
        },
        user: { id: u.id, email: u.email, name: u.name },
      });
    }),
    http.get(`${baseUrl}/v1/me`, ({ request }) => {
      const u = mockPrincipal(request);
      return u ? HttpResponse.json(Me.parse(u)) : unauthenticated();
    }),
    http.get(`${baseUrl}/v1/roles`, () =>
      HttpResponse.json({ items: z.array(Role).parse(fx.roles) }),
    ),
    http.post(`${baseUrl}/v1/divisions/import`, ({ request }) =>
      mockImport('divisions', mockDivisions as never, request),
    ),
    http.post(`${baseUrl}/v1/territories/import`, ({ request }) =>
      mockImport('territories', mockTerritoryRows as never, request),
    ),
    http.post(`${baseUrl}/v1/product-hq-mappings/import`, ({ request }) =>
      mockImport('product_hq', mockHq as never, request),
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
    ...teamProfileHandlers(baseUrl, mockPrincipal),
    ...teamHandlers(baseUrl, mockPrincipal),
  ];
}

function fieldHandlers(baseUrl: string) {
  const inbox = seedNotifications();
  const checkIns: CheckIn[] = [];
  const tourPlans: TourPlan[] = [];
  let stp: StandardTourPlan | null = null;
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

  /** Day lock (#23): end of the IST day + dcrLockAfterHours; unlocked 48 h after an approved correction. */
  const corrections = new Map<string, string>();
  const unlocked = new Map<string, number>();
  const lockAt = (date: string) =>
    new Date(
      Date.parse(`${date}T00:00:00+05:30`) + 86_400_000 + fx.dcrLockAfterHours * 36e5,
    ).toISOString();
  const isLocked = (date: string) =>
    Date.now() > Date.parse(lockAt(date)) && (unlocked.get(date) ?? 0) < Date.now();
  const withLock = (d: Dcr): Dcr => ({
    ...d,
    lockAt: lockAt(d.date),
    unlockedUntil:
      (unlocked.get(d.date) ?? 0) > Date.now()
        ? new Date(unlocked.get(d.date)!).toISOString()
        : null,
    status: isLocked(d.date) ? 'locked' : d.status === 'locked' ? 'submitted' : d.status,
  });

  return [
    http.get(`${baseUrl}/v1/divisions`, ({ request }) =>
      list(Division, mockDivisions, new URL(request.url)),
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
    http.get(`${baseUrl}/v1/check-ins`, ({ request }) => {
      const url = new URL(request.url);
      // gap #9: unlinked = visit check-ins no DCR call points at yet
      const linked = new Set(dcrs.flatMap((d) => d.calls.map((c) => c.checkInId)));
      const rows =
        url.searchParams.get('unlinked') === 'true'
          ? checkIns.filter((c) => c.kind === 'visit' && !linked.has(c.id))
          : checkIns;
      return list(CheckIn, rows, url);
    }),
    http.get(`${baseUrl}/v1/users`, ({ request }) => {
      const url = new URL(request.url);
      const p = mockPrincipal(request);
      if (!p) return unauthenticated();
      const wide = p.roles.includes('director') || p.roles.includes('system_admin');
      const team = new Set([p.id]);
      for (let grew = true; grew;) {
        grew = false;
        for (const u of fx.mockUsers)
          if (u.managerId && team.has(u.managerId) && !team.has(u.id)) {
            team.add(u.id);
            grew = true;
          }
      }
      const role = url.searchParams.get('role');
      const rows = fx.mockUsers
        .filter((u) => (wide || team.has(u.id)) && (!role || u.roles.includes(role as never)))
        .map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          employeeCode: u.employeeCode,
          roles: u.roles,
          managerId: u.managerId,
          territoryIds: u.territoryIds,
          status: 'active' as const,
        }));
      return list(UserSummary, rows, url);
    }),
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
        selfieFileKey: b.data.selfieFileKey ?? null,
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
          leave: mockLeaveOn(c.userId, c.date),
        };
        if (c.kind === 'punch_in') d.punchIn = c;
        else if (c.kind === 'punch_out') d.punchOut = c;
        else d.visits += 1;
        d.status = d.punchIn && d.punchOut ? 'present' : 'incomplete';
        days.set(k, d);
      }
      // Like the API: every team member gets a row per day; no punch-in = absent (or leave/holiday
      // from the DCR work type).
      const sp = new URL(request.url).searchParams;
      const from = sp.get('from') ?? today();
      const to = sp.get('to') ?? from;
      const who = sp.get('userId')
        ? fx.mockUsers.filter((u) => u.id === sp.get('userId'))
        : [fx.me];
      for (let d = from; d <= to; d = nextDay(d))
        for (const u of who) {
          const k = `${u.id}|${d}`;
          if (days.has(k)) continue;
          const dcr = dcrs.find((x) => x.userId === u.id && x.date === d);
          const kind = fx.workTypes.find((w) => w.id === dcr?.workTypeId)?.kind;
          days.set(k, {
            userId: u.id,
            userName: u.name,
            date: d,
            status:
              mockLeaveOn(u.id, d) || kind === 'leave'
                ? 'leave'
                : kind === 'holiday'
                  ? 'holiday'
                  : 'absent',
            punchIn: null,
            punchOut: null,
            visits: 0,
            workTypeId: dcr?.workTypeId ?? null,
            leave: mockLeaveOn(u.id, d),
          });
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
    http.get(`${baseUrl}/v1/tour-plans/standard`, () =>
      HttpResponse.json(stp ?? { ...stamp(), id: crypto.randomUUID(), userId: fx.me.id, days: [] }),
    ),
    http.put(`${baseUrl}/v1/tour-plans/standard`, async ({ request }) => {
      const b = StandardTourPlanUpsert.safeParse(await request.json());
      if (!b.success) return validation('Invalid plan', z.treeifyError(b.error));
      const keys = b.data.days.map((d) => `${d.week}|${d.weekday}`);
      if (new Set(keys).size !== keys.length) return validation('Duplicate week/weekday');
      if (stp && b.data.version && b.data.version !== stp.version) return conflict('Stale version');
      stp = stp
        ? { ...stp, days: b.data.days, version: stp.version + 1, updatedAt: serverTime() }
        : { ...stamp(), id: crypto.randomUUID(), userId: fx.me.id, days: b.data.days };
      return HttpResponse.json(StandardTourPlan.parse(stp));
    }),
    http.get(`${baseUrl}/v1/tour-plans/:month/calendar`, ({ params }) => {
      const month = String(params.month);
      const todayIST = istDate();
      const weeklyOffDays = mockWeeklyOffDays();
      return HttpResponse.json(
        TourPlanCalendar.parse({
          month,
          todayIST,
          weeklyOffDays,
          requiredDates: requiredDates(month, todayIST, weeklyOffDays),
        }),
      );
    }),
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
    http.post(`${baseUrl}/v1/tour-plans/:month/copy`, async ({ params, request }) => {
      const b = TourPlanCopy.safeParse(await request.json().catch(() => ({})));
      if (!b.success) return validation('Invalid copy', z.treeifyError(b.error));
      const month = String(params.month);
      let p = tourPlans.find((t) => t.month === month && t.userId === fx.me.id);
      if (p && !['draft', 'rejected', 'recalled'].includes(p.status))
        return conflict('Plan not editable');
      let days: TourPlan['days'];
      if (b.data.fromMonth || !b.data.fromStp) {
        const from = b.data.fromMonth ?? prevMonth(month);
        const src = tourPlans.find((t) => t.month === from && t.userId === fx.me.id);
        if (!src) return notFound();
        days = copyFromMonth(month, src.days);
      } else {
        if (!stp) return notFound();
        days = copyFromStandard(month, stp.days);
      }
      if (!p) tourPlans.push((p = emptyPlan(month)));
      else p.version += 1;
      Object.assign(p, { days, status: 'draft', updatedAt: serverTime() });
      return HttpResponse.json(TourPlan.parse(p));
    }),
    http.post(`${baseUrl}/v1/tour-plans/:month/submit`, ({ params }) => {
      const p = tourPlans.find((t) => t.month === params.month && t.userId === fx.me.id);
      if (!p) return notFound();
      if (p.status !== 'draft') return conflict('Not in draft');
      const todayIST = istDate();
      const weeklyOffDays = mockWeeklyOffDays();
      const missing = missingRequiredDates(p.month, p.days, todayIST, weeklyOffDays).filter(
        (d) => !mockLeaveOn(fx.me.id, d),
      );
      if (missing.length)
        return validation(
          `${missing.length} required date(s) have no plan entry (weekly offs and, this month, past days are not required)`,
          { missingDates: missing, todayIST, weeklyOffDays },
        );
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
    http.get(`${baseUrl}/v1/dcrs`, ({ request }) =>
      list(Dcr, dcrs.map(withLock), new URL(request.url)),
    ),
    http.get(`${baseUrl}/v1/rcpa/competitor-brands`, ({ request }) => {
      const q = (new URL(request.url).searchParams.get('q') ?? '').trim().toLowerCase();
      const counts = new Map<string, { brand: string; company: string | null; uses: number }>();
      for (const l of dcrs.flatMap((d) => d.calls.flatMap((c) => c.rcpa))) {
        if (!l.competitorBrand) continue;
        const k = l.competitorBrand.toLowerCase();
        const e = counts.get(k) ?? { brand: l.competitorBrand, company: null, uses: 0 };
        e.uses += 1;
        e.company ??= l.competitorCompany ?? null;
        counts.set(k, e);
      }
      const items = [...counts.entries()]
        .filter(([k]) => !q || k.split(' ').some((w) => w.startsWith(q)) || k.startsWith(q))
        .map(([, v]) => v)
        .sort((a, b) => b.uses - a.uses || a.brand.localeCompare(b.brand))
        .slice(0, 20);
      return HttpResponse.json({ items });
    }),
    http.get(`${baseUrl}/v1/dcrs/:id`, ({ params }) => {
      const d = dcrs.find((x) => x.id === params.id);
      return d ? HttpResponse.json(withLock(d)) : notFound();
    }),
    http.put(`${baseUrl}/v1/dcrs`, async ({ request }) => {
      const b = DcrUpsert.safeParse(await request.json());
      if (!b.success) return validation('Invalid DCR', z.treeifyError(b.error));
      if (b.data.date > today()) return validation('DCR date is in the future');
      let d = dcrs.find((x) => x.date === b.data.date && x.userId === fx.me.id);
      if (isLocked(b.data.date)) return conflict('Day locked; request a correction');
      if (d && b.data.version && b.data.version !== d.version) return conflict('Stale version');
      const wt = fx.workTypes.find((w) => w.id === b.data.workTypeId);
      if (!wt) return validation('Unknown work type');
      if (wt.requiresCalls && b.data.submit && b.data.calls.length === 0)
        return validation('Field work needs at least one call');
      if (!wt.requiresCalls && b.data.calls.length)
        return validation('Calls need a field work type');
      const tp = tourPlans.find(
        (t) =>
          t.userId === fx.me.id && t.month === b.data.date.slice(0, 7) && t.status === 'approved',
      );
      const planned = tp?.days.find((x) => x.date === b.data.date)?.entries ?? [];
      if (
        isDeviation(planned, b.data.workTypeId, b.data.territoryIds) &&
        !b.data.deviationReason?.trim()
      )
        return HttpResponse.json(
          {
            error: {
              code: 'DEVIATION_REASON_REQUIRED',
              message: 'Worked plan differs from the approved tour plan; give a reason',
            },
          },
          { status: 422 },
        );
      // #40: POB on any call (doctor/chemist/stockist), RCPA on chemist calls only, no duplicate lines.
      const rcpaOutletCallIds = b.data.calls
        .filter((c) => c.rcpa.length && c.outletKind !== 'chemist')
        .map((c) => c.clientId);
      const dup = (keys: string[]) => new Set(keys).size !== keys.length;
      const duplicatePob = b.data.calls
        .filter((c) => dup(c.pob.map((l) => l.productId)))
        .map((c) => c.clientId);
      const duplicateRcpa = b.data.calls
        .filter((c) =>
          dup(c.rcpa.map((l) => `${l.productId}|${(l.competitorBrand ?? '').toLowerCase()}`)),
        )
        .map((c) => c.clientId);
      if (rcpaOutletCallIds.length || duplicatePob.length || duplicateRcpa.length)
        return validation('Invalid POB/RCPA lines', {
          rcpaOutletCallIds,
          duplicatePob,
          duplicateRcpa,
        });
      const ptr = (id: string) => fx.products.find((p) => p.id === id)?.ptr ?? null;
      const calls = b.data.calls.map(({ clientId, ...c }) => ({
        ...c,
        id: clientId,
        pob: c.pob.map((l) => {
          const r = ptr(l.productId);
          return { ...l, value: r == null ? null : Math.round(l.quantity * r * 100) / 100 };
        }),
      }));
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
          lockAt: lockAt(b.data.date),
          unlockedUntil: null,
        };
        dcrs.push(d);
      } else d.version += 1;
      Object.assign(d, {
        workTypeId: b.data.workTypeId,
        territoryIds: b.data.territoryIds,
        tourPlanId: tp?.id ?? null,
        deviationReason: b.data.deviationReason ?? null,
        calls,
        updatedAt: serverTime(),
        ...(b.data.submit ? { status: 'submitted', submittedAt: serverTime() } : {}),
      });
      return HttpResponse.json(Dcr.parse(withLock(d)));
    }),
    http.post(`${baseUrl}/v1/dcrs/correction-requests`, async ({ request }) => {
      const b = DcrCorrectionRequest.safeParse(await request.json());
      if (!b.success) return validation('Invalid request', z.treeifyError(b.error));
      if (!isLocked(b.data.date)) return conflict('Day is not locked');
      const a: Approval = {
        id: crypto.randomUUID(),
        companyId: fx.COMPANY_ID,
        subjectType: 'dcr_unlock',
        subjectId:
          dcrs.find((x) => x.date === b.data.date && x.userId === fx.me.id)?.id ??
          crypto.randomUUID(),
        requestedBy: fx.me.id,
        requestedByName: fx.me.name,
        approverId: fx.me.managerId,
        status: 'pending',
        summary: `DCR correction ${b.data.date}`,
        comment: null,
        createdAt: serverTime(),
        decidedAt: null,
        decidedBy: null,
      };
      approvals.push(a);
      corrections.set(a.id, b.data.date);
      return HttpResponse.json(a, { status: 201 });
    }),
    http.get(`${baseUrl}/v1/approvals`, ({ request }) => {
      const url = new URL(request.url);
      const mine = url.searchParams.get('mine');
      const rows =
        mine === 'to_decide'
          ? approvals.filter((a) => a.status === 'pending' && a.requestedBy !== fx.me.id)
          : mine === 'requested'
            ? approvals.filter((a) => a.requestedBy === fx.me.id)
            : approvals;
      return list(Approval, rows, url);
    }),
    http.post(`${baseUrl}/v1/approvals/:id/decision`, async ({ params, request }) => {
      const a = approvals.find((x) => x.id === params.id);
      if (!a) return notFound();
      const b = ApprovalDecision.safeParse(await request.json());
      if (!b.success) return validation('Invalid decision', z.treeifyError(b.error));
      if (a.requestedBy === fx.me.id)
        return HttpResponse.json(
          { error: { code: 'FORBIDDEN', message: 'You cannot decide your own request' } },
          { status: 403 },
        );
      if (a.status !== 'pending') return conflict('Already decided');
      Object.assign(a, {
        status: b.data.decision === 'approve' ? 'approved' : 'rejected',
        comment: b.data.comment ?? null,
        decidedAt: serverTime(),
        decidedBy: fx.me.id,
      });
      const day = corrections.get(a.id);
      if (day && b.data.decision === 'approve')
        unlocked.set(day, Date.now() + DCR_UNLOCK_HOURS * 36e5);
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
    http.get(`${baseUrl}/v1/kpis`, ({ request }) => {
      const r = kpiReport(new URL(request.url));
      return 'error' in r ? validation(r.error) : HttpResponse.json(r);
    }),
    http.get(`${baseUrl}/v1/kpis/products`, ({ request }) => {
      const r = productKpiReport(new URL(request.url));
      return 'error' in r ? validation(r.error) : HttpResponse.json(r);
    }),
    // ---- notifications (#35): the mock user's own inbox ----
    http.get(`${baseUrl}/v1/notifications`, ({ request }) => {
      const r = listNotifications(inbox, new URL(request.url));
      return 'error' in r ? validation(r.error) : HttpResponse.json(r);
    }),
    http.get(`${baseUrl}/v1/notifications/unread-count`, () =>
      HttpResponse.json({ count: inbox.filter((n) => !n.readAt).length }),
    ),
    http.post(`${baseUrl}/v1/notifications/read-all`, () => {
      const now = new Date().toISOString();
      let updated = 0;
      for (const n of inbox)
        if (!n.readAt) {
          n.readAt = now;
          updated++;
        }
      return HttpResponse.json({ updated });
    }),
    http.post(`${baseUrl}/v1/notifications/:id/read`, ({ params }) => {
      const n = inbox.find((x) => x.id === params.id);
      if (!n) return notFound();
      n.readAt ??= new Date().toISOString();
      return HttpResponse.json(n);
    }),
    http.get(`${baseUrl}/v1/jobs/stats`, () =>
      HttpResponse.json({ queued: 0, running: 0, done: 12, dead: 0 }),
    ),
  ];
}
