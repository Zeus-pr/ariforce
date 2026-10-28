/**
 * Mock mode only: the DCR redesign endpoints (docs/DCR-REDESIGN-DESIGN.md) with Durgapur/Bankura
 * fixtures (./fixtures). Registered before the contracts mock, so it answers /v1/dcrs/options,
 * /territories, /work-with, /sfc-match, /draft and /{id}/submit, plus GET /v1/dcrs/{id} for DCRs it
 * holds and the doctor/chemist/stockist lists for its own territories. Everything else falls through.
 * State lives in the page (lost on reload). Rules follow the API: band comes from the work type,
 * SFC candidates are the rep's SFC routes for each HQ of the day in the band's category, one route per
 * HQ, snapshots frozen at submit, idempotent submit. Set localStorage `af:mock-sfc-down` = '1' to make
 * the SFC lookup fail with 503 SFC_UNAVAILABLE (retry state).
 */
import { http, HttpResponse } from 'msw';
import {
  Dcr,
  DcrDraftPut,
  DcrOptions,
  DcrSfcMatch,
  DcrSubmit,
  dcrDetailsKind,
  type DcrBand,
} from '@ariforce/contracts';
import { fixtures as fx } from '@ariforce/contracts/mocks';
import { DEFAULT_RATE } from '@/lib/sfc/adapter';
import { seedRows } from '@/lib/sfc/fixtures';
import {
  DCR_OUTLETS,
  DCR_TERRITORIES,
  DCR_WORK_TYPES,
  DCR_WORK_WITH,
  SFC_SHEET_FOR_HQ,
  sfcRouteUuid,
} from './fixtures';

const err = (status: number, code: string, message: string, details?: unknown) =>
  HttpResponse.json({ error: { code, message, details } }, { status });
const validation = (message: string, details?: unknown) => err(422, 'VALIDATION', message, details);

const CATEGORY: Record<string, 'hq' | 'ex' | 'os'> = {
  HQ: 'hq',
  EX: 'ex',
  'EX HQ': 'ex',
  OS: 'os',
  'OUT EX HQ': 'os',
  OUTSTATION: 'os',
};
const BAND_CATEGORY: Record<DcrBand, 'hq' | 'ex' | 'os'> = { hq: 'hq', ex_hq: 'ex', outstation: 'os' };
const MODE: Record<string, string> = { BIKE: 'bike', BUS: 'bus', TRAIN: 'train', 'BUS / TRAIN': 'bus_train', CAR: 'car' };
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The rep's SFC candidates for one HQ and band, from the SFC screen's own fixture rows. */
function candidates(hqId: string, band: DcrBand) {
  const sheet = SFC_SHEET_FOR_HQ[hqId];
  if (!sheet) return [];
  return seedRows(sheet)
    .map((r, i) => ({ r, i, cat: CATEGORY[r.category.trim().toUpperCase()] }))
    .filter((x) => x.cat === BAND_CATEGORY[band])
    .map(({ r, i, cat }) => {
      const km = r.distanceKm ?? 0;
      const one = r.actualFare ? null : r2(km * DEFAULT_RATE);
      return {
        id: sfcRouteUuid(sheet, i),
        fromPlace: r.fromPlace,
        toPlace: r.toPlace,
        oneWayKm: km,
        bothWayKm: r2(km * 2),
        oneWayAmount: one,
        bothWayAmount: one == null ? null : r2(one * 2),
        actualFare: r.actualFare,
        travelMode: (MODE[r.travelMode] ?? null) as 'bike' | null,
        category: cat!,
        band,
        da: r.da,
        version: 1,
      };
    });
}

const hqOf = (id: string) => {
  const t = DCR_TERRITORIES.find((x) => x.id === id);
  if (!t) return null;
  return t.level === 'territory' ? t.parentId : t.id;
};
const lockAt = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00+05:30`) + 86_400_000 + fx.dcrLockAfterHours * 36e5).toISOString();
const isLocked = (date: string) => Date.now() > Date.parse(lockAt(date));
const todayIST = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

function persona(request: Request) {
  let who = request.headers.get('x-mock-user');
  try {
    const s = JSON.parse(localStorage.getItem('af:mock-session') ?? 'null') as { role?: string; previewRole?: string } | null;
    who ??= s?.previewRole ?? s?.role ?? null;
  } catch {
    /* default persona */
  }
  return { who, me: fx.findMockUser(who) ?? fx.me };
}
const sfcDown = () => {
  try {
    return localStorage.getItem('af:mock-sfc-down') === '1';
  } catch {
    return false;
  }
};

export function mockDcrFlow(base: string) {
  const dcrs: Dcr[] = [];
  const submitKeys = new Map<string, string>();
  const wtOf = (id: string) => DCR_WORK_TYPES.find((w) => w.id === id);
  const out = (d: Dcr) => HttpResponse.json(Dcr.parse({ ...d, lockAt: lockAt(d.date) }));

  /** Per-HQ match; null when the band has no SFC (non-field). */
  const match = (band: DcrBand, territoryIds: string[]) => {
    const hqIds = [...new Set(territoryIds.map(hqOf))];
    if (hqIds.some((h) => !h)) return { bad: true as const };
    return {
      bad: false as const,
      hqs: (hqIds as string[]).map((h) => {
        const c = candidates(h, band);
        return {
          hqTerritoryId: h,
          hqName: DCR_TERRITORIES.find((t) => t.id === h)!.name,
          candidates: c,
          autoSelectedId: c.length === 1 ? c[0]!.id : null,
        };
      }),
    };
  };

  async function leaveCovers(request: Request, leaveRequestId: string, date: string) {
    const { who } = persona(request);
    const r = await fetch(`${base}/v1/leave/requests?mine=true&limit=200`, {
      headers: who ? { 'x-mock-user': who } : {},
    }).catch(() => null);
    if (!r?.ok) return false;
    const body = (await r.json()) as { items: { id: string; status: string; fromDate: string; toDate: string }[] };
    return body.items.some(
      (l) => l.id === leaveRequestId && ['pending', 'approved'].includes(l.status) && l.fromDate <= date && l.toDate >= date,
    );
  }

  const outlets = (kind: 'doctor' | 'chemist' | 'stockist') =>
    http.get(`${base}/v1/${kind}s`, ({ request }) => {
      const sp = new URL(request.url).searchParams;
      const tid = sp.get('territoryId');
      const t = tid ? DCR_TERRITORIES.find((x) => x.id === tid) : undefined;
      // Batch lookup by ids (saved calls' names): answer for our outlets only.
      const ids = sp.get('ids')?.toLowerCase().split(',');
      if (ids && !tid) {
        const mine = DCR_OUTLETS.filter((o) => o.kind === kind && ids.includes(o.id.toLowerCase()));
        if (!mine.length) return undefined;
        return HttpResponse.json({ items: mine.map(asRow), nextCursor: null });
      }
      if (!t) return undefined; // not ours: the contracts mock answers
      // localTerritoryId (doctors, chemists): exact territory id, or 'none' for rows not linked yet.
      const local = kind === 'stockist' ? null : sp.get('localTerritoryId');
      const linkOf = (o: (typeof DCR_OUTLETS)[number]) => (o.territoryId === o.hqId ? null : o.territoryId);
      const q = (sp.get('q') ?? '').trim().toLowerCase();
      const limit = Math.min(Number(sp.get('limit') ?? 25) || 25, 200);
      const from = Number(sp.get('cursor') ?? 0) || 0;
      const rows = DCR_OUTLETS.filter(
        (o) =>
          o.kind === kind &&
          // territoryId means "this territory or any descendant": the HQ, or one territory under it.
          (t.level === 'headquarter' ? o.hqId === t.id : o.territoryId === t.id) &&
          (!local || (local === 'none' ? linkOf(o) === null : linkOf(o) === local)) &&
          (!q || o.name.toLowerCase().includes(q)),
      ).sort((a, b) => a.name.localeCompare(b.name));
      const page = rows.slice(from, from + limit);
      return HttpResponse.json({
        items: page.map(asRow),
        nextCursor: from + limit < rows.length ? String(from + limit) : null,
      });
    });
  const outletById = (kind: 'doctor' | 'chemist' | 'stockist') =>
    http.get(`${base}/v1/${kind}s/:id`, ({ params }) => {
      const o = DCR_OUTLETS.find((x) => x.kind === kind && x.id === params.id);
      return o ? HttpResponse.json(asRow(o)) : undefined;
    });
  function asRow(o: (typeof DCR_OUTLETS)[number]) {
    const kind = o.kind;
    const linkOf = (x: typeof o) => (x.territoryId === x.hqId ? null : x.territoryId);
    const now = '2026-10-01T05:30:00.000Z';
    const tmpl = (kind === 'doctor' ? fx.doctors : kind === 'chemist' ? fx.chemists : fx.stockists)[0]!;
    return {
      ...tmpl,
      id: o.id,
      name: o.name,
      // Customers are filed under their HQ; the importer links some to a territory under it.
      territoryId: o.hqId,
      ...(kind === 'stockist' ? {} : { localTerritoryId: linkOf(o) }),
      city: null,
      createdAt: now,
      updatedAt: now,
      ...(kind === 'doctor' ? { approvalStatus: 'approved' } : {}),
    };
  }

  return [
    http.get(`${base}/v1/dcrs/options`, ({ request }) => {
      const date = new URL(request.url).searchParams.get('date') ?? '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return validation('date is required (YYYY-MM-DD)');
      const { me } = persona(request);
      const d = dcrs.find((x) => x.date === date && x.userId === me.id) ?? null;
      return HttpResponse.json(
        DcrOptions.parse({
          date,
          workTypes: DCR_WORK_TYPES.map((w) => ({
            ...w,
            usesSfc: w.band !== null,
            detailsKind: dcrDetailsKind(w),
          })),
          dcr: d ? { ...d, lockAt: lockAt(d.date) } : null,
        }),
      );
    }),
    http.get(`${base}/v1/dcrs/territories`, () =>
      HttpResponse.json({
        items: DCR_TERRITORIES.filter((t) => t.level === 'headquarter').map((h) => ({
          id: h.id,
          code: h.code,
          name: h.name,
          territories: DCR_TERRITORIES.filter((t) => t.level === 'territory' && t.parentId === h.id).map((t) => ({
            id: t.id,
            code: t.code,
            name: t.name,
          })),
        })),
      }),
    ),
    http.get(`${base}/v1/dcrs/work-with`, ({ request }) => {
      const q = (new URL(request.url).searchParams.get('q') ?? '').trim().toLowerCase();
      return HttpResponse.json({
        items: DCR_WORK_WITH.filter(
          (u) => !q || u.name.toLowerCase().includes(q) || u.employeeCode.toLowerCase().startsWith(q),
        ),
      });
    }),
    http.get(`${base}/v1/dcrs/sfc-match`, ({ request }) => {
      const sp = new URL(request.url).searchParams;
      const wt = wtOf(sp.get('workTypeId') ?? '');
      const ids = (sp.get('territoryIds') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!sp.get('date') || !ids.length) return validation('date, workTypeId and territoryIds are required');
      if (!wt?.band) return validation('SFC applies to field work types only', { workTypeId: wt?.id });
      if (sfcDown()) return err(503, 'SFC_UNAVAILABLE', 'SFC lookup failed; retry');
      const m = match(wt.band, ids);
      if (m.bad) return validation('Unknown or out-of-scope territories', { territoryIds: ids });
      const body = DcrSfcMatch.parse({ band: wt.band, hqs: m.hqs });
      const missingHqIds = body.hqs.filter((h) => !h.candidates.length).map((h) => h.hqTerritoryId);
      if (missingHqIds.length)
        return err(404, 'SFC_NO_MATCH', 'No SFC route for some HQ of the day', { ...body, missingHqIds });
      return HttpResponse.json(body);
    }),
    http.put(`${base}/v1/dcrs/draft`, async ({ request }) => {
      const b = DcrDraftPut.safeParse(await request.json());
      if (!b.success) return validation('Invalid DCR', b.error.issues);
      const { me } = persona(request);
      if (b.data.date > todayIST()) return validation('DCR date is in the future');
      if (isLocked(b.data.date)) return err(409, 'DAY_LOCKED', 'Day locked; request a correction');
      let d = dcrs.find((x) => x.date === b.data.date && x.userId === me.id);
      if (d?.status === 'submitted') return err(409, 'ALREADY_SUBMITTED', 'Read-only after submit');
      if (d && b.data.version && b.data.version !== d.version) return err(409, 'VERSION_CONFLICT', 'Stale version');
      const wt = wtOf(b.data.workTypeId);
      if (!wt) return validation('Unknown work type');
      if (b.data.band && b.data.band !== wt.band) return validation('band must equal the work type band', { field: 'band' });
      if (wt.kind !== 'field' && b.data.calls.length) return validation('Calls need a field work type');
      if (!wt.band && b.data.sfcRoutes?.length) return validation('SFC applies to field work types only (Meeting never)');
      const want = dcrDetailsKind(wt);
      if (b.data.details && b.data.details.kind !== want) return validation(`details.kind must be '${want}'`, { field: 'details' });
      const hqIds = b.data.territoryIds.map(hqOf);
      if (hqIds.some((h) => !h)) return validation('Unknown or out-of-scope territories');
      for (const c of b.data.sfcRoutes ?? []) {
        if (!hqIds.includes(c.hqTerritoryId))
          return err(422, 'SFC_MISMATCH', 'Route HQ is not an HQ of the chosen territories', { hqTerritoryIds: [c.hqTerritoryId] });
        if (!candidates(c.hqTerritoryId, wt.band!).some((r) => r.id === c.sfcRouteId))
          return err(422, 'SFC_MISMATCH', 'Route is not yours, not on that HQ, deleted, or not in the band', { sfcRouteIds: [c.sfcRouteId] });
      }
      const now = new Date().toISOString();
      if (!d) {
        d = Dcr.parse({
          id: crypto.randomUUID(),
          companyId: fx.COMPANY_ID,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          version: 1,
          userId: me.id,
          date: b.data.date,
          workTypeId: wt.id,
          territoryIds: [],
          tourPlanId: null,
          deviationReason: null,
          status: 'draft',
          calls: [],
          submittedAt: null,
          lockAt: lockAt(b.data.date),
          unlockedUntil: null,
        });
        dcrs.push(d);
      } else d.version += 1;
      Object.assign(d, {
        workTypeId: wt.id,
        band: wt.band,
        territoryIds: wt.band ? b.data.territoryIds : [],
        workWithUserIds: b.data.workWithUserIds,
        details: b.data.details ?? null,
        deviationReason: b.data.deviationReason ?? null,
        calls: b.data.calls.map(({ clientId, ...c }) => ({ ...c, id: clientId, pob: c.pob.map((l) => ({ ...l, value: null })) })),
        ...(b.data.sfcRoutes || !wt.band
          ? { sfcRoutes: wt.band ? (b.data.sfcRoutes ?? []).map((r) => ({ ...r, snapshot: null })) : [] }
          : {}),
        updatedAt: now,
      });
      return out(d);
    }),
    http.post(`${base}/v1/dcrs/:id/submit`, async ({ params, request }) => {
      const { me } = persona(request);
      const d = dcrs.find((x) => x.id === params.id && x.userId === me.id);
      if (!d) return err(404, 'NOT_FOUND', 'DCR not found');
      const key = request.headers.get('idempotency-key');
      if (!key) return validation('Idempotency-Key header is required');
      const b = DcrSubmit.safeParse(await request.json());
      if (!b.success) return validation('Invalid body');
      if (d.status === 'submitted')
        return submitKeys.get(d.id) === key ? out(d) : err(409, 'ALREADY_SUBMITTED', 'Already submitted');
      if (b.data.version !== d.version) return err(409, 'VERSION_CONFLICT', 'Stale version');
      if (isLocked(d.date)) return err(409, 'DAY_LOCKED', 'Day locked');
      const wt = wtOf(d.workTypeId)!;
      const want = dcrDetailsKind(wt);
      if (want && (!d.details || d.details.kind !== want))
        return validation(`details (kind '${want}') are required`, { field: 'details' });
      if (d.details?.kind === 'leave' && !(await leaveCovers(request, d.details.leaveRequestId, d.date)))
        return err(422, 'LEAVE_NOT_FOUND', 'No pending or approved leave request of yours covers this date');
      let routes: Dcr['sfcRoutes'] = [];
      if (wt.band) {
        if (!d.territoryIds.length) return validation('Pick at least one territory', { field: 'territoryIds' });
        if (!d.calls.length) return validation('Field work needs at least one call', { field: 'calls' });
        if (sfcDown()) return err(503, 'SFC_UNAVAILABLE', 'SFC lookup failed; retry');
        const m = match(wt.band, d.territoryIds);
        if (m.bad) return validation('Unknown territories');
        const frozenAt = new Date().toISOString();
        routes = [];
        for (const h of m.hqs) {
          const chosen = d.sfcRoutes.find((r) => r.hqTerritoryId === h.hqTerritoryId)?.sfcRouteId ?? h.autoSelectedId;
          if (!h.candidates.length)
            return err(422, 'SFC_NO_MATCH', `No SFC route for ${h.hqName}`, { missingHqIds: [h.hqTerritoryId] });
          const c = h.candidates.find((x) => x.id === chosen);
          if (!c) return err(422, 'SFC_ROUTE_REQUIRED', `Pick the SFC route for ${h.hqName}`, { hqTerritoryIds: [h.hqTerritoryId] });
          const { id, version, ...rest } = c;
          routes.push({
            hqTerritoryId: h.hqTerritoryId,
            sfcRouteId: id,
            snapshot: { ...rest, sfcRouteId: id, routeVersion: version, hqTerritoryId: h.hqTerritoryId, ratePerKm: DEFAULT_RATE, frozenAt },
          });
        }
      }
      const now = new Date().toISOString();
      submitKeys.set(d.id, key);
      Object.assign(d, { status: 'submitted', submittedAt: now, submittedBy: me.id, sfcRoutes: routes, version: d.version + 1, updatedAt: now });
      return out(d);
    }),
    http.get(`${base}/v1/dcrs/:id`, ({ params }) => {
      const d = dcrs.find((x) => x.id === params.id);
      return d ? out(d) : undefined;
    }),
    outlets('doctor'),
    outlets('chemist'),
    outlets('stockist'),
    outletById('doctor'),
    outletById('chemist'),
    outletById('stockist'),
  ];
}
