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
import { RoleKey, isRetiredRole } from '../schemas/roles';
import { assignableTerritoryLevels } from '../schemas/territories';
import { duplicateKeys, mapImportRow, type ImportLookup } from '../import/templates';
import type { ImportEntity } from '../schemas/imports';
import { SignInEmailBody } from '../schemas/auth';
import { UploadUrlRequest } from '../schemas/files';
import { kpiReport, productKpiReport } from './kpis';
import { listNotifications, seedNotifications } from './notifications';
import { teamHandlers, teamProfileHandlers } from './team';
import { signupHandlers } from './signup';
import { passwordResetHandlers } from './password-reset';
import { allowanceHandlers } from './allowances';
import { sfcHandlers } from './sfc';
import { expenseHandlers } from './expenses';
import { exceptionHandlers } from './exceptions';
import { productPriceHandlers } from './product-prices';
import { leaveHandlers, mockLeaveOn, mockWeeklyOffDays, setMockSubmittedDcrLookup } from './leave';
import { mastersGuardHandlers } from './masters-guard';
import { territoryLinkHandlers } from './territory-links';
import {
  Approval,
  ApprovalDetail,
  type ApprovalSubject,
  ApprovalDecision,
  AttendanceDay,
  CheckIn,
  CheckInCreate,
  UserSummary,
  ConsentState,
  Dcr,
  DcrCorrectionRequest,
  DcrUpsert,
  DcrDraftPut,
  DcrOptions,
  DcrOptionsQuery,
  DcrDecision,
  DcrSfcMatch,
  DcrSfcMatchQuery,
  DcrSubmit,
  dcrDetailsKind,
  DCR_UNLOCK_HOURS,
  isDeviation,
  Division,
  GeofenceSettings,
  ImportJob,
  ImportRequest,
  type ImportRowResult,
  Product,
  productDisplayName,
  groupDetailProducts,
  tpItemCard,
  tpItemFiledDates,
  TourPlanItem,
  TourPlanItemDecision,
  TourPlanItemList,
  TourPlanItemListQuery,
  TourPlanItemUpsert,
  ProductCreate,
  ProductHqMapping,
  StandardTourPlan,
  StandardTourPlanUpsert,
  TourPlan,
  TourPlanCalendar,
  TourPlanCopy,
  TourPlanSubmit,
  TourPlanUpsert,
  copyFromMonth,
  copyFromStandard,
  istDate,
  hasPlannedDay,
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
      } else if (k === 'localTerritoryId' && v === 'none') {
        if (o.localTerritoryId) return false;
      } else if (k === 'ids') {
        if (!v.toLowerCase().split(',').includes(r.id.toLowerCase())) return false;
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
>(
  baseUrl: string,
  path: string,
  schema: z.ZodType<T>,
  createSchema: z.ZodType,
  seed: T[],
  /** Entity rules before insert: return a Response to refuse, or extra fields for the row. */
  onCreate?: (
    body: Record<string, unknown>,
    request: Request,
    rows: T[],
  ) => Response | Record<string, unknown>,
  /** false = `seed` is already a private copy shared with other handlers. */
  clone = true,
) {
  const rows = clone ? structuredClone(seed) : seed;
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
      const extra = onCreate?.(body.data as Record<string, unknown>, request, rows) ?? {};
      if (extra instanceof Response) return extra;
      const ts = serverTime();
      const row = {
        ...(body.data as object),
        ...extra,
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
import { doctorHandlers } from './doctors';

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
  // Shared with the territory link import mock, which sets localTerritoryId on these rows.
  const doctorRows = structuredClone(fx.doctors);
  const chemistRows = structuredClone(fx.chemists);
  return [
    ...territoryLinkHandlers(baseUrl, mockPrincipal, doctorRows, chemistRows),
    ...mastersGuardHandlers(baseUrl, mockPrincipal),
    ...productPriceHandlers(baseUrl, mockPrincipal),
    ...signupHandlers(baseUrl, mockPrincipal),
    ...passwordResetHandlers(baseUrl),
    ...expenseHandlers(baseUrl, mockPrincipal),
    ...allowanceHandlers(baseUrl, mockPrincipal),
    ...sfcHandlers(baseUrl, mockPrincipal),
    ...leaveHandlers(baseUrl, mockPrincipal),
    ...exceptionHandlers(baseUrl, mockPrincipal),
    http.get(`${baseUrl}/v1/health`, () => HttpResponse.json({ status: 'ok', warnings: [] })),
    http.post(`${baseUrl}/v1/files/upload-url`, async ({ request }) => {
      // Same validation as the API (e.g. product_image: jpeg/png/webp, <= 5 MB); key echoes the purpose.
      const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      const b = UploadUrlRequest.safeParse(raw ?? { purpose: 'doctor_photo' });
      if (raw && !b.success)
        return HttpResponse.json(
          {
            error: { code: 'VALIDATION', message: b.error.issues.map((i) => i.message).join('; ') },
          },
          { status: 422 },
        );
      const purpose = b.success ? b.data.purpose : 'doctor_photo';
      const type = b.success ? b.data.contentType : 'image/jpeg';
      const ext = { 'image/png': 'png', 'image/webp': 'webp' }[type as string] ?? 'jpg';
      return HttpResponse.json({
        fileKey: `mock/${purpose}/2026/10/${crypto.randomUUID()}.${ext}`,
        uploadUrl: 'https://mock-r2.invalid/upload',
        method: 'PUT',
        headers: {
          'content-type': type,
          ...(b.success ? { 'content-length': String(b.data.sizeBytes) } : {}),
        },
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      });
    }),
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
      HttpResponse.json({
        items: z.array(Role).parse(fx.roles.filter((r) => !isRetiredRole(r.key))),
      }),
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
    http.get(`${baseUrl}/v1/territories`, ({ request }) => {
      const url = new URL(request.url);
      const lvl = url.searchParams.get('level');
      const role = RoleKey.safeParse(url.searchParams.get('assignableForRole'));
      const ok = role.success ? assignableTerritoryLevels(role.data) : null;
      return list(
        Territory,
        fx.territories.filter((t) => (!lvl || t.level === lvl) && (!ok || ok.includes(t.level))),
        url,
      );
    }),
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
    ...doctorHandlers(
      baseUrl,
      (b, rows) => crud(baseUrl, '/v1/doctors', Doctor, DoctorCreate, rows, b, false),
      doctorRows,
    ),
    ...crud(baseUrl, '/v1/chemists', Chemist, ChemistCreate, chemistRows, undefined, false),
    ...crud(baseUrl, '/v1/stockists', Stockist, StockistCreate, fx.stockists),
    ...crud(
      baseUrl,
      '/v1/products',
      // displayName is derived from name on every read (create, patch and import included).
      z.preprocess(
        (r) => ({
          ...(r as object),
          displayName: productDisplayName((r as { name: string }).name),
        }),
        Product,
      ) as unknown as z.ZodType<Product>,
      ProductCreate,
      fx.products,
    ),
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
  /** Tour plan items (TP feature); single-user mock: queue/decision only see other users' items. */
  const tpItems: TourPlanItem[] = [];
  const itemOut = (it: TourPlanItem): TourPlanItem => ({
    ...it,
    filedDates: tpItemFiledDates(
      it.from,
      it.to,
      dcrs.filter((x) => x.userId === it.userId),
    ),
  });
  let stp: StandardTourPlan | null = null;
  const dcrs: Dcr[] = [];
  setMockSubmittedDcrLookup((userId, from, to) =>
    dcrs
      .filter((d) => d.userId === userId && d.status === 'submitted' && !d.deletedAt)
      .filter((d) => d.date >= from && d.date <= to)
      .map((d) => ({ id: d.id, date: d.date })),
  );
  const submitKeys = new Map<string, string>();
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
  const dcrError = (status: number, code: string, message: string, details?: unknown) =>
    HttpResponse.json({ error: { code, message, details } }, { status });
  /** Mock band: field work types are 'hq' (fixtures carry no allowance band). */
  const mockBand = (w: { kind: string }) => (w.kind === 'field' ? ('hq' as const) : null);
  const mockHqs = () => fx.territories.filter((t) => ['headquarter', 'area'].includes(t.level));
  const hqOf = (id: string) => {
    const t = fx.territories.find((x) => x.id === id);
    if (!t) return null;
    return t.level === 'territory' ? t.parentId : t.id;
  };
  /** One synthetic SFC candidate per HQ (category hq). */
  const mockCandidate = (hqId: string) => ({
    id: `0193ffff-0000-7000-8000-${hqId.slice(-12)}`,
    fromPlace: 'HQ',
    toPlace: 'Market',
    oneWayKm: 10,
    bothWayKm: 20,
    oneWayAmount: 29.5,
    bothWayAmount: 59,
    actualFare: false,
    travelMode: 'bike' as const,
    category: 'hq' as const,
    band: 'hq' as const,
    da: 150,
    version: 1,
    source: 'own' as const,
  });
  // Multi-draft: several drafts per user and day, at most one submitted report.
  const myDay = (date: string) => dcrs.filter((x) => x.date === date && x.userId === fx.me.id);
  const submittedOf = (date: string) =>
    myDay(date).find((x) => x.status !== 'draft' && x.status !== 'rejected');
  const rejectedOf = (date: string) =>
    myDay(date)
      .filter((x) => x.status === 'rejected')
      .sort((a, b) => (b.rejectedAt ?? '').localeCompare(a.rejectedAt ?? ''));
  const productOptions = () =>
    fx.products
      .filter((p) => p.active && !p.deletedAt)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({
        ...p,
        displayName: productDisplayName(p.name),
        imageFileKey: p.imageFileKey ?? null,
        imageUrl: p.imageUrl ?? null,
      }));
  const draftsOf = (date: string) =>
    myDay(date)
      .filter((x) => x.status === 'draft')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
  const dcrFlowHandlers = () => [
    http.get(`${baseUrl}/v1/dcrs/options`, ({ request }) => {
      const q = DcrOptionsQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
      if (!q.success) return validation('Invalid query', z.treeifyError(q.error));
      const sub = submittedOf(q.data.date);
      const drafts = draftsOf(q.data.date);
      const d = sub ?? drafts[0];
      return HttpResponse.json(
        DcrOptions.parse({
          date: q.data.date,
          workTypes: fx.workTypes
            .filter((w) => w.active)
            .map((w) => ({
              id: w.id,
              code: w.code,
              name: w.name,
              kind: w.kind,
              band: mockBand(w),
              usesSfc: mockBand(w) !== null,
              detailsKind: dcrDetailsKind(w),
            })),
          dcr: d ? withLock(d) : null,
          submitted: sub ? withLock(sub) : null,
          drafts: drafts.map(withLock),
          rejected: rejectedOf(q.data.date).map(withLock),
          unlockRequest: [...corrections].some(([, day]) => day === q.data.date)
            ? {
                id: [...corrections].filter(([, day]) => day === q.data.date).at(-1)![0],
                status: (unlocked.get(q.data.date) ?? 0) > Date.now() ? 'approved' : 'pending',
                requestedAt: serverTime(),
              }
            : null,
          tourPlanDrafts: tpItems
            .filter((it) => it.userId === fx.me.id)
            .sort((a, b) => a.from.localeCompare(b.from))
            .flatMap((it) => {
              const c = tpItemCard(
                it,
                dcrs.filter((x) => x.userId === fx.me.id),
                today(),
              );
              return c ? [{ ...itemOut(it), ...c }] : [];
            }),
          products: productOptions(),
          detailProducts: groupDetailProducts(DcrOptions.shape.products.parse(productOptions())),
          // Mock keeps client-side TA/DA drafting (the server setting is off here).
          autoExpenseOnDcrSubmit: false,
        }),
      );
    }),
    http.get(`${baseUrl}/v1/dcrs/territories`, () =>
      HttpResponse.json({
        items: mockHqs().map((h) => ({
          id: h.id,
          code: h.code,
          name: h.name,
          territories: fx.territories
            .filter((t) => t.level === 'territory' && t.parentId === h.id)
            .map((t) => ({ id: t.id, code: t.code, name: t.name })),
        })),
      }),
    ),
    http.get(`${baseUrl}/v1/dcrs/work-with`, ({ request }) => {
      const q = (new URL(request.url).searchParams.get('q') ?? '').toLowerCase();
      return HttpResponse.json({
        items: fx.mockUsers
          .filter((u) => u.id !== fx.me.id && (!q || u.name.toLowerCase().includes(q)))
          .map((u) => ({
            id: u.id,
            name: u.name,
            employeeCode: u.employeeCode ?? null,
            designation: null,
          })),
      });
    }),
    http.get(`${baseUrl}/v1/dcrs/sfc-match`, ({ request }) => {
      const q = DcrSfcMatchQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
      if (!q.success) return validation('Invalid query', z.treeifyError(q.error));
      const wt = fx.workTypes.find((w) => w.id === q.data.workTypeId);
      const band = wt ? mockBand(wt) : null;
      if (!band) return validation('SFC applies to field work types only');
      const hqIds = [...new Set(q.data.territoryIds.map(hqOf))];
      if (hqIds.some((h) => !h)) return validation('Unknown territories');
      return HttpResponse.json(
        DcrSfcMatch.parse({
          band,
          hqs: (hqIds as string[]).map((h) => ({
            hqTerritoryId: h,
            hqName: fx.territories.find((t) => t.id === h)?.name ?? '',
            candidates: [mockCandidate(h)],
            autoSelectedId: mockCandidate(h).id,
          })),
        }),
      );
    }),
    http.put(`${baseUrl}/v1/dcrs/draft`, async ({ request }) => {
      const b = DcrDraftPut.safeParse(await request.json());
      if (!b.success) return validation('Invalid DCR', z.treeifyError(b.error));
      const tpItem = tpItems.find(
        (it) =>
          it.userId === fx.me.id &&
          it.status === 'approved' &&
          it.from <= b.data.date &&
          it.to >= b.data.date,
      );
      if (b.data.tourPlanItemId && b.data.tourPlanItemId !== tpItem?.id)
        return dcrError(422, 'VALIDATION', 'Not your approved tour plan for this date', {
          field: 'tourPlanItemId',
          reason: 'TOUR_PLAN_ITEM_MISMATCH',
        });
      if (b.data.date > today() && !b.data.tourPlanItemId)
        return validation('DCR date is in the future');
      if (isLocked(b.data.date))
        return dcrError(409, 'DAY_LOCKED', 'Day locked; request a correction');
      let d: (typeof dcrs)[number] | undefined;
      if (b.data.id) {
        d = dcrs.find((x) => x.id === b.data.id && x.userId === fx.me.id);
        if (!d) return notFound();
        if (d.status !== 'draft')
          return dcrError(409, 'ALREADY_SUBMITTED', 'Read-only after submit');
        if (d.date !== b.data.date)
          return validation('date must equal the draft date', { field: 'date' });
      }
      const sub = submittedOf(b.data.date);
      if (sub)
        return dcrError(409, 'DAY_ALREADY_SUBMITTED', 'This day already has a submitted report', {
          existingId: sub.id,
        });
      // Older clients send no id but the version of the draft they loaded: update the latest draft.
      if (!b.data.id && b.data.version) d = draftsOf(b.data.date)[0];
      if (d && b.data.version && b.data.version !== d.version)
        return dcrError(409, 'VERSION_CONFLICT', 'Stale version');
      const wt = fx.workTypes.find((w) => w.id === b.data.workTypeId);
      if (!wt) return validation('Unknown work type');
      const band = mockBand(wt);
      if (wt.kind !== 'field' && b.data.calls.length)
        return validation('Calls need a field work type');
      if (!band && b.data.sfcRoutes?.length)
        return validation('SFC applies to field work types only');
      const want = dcrDetailsKind(wt);
      if (b.data.details && b.data.details.kind !== want)
        return validation(`details.kind must be '${want}'`, { field: 'details' });
      const hqIds = b.data.territoryIds.map(hqOf);
      if (hqIds.some((h) => !h)) return validation('Unknown territories');
      const foreign = (b.data.sfcRoutes ?? []).filter((r) => !hqIds.includes(r.hqTerritoryId));
      if (foreign.length)
        return dcrError(422, 'SFC_MISMATCH', 'Route HQ is not an HQ of the day', {
          hqTerritoryIds: foreign.map((r) => r.hqTerritoryId),
        });
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
          territoryIds: [],
          deviationReason: null,
          calls: [],
          lockAt: lockAt(b.data.date),
          unlockedUntil: null,
          band: null,
          details: null,
          workWithUserIds: [],
          sfcRoutes: [],
          submittedBy: null,
          reviewStatus: null,
          approvedAt: null,
          approvedBy: null,
          rejectedAt: null,
          rejectedBy: null,
          rejectionReason: null,
        };
        dcrs.push(d);
      } else d.version += 1;
      Object.assign(d, {
        workTypeId: b.data.workTypeId,
        territoryIds: b.data.territoryIds,
        deviationReason: b.data.deviationReason ?? null,
        band,
        details: b.data.details ?? null,
        workWithUserIds: b.data.workWithUserIds,
        calls: b.data.calls.map(({ clientId, ...c }) => ({
          ...c,
          id: clientId,
          pob: c.pob.map((l) => ({ ...l, value: null })),
        })),
        ...(b.data.sfcRoutes
          ? { sfcRoutes: band ? b.data.sfcRoutes.map((r) => ({ ...r, snapshot: null })) : [] }
          : {}),
        updatedAt: serverTime(),
      });
      return HttpResponse.json(Dcr.parse(withLock(d)));
    }),
    http.post(`${baseUrl}/v1/dcrs/:id/submit`, async ({ params, request }) => {
      const d = dcrs.find((x) => x.id === params.id && x.userId === fx.me.id);
      if (!d) return notFound();
      const key = request.headers.get('idempotency-key');
      if (!key) return validation('Idempotency-Key header is required');
      const b = DcrSubmit.safeParse(await request.json());
      if (!b.success) return validation('Invalid body', z.treeifyError(b.error));
      // Same-key retry, also for a director's report (approved at submit).
      if ((d.status === 'submitted' || d.status === 'approved') && submitKeys.get(d.id) === key)
        return HttpResponse.json({ ...Dcr.parse(withLock(d)), expenseDraft: null });
      if (d.status === 'submitted') return dcrError(409, 'ALREADY_SUBMITTED', 'Already submitted');
      if (d.status !== 'draft')
        return dcrError(409, 'ALREADY_SUBMITTED', 'Reviewed DCRs are read-only', {
          id: d.id,
          status: d.status,
        });
      if (b.data.version !== d.version) return dcrError(409, 'VERSION_CONFLICT', 'Stale version');
      if (isLocked(d.date)) return dcrError(409, 'DAY_LOCKED', 'Day locked');
      const noPres = d.calls.flatMap((c, i) =>
        c.outletKind === 'doctor' && c.productsDetailed.length && !c.presentationOpenedAt
          ? [{ i, id: c.id }]
          : [],
      );
      if (noPres.length)
        return validation('Open the presentation on every doctor call with products detailed', {
          reason: 'PRESENTATION_NOT_OPENED',
          callIndexes: noPres.map((x) => x.i),
          callIds: noPres.map((x) => x.id),
        });
      const other = submittedOf(d.date);
      if (other)
        return dcrError(409, 'DAY_ALREADY_SUBMITTED', 'This day already has a submitted report', {
          existingId: other.id,
        });
      const wt = fx.workTypes.find((w) => w.id === d.workTypeId)!;
      const band = mockBand(wt);
      const want = dcrDetailsKind(wt);
      if (want && (!d.details || d.details.kind !== want))
        return validation(`details (kind '${want}') are required`, { field: 'details' });
      if (band && !d.territoryIds.length) return validation('Pick at least one territory');
      if (band && !d.calls.length) return validation('Field work needs at least one call');
      const hqIds = [...new Set(d.territoryIds.map(hqOf))] as string[];
      const frozenAt = serverTime();
      const routes = band
        ? hqIds.map((h) => {
            const c = mockCandidate(h);
            const { id, version, ...rest } = c;
            return {
              hqTerritoryId: h,
              sfcRouteId: id,
              snapshot: {
                ...rest,
                sfcRouteId: id,
                routeVersion: version,
                hqTerritoryId: h,
                ratePerKm: 2.95,
                frozenAt,
              },
            };
          })
        : [];
      submitKeys.set(d.id, key);
      // Directors have no manager: the report is approved by the system at submit.
      const auto = fx.me.roles.includes('director');
      Object.assign(d, {
        status: auto ? 'approved' : 'submitted',
        ...(auto ? { approvedAt: frozenAt, approvedBy: null, autoApproved: true } : {}),
        submittedAt: frozenAt,
        submittedBy: fx.me.id,
        sfcRoutes: routes,
        version: d.version + 1,
        updatedAt: frozenAt,
      });
      return HttpResponse.json({ ...Dcr.parse(withLock(d)), expenseDraft: null });
    }),
    http.delete(`${baseUrl}/v1/dcrs/:id`, ({ params }) => {
      const d = dcrs.find((x) => x.id === params.id && x.userId === fx.me.id);
      if (!d) return notFound();
      if (d.status !== 'draft')
        return dcrError(409, 'ALREADY_SUBMITTED', 'Submitted DCRs are read-only');
      if (isLocked(d.date)) return dcrError(409, 'DAY_LOCKED', 'Day locked');
      Object.assign(d, {
        deletedAt: serverTime(),
        updatedAt: serverTime(),
        version: d.version + 1,
      });
      return new HttpResponse(null, { status: 204 });
    }),
  ];
  // #86: per-day status. Submitted/approved days are locked; the month status is an aggregate.
  const LOCKED = ['submitted', 'approved'];
  const dayLock = (p: TourPlan) =>
    new Map(
      p.days
        .filter((d) => d.status && LOCKED.includes(d.status))
        .map((d) => [d.date, JSON.stringify(d.entries)]),
    );
  const lockedConflict = (dates: string[]) =>
    HttpResponse.json(
      {
        error: {
          code: 'DAY_LOCKED',
          message: 'Submitted or approved days cannot be changed',
          details: { dates },
        },
      },
      { status: 409 },
    );
  const reaggregate = (p: TourPlan) => {
    const st = p.days.filter((d) => d.entries.length).map((d) => d.status ?? 'draft');
    p.status = st.includes('submitted')
      ? 'submitted'
      : st.includes('rejected')
        ? 'rejected'
        : st.length && st.every((x) => x === 'approved')
          ? 'approved'
          : 'draft';
  };
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
    submitterNote: null,
    rejectionReason: null,
    rejectedBy: null,
    rejectedAt: null,
    submissions: [],
  });

  /** Day lock: 00:00 IST the next day; unlocked 48 h after an approved correction or a rejection. */
  const corrections = new Map<string, string>();
  const unlocked = new Map<string, number>();
  const lockAt = (date: string) =>
    new Date(Date.parse(`${date}T00:00:00+05:30`) + 86_400_000).toISOString();
  // Directors' days never lock (no manager to unlock them).
  const neverLocks = () => fx.me.roles.includes('director');
  const isLocked = (date: string) =>
    !neverLocks() &&
    Date.now() > Date.parse(lockAt(date)) &&
    (unlocked.get(date) ?? 0) < Date.now();
  const withLock = (d: Dcr): Dcr => ({
    ...d,
    neverLocks: neverLocks(),
    lockAt: lockAt(d.date),
    unlockedUntil:
      (unlocked.get(d.date) ?? 0) > Date.now()
        ? new Date(unlocked.get(d.date)!).toISOString()
        : null,
    status:
      d.status === 'approved' || d.status === 'rejected'
        ? d.status
        : isLocked(d.date)
          ? 'locked'
          : d.status === 'locked'
            ? 'submitted'
            : d.status,
    reviewStatus:
      d.status === 'approved' || d.status === 'rejected'
        ? d.status
        : d.status === 'draft'
          ? null
          : 'pending',
  });
  /** Manager review (dcr:review): the mock reviewer is fx.me reviewing other users' DCRs. */
  const reviewHandlers = () => [
    http.post(`${baseUrl}/v1/dcrs/:id/decision`, async ({ params, request }) => {
      const b = DcrDecision.safeParse(await request.json());
      if (!b.success) return validation('Invalid body', z.treeifyError(b.error));
      const d = dcrs.find((x) => x.id === params.id);
      if (!d) return notFound();
      if (d.userId === fx.me.id)
        return dcrError(403, 'FORBIDDEN', 'You cannot review your own DCR');
      if (d.status !== 'submitted')
        return dcrError(409, 'NOT_PENDING_REVIEW', 'Only submitted DCRs can be reviewed', {
          id: d.id,
          status: d.status,
        });
      const at = serverTime();
      if (b.data.decision === 'reject') {
        Object.assign(d, {
          status: 'rejected',
          rejectedAt: at,
          rejectedBy: fx.me.id,
          rejectionReason: b.data.comment,
          updatedAt: at,
        });
        unlocked.set(d.date, Date.parse(at) + 48 * 36e5);
      } else
        Object.assign(d, {
          status: 'approved',
          approvedAt: at,
          approvedBy: fx.me.id,
          updatedAt: at,
        });
      return HttpResponse.json(Dcr.parse(withLock(d)));
    }),
  ];

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
          primaryRole: u.roles[0] ?? null,
          managerName: fx.mockUsers.find((m) => m.id === u.managerId)?.name ?? null,
          version: 1,
          lastActiveAt: null,
          hasLogin: true,
          inviteStatus: 'accepted' as const,
          inviteExpiresAt: null,
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
    http.get(`${baseUrl}/v1/tour-plans/items`, ({ request }) => {
      const q = TourPlanItemListQuery.safeParse(
        Object.fromEntries(new URL(request.url).searchParams),
      );
      if (!q.success) return validation('Invalid query', z.treeifyError(q.error));
      const mine = q.data.mine === 'true';
      const rows = tpItems
        .filter((it) => (mine ? it.userId === fx.me.id : it.userId !== fx.me.id))
        .filter((it) => !q.data.status || it.status === q.data.status)
        .sort((a, b) =>
          mine ? b.updatedAt.localeCompare(a.updatedAt) : a.from.localeCompare(b.from),
        );
      const off = decodeCursor(q.data.cursor ?? null);
      const page = rows.slice(off, off + q.data.limit);
      return HttpResponse.json(
        TourPlanItemList.parse({
          items: page.map(itemOut),
          nextCursor: off + q.data.limit < rows.length ? encodeCursor(off + q.data.limit) : null,
          serverTime: serverTime(),
        }),
      );
    }),
    http.put(`${baseUrl}/v1/tour-plans/items`, async ({ request }) => {
      const b = TourPlanItemUpsert.safeParse(await request.json());
      if (!b.success) return validation('Invalid body', z.treeifyError(b.error));
      const wt = fx.workTypes.find((w) => w.id === b.data.plan.workTypeId && w.active);
      if (!wt)
        return dcrError(422, 'VALIDATION', 'Unknown or inactive work type', {
          field: 'plan.workTypeId',
        });
      if (wt.kind === 'leave' || wt.kind === 'holiday')
        return dcrError(422, 'VALIDATION', 'Plan leave through a leave request, not a tour plan', {
          field: 'plan.workTypeId',
        });
      const want = dcrDetailsKind(wt);
      if (b.data.plan.details && b.data.plan.details.kind !== want)
        return dcrError(
          422,
          'VALIDATION',
          want ? `details.kind must be '${want}'` : 'No details for this work type',
          {
            field: 'plan.details',
            expected: want,
          },
        );
      const ts = serverTime();
      if (!b.data.id) {
        const it: TourPlanItem = {
          id: crypto.randomUUID(),
          companyId: fx.COMPANY_ID,
          userId: fx.me.id,
          userName: fx.me.name,
          from: b.data.from,
          to: b.data.to,
          status: 'draft',
          rejectionReason: null,
          plan: b.data.plan,
          filedDates: [],
          version: 1,
          createdAt: ts,
          updatedAt: ts,
          submittedAt: null,
          decidedAt: null,
          decidedBy: null,
        };
        tpItems.push(it);
        return HttpResponse.json(itemOut(it));
      }
      const it = tpItems.find((x) => x.id === b.data.id);
      if (!it) return notFound();
      if (it.userId !== fx.me.id)
        return dcrError(403, 'FORBIDDEN', 'Only the owner can change a tour plan');
      if (it.status !== 'draft' && it.status !== 'rejected')
        return dcrError(409, 'TP_LOCKED', 'Only a draft or rejected tour plan can be changed', {
          status: it.status,
        });
      if (b.data.version !== undefined && b.data.version !== it.version)
        return dcrError(409, 'VERSION_CONFLICT', 'Tour plan changed since you read it', {
          version: it.version,
        });
      Object.assign(it, {
        from: b.data.from,
        to: b.data.to,
        plan: b.data.plan,
        status: 'draft',
        rejectionReason: null,
        submittedAt: null,
        decidedAt: null,
        decidedBy: null,
        version: it.version + 1,
        updatedAt: ts,
      });
      return HttpResponse.json(itemOut(it));
    }),
    http.get(`${baseUrl}/v1/tour-plans/items/:id`, ({ params }) => {
      const it = tpItems.find((x) => x.id === params.id);
      return it ? HttpResponse.json(itemOut(it)) : notFound();
    }),
    http.post(`${baseUrl}/v1/tour-plans/items/:id/submit`, ({ params }) => {
      const it = tpItems.find((x) => x.id === params.id);
      if (!it) return notFound();
      if (it.userId !== fx.me.id) return dcrError(403, 'FORBIDDEN', 'Only the owner can submit');
      if (it.status !== 'draft' && it.status !== 'rejected')
        return dcrError(409, 'TP_LOCKED', 'Only a draft or rejected tour plan can be changed', {
          status: it.status,
        });
      if (it.from < today())
        return dcrError(422, 'TP_IN_PAST', 'A tour plan must start today or later', {
          field: 'from',
        });
      const hits = tpItems.filter(
        (x) =>
          x.id !== it.id &&
          x.userId === it.userId &&
          (x.status === 'pending' || x.status === 'approved') &&
          x.from <= it.to &&
          x.to >= it.from,
      );
      if (hits.length)
        return dcrError(409, 'TP_OVERLAP', 'Overlaps a pending or approved tour plan', {
          items: hits.map((x) => ({ id: x.id, from: x.from, to: x.to })),
        });
      const ts = serverTime();
      Object.assign(it, {
        status: 'pending',
        submittedAt: ts,
        updatedAt: ts,
        version: it.version + 1,
      });
      return HttpResponse.json(itemOut(it));
    }),
    http.post(`${baseUrl}/v1/tour-plans/items/:id/decision`, async ({ params, request }) => {
      const b = TourPlanItemDecision.safeParse(await request.json());
      if (!b.success) return validation('Invalid body', z.treeifyError(b.error));
      const it = tpItems.find((x) => x.id === params.id);
      if (!it) return notFound();
      if (it.userId === fx.me.id)
        return dcrError(403, 'FORBIDDEN', 'You cannot decide your own tour plan');
      if (it.status !== 'pending') return conflict('This tour plan is not waiting for approval');
      const comment = b.data.comment?.trim() || null;
      if (b.data.decision === 'reject' && !comment)
        return dcrError(422, 'REJECTION_REASON_REQUIRED', 'A reason is required to reject');
      const ts = serverTime();
      Object.assign(it, {
        status: b.data.decision === 'approve' ? 'approved' : 'rejected',
        rejectionReason: b.data.decision === 'reject' ? comment : null,
        decidedAt: ts,
        decidedBy: fx.me.id,
        updatedAt: ts,
        version: it.version + 1,
      });
      return HttpResponse.json(itemOut(it));
    }),
    http.delete(`${baseUrl}/v1/tour-plans/items/:id`, ({ params }) => {
      const it = tpItems.find((x) => x.id === params.id);
      if (!it) return notFound();
      if (it.userId !== fx.me.id) return dcrError(403, 'FORBIDDEN', 'Only the owner can delete');
      if (it.status !== 'draft' && it.status !== 'rejected')
        return dcrError(409, 'TP_LOCKED', 'Only a draft or rejected tour plan can be changed', {
          status: it.status,
        });
      tpItems.splice(tpItems.indexOf(it), 1);
      return new HttpResponse(null, { status: 204 });
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
          days: (tourPlans.find((t) => t.month === month && t.userId === fx.me.id)?.days ?? []).map(
            (d) => ({
              date: d.date,
              status: d.status ?? 'draft',
              submissionId: d.submissionId ?? null,
            }),
          ),
        }),
      );
    }),
    http.get(`${baseUrl}/v1/tour-plans/:month`, ({ params }) => {
      // `{month}` may also be a plan id (GET /v1/tour-plans/{id}).
      const p = tourPlans.find(
        (t) => t.id === params.month || (t.month === params.month && t.userId === fx.me.id),
      );
      return p ? HttpResponse.json(p) : notFound();
    }),
    http.put(`${baseUrl}/v1/tour-plans/:month`, async ({ params, request }) => {
      const b = TourPlanUpsert.safeParse(await request.json());
      if (!b.success) return validation('Invalid plan', z.treeifyError(b.error));
      const month = String(params.month);
      let p = tourPlans.find((t) => t.month === month && t.userId === fx.me.id);
      if (!p) tourPlans.push((p = emptyPlan(month)));
      else if (b.data.version && b.data.version !== p.version) return conflict('Stale version');
      const lock = dayLock(p);
      const next = new Map(b.data.days.map((d) => [d.date, d]));
      const bad = [...lock].filter(
        ([dt, e]) => JSON.stringify(next.get(dt)?.entries ?? null) !== e,
      );
      if (bad.length) return lockedConflict(bad.map(([dt]) => dt));
      const prev = new Map(p.days.map((d) => [d.date, d]));
      p.version += 1;
      Object.assign(p, {
        days: b.data.days.map((d) => {
          const o = prev.get(d.date);
          return { ...d, status: o?.status ?? 'draft', submissionId: o?.submissionId ?? null };
        }),
        updatedAt: serverTime(),
      });
      reaggregate(p);
      return HttpResponse.json(TourPlan.parse(p));
    }),
    http.post(`${baseUrl}/v1/tour-plans/:month/copy`, async ({ params, request }) => {
      const b = TourPlanCopy.safeParse(await request.json().catch(() => ({})));
      if (!b.success) return validation('Invalid copy', z.treeifyError(b.error));
      const month = String(params.month);
      let p = tourPlans.find((t) => t.month === month && t.userId === fx.me.id);
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
      const kept = p.days.filter((d) => d.status && LOCKED.includes(d.status));
      const keep = new Set(kept.map((d) => d.date));
      Object.assign(p, {
        days: [
          ...kept,
          ...days
            .filter((d) => !keep.has(d.date))
            .map((d) => ({ ...d, status: 'draft' as const, submissionId: null })),
        ].sort((a, b) => a.date.localeCompare(b.date)),
        updatedAt: serverTime(),
      });
      reaggregate(p);
      return HttpResponse.json(TourPlan.parse(p));
    }),
    http.post(`${baseUrl}/v1/tour-plans/:month/submit`, async ({ params, request }) => {
      const sb = TourPlanSubmit.safeParse(await request.json().catch(() => ({})));
      if (!sb.success) return validation('Invalid submit', z.treeifyError(sb.error));
      const p = tourPlans.find((t) => t.month === params.month && t.userId === fx.me.id);
      if (!p) return notFound();
      const want = sb.data.dates;
      if (want?.some((d) => !d.startsWith(p.month.slice(0, 7))))
        return validation('Date outside the month');
      const locked = (want ?? []).filter((d) => dayLock(p).has(d));
      if (locked.length) return lockedConflict(locked);
      const pick = p.days.filter(
        (d) =>
          d.entries.length > 0 &&
          !LOCKED.includes(d.status ?? 'draft') &&
          (!want || want.includes(d.date)),
      );
      if (!hasPlannedDay(pick))
        return HttpResponse.json(
          {
            error: {
              code: 'EMPTY_PLAN',
              message: 'Add at least one day to the plan before submitting',
            },
          },
          { status: 422 },
        );
      const subId = crypto.randomUUID();
      const apId = crypto.randomUUID();
      for (const d of pick) Object.assign(d, { status: 'submitted', submissionId: subId });
      p.submissions = [
        ...(p.submissions ?? []),
        {
          id: subId,
          tourPlanId: p.id,
          dates: pick.map((d) => d.date),
          status: 'submitted',
          approvalId: apId,
          submitterNote: sb.data.submitterNote?.trim() || null,
          submittedAt: serverTime(),
          decidedAt: null,
          decidedBy: null,
          decisionComment: null,
          rejectionReason: null,
          rejectedBy: null,
          rejectedAt: null,
        },
      ];
      Object.assign(p, {
        status: 'submitted',
        submittedAt: serverTime(),
        submitterNote: sb.data.submitterNote?.trim() || null,
        rejectionReason: null,
        rejectedBy: null,
        rejectedAt: null,
        version: p.version + 1,
      });
      approvals.push({
        id: apId,
        companyId: fx.COMPANY_ID,
        subjectType: 'tour_plan',
        subjectId: subId,
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
    http.get(`${baseUrl}/v1/dcrs`, ({ request }) => {
      const url = new URL(request.url);
      const mine = url.searchParams.get('mine') === 'true';
      const doctorId = url.searchParams.get('doctorId');
      const rows = dcrs
        .filter((x) => !mine || x.userId === fx.me.id)
        .filter(
          (x) =>
            !doctorId || x.calls.some((c) => c.outletKind === 'doctor' && c.outletId === doctorId),
        )
        .map((x) => ({ ...withLock(x), callCount: x.calls.length }));
      return list(Dcr, rows, url);
    }),
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
    ...reviewHandlers(),
    ...dcrFlowHandlers(),
    http.get(`${baseUrl}/v1/dcrs/:id`, ({ params }) => {
      const d = dcrs.find((x) => x.id === params.id);
      return d ? HttpResponse.json(withLock(d)) : notFound();
    }),
    http.put(`${baseUrl}/v1/dcrs`, async ({ request }) => {
      const b = DcrUpsert.safeParse(await request.json());
      const prior = b.success ? (submittedOf(b.data.date) ?? draftsOf(b.data.date)[0]) : undefined;
      if (prior?.submittedBy)
        return dcrError(409, 'ALREADY_SUBMITTED', 'Submitted DCRs are read-only');
      if (!b.success) return validation('Invalid DCR', z.treeifyError(b.error));
      if (b.data.date > today()) return validation('DCR date is in the future');
      let d = submittedOf(b.data.date) ?? draftsOf(b.data.date)[0];
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
      const doctorPob = b.data.calls.flatMap((c, i) =>
        c.outletKind === 'doctor' && c.pob.length ? [{ i, id: c.clientId }] : [],
      );
      if (doctorPob.length)
        return validation('POB is not allowed on doctor calls', {
          reason: 'POB_NOT_ALLOWED_FOR_DOCTOR',
          callIndexes: doctorPob.map((x) => x.i),
          callIds: doctorPob.map((x) => x.id),
        });
      const pts = (id: string) => fx.products.find((p) => p.id === id)?.pts ?? null;
      const calls = b.data.calls.map(({ clientId, ...c }) => ({
        ...c,
        id: clientId,
        pob: c.pob.map((l) => {
          const r = pts(l.productId);
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
          band: null,
          details: null,
          workWithUserIds: [],
          sfcRoutes: [],
          submittedBy: null,
          reviewStatus: null,
          approvedAt: null,
          approvedBy: null,
          rejectedAt: null,
          rejectedBy: null,
          rejectionReason: null,
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
        // Routed to the company's directors (shared queue), not the manager.
        approverId: null,
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
      // DCR unlock requests need dcr_unlock:decide (director only); others approvals:decide.
      const can = (a: (typeof approvals)[number]) =>
        a.status === 'pending' &&
        a.requestedBy !== fx.me.id &&
        fx.me.permissions.includes('approvals:decide') &&
        (a.subjectType !== 'dcr_unlock' || fx.me.permissions.includes('dcr_unlock:decide'));
      const rows = (
        mine === 'to_decide'
          ? approvals.filter(can)
          : mine === 'requested'
            ? approvals.filter((a) => a.requestedBy === fx.me.id)
            : approvals
      ).map((a) => ({ ...a, canDecide: can(a) }));
      return list(Approval, rows, url);
    }),
    http.post(`${baseUrl}/v1/approvals/:id/decision`, async ({ params, request }) => {
      const a = approvals.find((x) => x.id === params.id);
      if (!a) return notFound();
      const b = ApprovalDecision.safeParse(await request.json());
      if (!b.success) return validation('Invalid decision', z.treeifyError(b.error));
      if (b.data.decision === 'reject' && !b.data.comment)
        return HttpResponse.json(
          {
            error: { code: 'REJECTION_REASON_REQUIRED', message: 'A reason is required to reject' },
          },
          { status: 422 },
        );
      if (a.requestedBy === fx.me.id)
        return HttpResponse.json(
          { error: { code: 'FORBIDDEN', message: 'You cannot decide your own request' } },
          { status: 403 },
        );
      if (a.subjectType === 'dcr_unlock' && !fx.me.permissions.includes('dcr_unlock:decide'))
        return dcrError(
          403,
          'APPROVAL_PERMISSION_REQUIRED',
          'Missing permission: dcr_unlock:decide',
          {
            permission: 'dcr_unlock:decide',
          },
        );
      if (a.status !== 'pending') return conflict('Already decided');
      Object.assign(a, {
        status: b.data.decision === 'approve' ? 'approved' : 'rejected',
        comment: b.data.comment || null,
        rejectionReason: b.data.decision === 'reject' ? b.data.comment! : null,
        decidedAt: serverTime(),
        decidedBy: fx.me.id,
      });
      const day = corrections.get(a.id);
      if (day && b.data.decision === 'approve')
        unlocked.set(day, Date.now() + DCR_UNLOCK_HOURS * 36e5);
      // #86: tour-plan approvals point at a submission (legacy: the plan id).
      const sub = tourPlans
        .flatMap((t) => (t.submissions ?? []).map((x) => ({ t, x })))
        .find((r) => r.x.id === a.subjectId);
      const tp = sub?.t ?? tourPlans.find((t) => t.id === a.subjectId);
      const rej = b.data.decision === 'reject';
      if (sub) {
        Object.assign(sub.x, {
          status: a.status,
          decidedAt: a.decidedAt,
          decidedBy: { id: fx.me.id, name: fx.me.name },
          decisionComment: a.comment,
          rejectionReason: rej ? a.comment : null,
          rejectedBy: rej ? { id: fx.me.id, name: fx.me.name } : null,
          rejectedAt: rej ? a.decidedAt : null,
        });
        for (const d of sub.t.days)
          if (d.submissionId === sub.x.id) d.status = a.status as 'approved' | 'rejected';
      }
      if (tp)
        Object.assign(tp, {
          status: a.status,
          decidedAt: a.decidedAt,
          decidedBy: a.decidedBy,
          decisionComment: a.comment,
          rejectionReason: b.data.decision === 'reject' ? a.comment : null,
          rejectedBy:
            b.data.decision === 'reject' && a.decidedBy
              ? { id: a.decidedBy, name: fx.me.name }
              : null,
          rejectedAt: b.data.decision === 'reject' ? a.decidedAt : null,
        });
      if (sub) reaggregate(sub.t);
      return HttpResponse.json(Approval.parse(a));
    }),
    http.get(`${baseUrl}/v1/approvals/:id`, ({ params }) => {
      const a = approvals.find((x) => x.id === params.id);
      if (!a) return notFound();
      const sub = tourPlans
        .flatMap((t) => (t.submissions ?? []).map((x) => ({ t, x })))
        .find((r) => r.x.id === a.subjectId);
      const tp = sub?.t ?? tourPlans.find((t) => t.id === a.subjectId);
      const ref = (rows: { id: string; name: string }[], id: string) => ({
        id,
        name: rows.find((r) => r.id === id)?.name ?? '',
      });
      const subject: ApprovalSubject | null = tp
        ? {
            type: 'tour_plan',
            plan: tp,
            submission: sub?.x ?? null,
            days: tp.days
              .filter((d) => !sub || sub.x.dates.includes(d.date))
              .map((d) => ({
                date: d.date,
                entries: d.entries.map((e) => ({
                  session: e.session,
                  workType: { id: e.workTypeId, name: '' },
                  territories: e.territoryIds.map((i) => ref(fx.territories, i)),
                  jointWorkUsers: (e.jointWorkUserIds ?? []).map((i) => ref(fx.mockUsers, i)),
                  doctors: (e.plannedDoctorIds ?? []).map((i) => ({
                    ...ref(fx.doctors, i),
                    specialtyName: null,
                    categoryName: null,
                  })),
                  chemists: (e.plannedChemistIds ?? []).map((i) => ref(fx.chemists, i)),
                  notes: e.notes ?? null,
                })),
              })),
          }
        : corrections.has(a.id)
          ? { type: 'dcr_unlock', date: corrections.get(a.id) ?? null, reason: null }
          : null;
      return HttpResponse.json(ApprovalDetail.parse({ ...a, subject }));
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
export { MOCK_PASSWORD_RESET_CODE } from './password-reset';
