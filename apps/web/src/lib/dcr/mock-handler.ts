/**
 * Mock mode only: the DCR redesign endpoints (docs/DCR-REDESIGN-DESIGN.md) with Durgapur/Bankura
 * fixtures (./fixtures). Registered before the contracts mock, so it answers /v1/dcrs/options,
 * /territories, /work-with, /sfc-match, /draft, /{id}/submit and DELETE /{id}, GET /v1/dcrs?mine=true
 * (or status=draft), GET /v1/dcrs/{id} for DCRs it holds and the doctor/chemist/stockist lists for its
 * own territories. Everything else falls through. Several drafts per day, at most one submitted report
 * per day (0045): PUT /draft with id updates that draft, without id and version creates a new one.
 * LEAVE_DCR_CONFLICT (659eaeb): set localStorage `af:mock-leave-dcr-conflict` to '1' (yesterday) or
 * comma-separated YYYY-MM-DD dates to make approving any leave (leave requests or approvals) return 409.
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
  DCR_LEGACY_SFC,
  LEGACY_ROW_OFFSET,
  SFC_SHEET_FOR_HQ,
  sfcRouteUuid,
} from './fixtures';
import { sfcCategoryOf } from './bands';

const err = (status: number, code: string, message: string, details?: unknown) =>
  HttpResponse.json({ error: { code, message, details } }, { status });
const validation = (message: string, details?: unknown) => err(422, 'VALIDATION', message, details);

const BAND_CATEGORY: Record<DcrBand, 'hq' | 'ex' | 'os'> = { hq: 'hq', ex_hq: 'ex', outstation: 'os' };
const MODE: Record<string, string> = { BIKE: 'bike', BUS: 'bus', TRAIN: 'train', 'BUS / TRAIN': 'bus_train', CAR: 'car' };
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * The rep's SFC candidates for one HQ and band, from the SFC screen's own fixture rows plus the DCR
 * legacy rows. Exact categories match in any case. Like an un-migrated server, combined categories
 * ("Ex / Os") leak through for either of their bands with the raw value, so the UI must drop them.
 */
function candidates(hqId: string, band: DcrBand) {
  const sheet = SFC_SHEET_FOR_HQ[hqId];
  if (!sheet) return [];
  const want = BAND_CATEGORY[band];
  const rows = [
    ...seedRows(sheet).map((r, i) => ({ i, from: r.fromPlace, to: r.toPlace, km: r.distanceKm ?? 0, mode: r.travelMode, raw: r.category, af: r.actualFare, da: r.da })),
    ...(DCR_LEGACY_SFC[sheet] ?? []).map(([from, to, km, mode, raw, af], i) => ({ i: LEGACY_ROW_OFFSET + i, from, to, km, mode, raw, af: !!af, da: null })),
  ];
  return rows
    .filter((x) => {
      const exact = sfcCategoryOf(x.raw);
      if (exact) return exact === want;
      const parts = x.raw.split('/').map((p) => sfcCategoryOf(p));
      return parts.length > 1 && parts.includes(want);
    })
    .map((x) => {
      const one = x.af ? null : r2(x.km * DEFAULT_RATE);
      return {
        id: sfcRouteUuid(sheet, x.i),
        fromPlace: x.from,
        toPlace: x.to,
        oneWayKm: x.km,
        bothWayKm: r2(x.km * 2),
        oneWayAmount: one,
        bothWayAmount: one == null ? null : r2(one * 2),
        actualFare: x.af,
        travelMode: (MODE[x.mode] ?? null) as 'bike' | null,
        // Raw value on purpose (mixed case / combined): the UI normalises or drops it.
        category: x.raw as 'hq' | 'ex' | 'os',
        band,
        da: x.da,
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
const newest = (a: Dcr, b: Dcr) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0);
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
/** Dates for the mock LEAVE_DCR_CONFLICT, or null when the switch is off. */
const leaveConflictDates = (): string[] | null => {
  try {
    const v = localStorage.getItem('af:mock-leave-dcr-conflict')?.trim();
    if (!v) return null;
    if (v === '1')
      return [new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() - 86_400_000))];
    const ds = v.split(',').map((x) => x.trim()).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x));
    return ds.length ? [...new Set(ds)].sort() : null;
  } catch {
    return null;
  }
};
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

  /** One saved draft per persona (yesterday's meeting) so the drafts list has a card on first load. */
  const seeded = new Set<string>();
  const seed = (userId: string) => {
    if (seeded.has(userId)) return;
    seeded.add(userId);
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
      new Date(Date.now() - 86_400_000),
    );
    if (dcrs.some((x) => x.userId === userId && x.date === date)) return;
    const at = new Date(Date.now() - 3 * 36e5).toISOString();
    const at2 = new Date(Date.now() - 2 * 36e5).toISOString();
    dcrs.push(
      Dcr.parse({
        id: crypto.randomUUID(),
        companyId: fx.COMPANY_ID,
        createdAt: at2,
        updatedAt: at2,
        deletedAt: null,
        version: 1,
        userId,
        date,
        workTypeId: DCR_WORK_TYPES[5]!.id,
        band: null,
        territoryIds: [],
        workWithUserIds: [],
        tourPlanId: null,
        deviationReason: null,
        details: { kind: 'office', taskType: 'Reports', description: 'Monthly expense statement', startTime: '16:00', durationMin: 60 },
        status: 'draft',
        calls: [],
        sfcRoutes: [],
        submittedAt: null,
        lockAt: lockAt(date),
        unlockedUntil: null,
      }),
      Dcr.parse({
        id: crypto.randomUUID(),
        companyId: fx.COMPANY_ID,
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
        version: 1,
        userId,
        date,
        workTypeId: DCR_WORK_TYPES[3]!.id,
        band: null,
        territoryIds: [],
        workWithUserIds: [],
        tourPlanId: null,
        deviationReason: null,
        details: { kind: 'meeting', title: 'Cycle meeting', mode: 'in_person', location: 'Durgapur office', startTime: '10:00', durationMin: 120 },
        status: 'draft',
        calls: [],
        sfcRoutes: [],
        submittedAt: null,
        lockAt: lockAt(date),
        unlockedUntil: null,
      }),
    );
  };

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
      seed(persona(request).me.id);
      const date = new URL(request.url).searchParams.get('date') ?? '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return validation('date is required (YYYY-MM-DD)');
      const { me } = persona(request);
      const day = dcrs.filter((x) => x.date === date && x.userId === me.id);
      const submitted = day.find((x) => x.status === 'submitted') ?? null;
      const drafts = day.filter((x) => x.status === 'draft').sort(newest);
      const d = submitted ?? drafts[0] ?? null;
      const body = DcrOptions.parse({
        date,
        workTypes: DCR_WORK_TYPES.map((w) => ({
          ...w,
          usesSfc: w.band !== null,
          detailsKind: dcrDetailsKind(w),
        })),
        dcr: d ? { ...d, lockAt: lockAt(d.date) } : null,
        submitted: submitted ? { ...submitted, lockAt: lockAt(submitted.date) } : null,
        drafts: drafts.map((x) => ({ ...x, lockAt: lockAt(x.date) })),
      });
      // Legacy band values from un-migrated work types, added after parsing on purpose: the UI maps
      // 'Ex' to EX case-insensitively (a duplicate band, so the first wins) and drops 'EX / OS'.
      const legacy = [
        { id: '01930000-0000-7000-8000-00000000d1a1', code: 'FIELD-EX-OLD', name: 'Field work (EX, legacy)', kind: 'field', band: 'Ex', usesSfc: true, detailsKind: null },
        { id: '01930000-0000-7000-8000-00000000d1a2', code: 'FIELD-EXOS-OLD', name: 'Field work (EX / OS, legacy)', kind: 'field', band: 'EX / OS', usesSfc: true, detailsKind: null },
      ];
      return HttpResponse.json({ ...body, workTypes: [...body.workTypes, ...legacy] });
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
      // Not parsed with DcrSfcMatch: legacy categories are passed through raw (see candidates()).
      const body = { band: wt.band, hqs: m.hqs };
      const missingHqIds = body.hqs.filter((h) => !h.candidates.length).map((h) => h.hqTerritoryId);
      if (missingHqIds.length)
        return err(404, 'SFC_NO_MATCH', 'No SFC route for some HQ of the day', { ...body, missingHqIds });
      return HttpResponse.json(body);
    }),
    http.put(`${base}/v1/dcrs/draft`, async ({ request }) => {
      const b = DcrDraftPut.safeParse(await request.json());
      if (!b.success) return validation('Invalid DCR', b.error.issues);
      const { me } = persona(request);
      seed(me.id);
      if (b.data.date > todayIST()) return validation('DCR date is in the future');
      if (isLocked(b.data.date)) return err(409, 'DAY_LOCKED', 'Day locked; request a correction');
      const day = dcrs.filter((x) => x.date === b.data.date && x.userId === me.id);
      let d: Dcr | undefined;
      if (b.data.id) {
        d = dcrs.find((x) => x.id === b.data.id && x.userId === me.id);
        if (!d) return err(404, 'NOT_FOUND', 'Draft not found');
        if (d.status !== 'draft') return err(409, 'ALREADY_SUBMITTED', 'Submitted DCRs are read-only; request a correction', { id: d.id });
        if (d.date !== b.data.date) return validation('date must equal the date of the draft', { field: 'date', expected: d.date });
      }
      const sub = day.find((x) => x.status === 'submitted');
      if (sub) return err(409, 'DAY_ALREADY_SUBMITTED', 'This day already has a submitted report', { existingId: sub.id });
      // Older clients: version without id updates the latest draft of the date.
      if (!b.data.id && b.data.version) {
        d = day.filter((x) => x.status === 'draft').sort(newest)[0];
        if (!d) return err(404, 'NOT_FOUND', 'Draft not found');
      }
      if (d && b.data.version && b.data.version !== d.version) return err(409, 'VERSION_CONFLICT', 'Stale version', Dcr.parse({ ...d, lockAt: lockAt(d.date) }));
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
      const other = dcrs.find((x) => x.id !== d.id && x.userId === me.id && x.date === d.date && x.status === 'submitted');
      if (other) return err(409, 'DAY_ALREADY_SUBMITTED', 'This day already has a submitted report', { existingId: other.id });
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
          // Combined/legacy categories can't be submitted (the UI never offers them).
          const c = h.candidates.find((x) => x.id === chosen && sfcCategoryOf(x.category));
          if (!c) return err(422, 'SFC_ROUTE_REQUIRED', `Pick the SFC route for ${h.hqName}`, { hqTerritoryIds: [h.hqTerritoryId] });
          const { id, version, ...rest } = c;
          routes.push({
            hqTerritoryId: h.hqTerritoryId,
            sfcRouteId: id,
            // Stored normalised, as the server does after 0043.
            snapshot: { ...rest, category: sfcCategoryOf(rest.category)!, sfcRouteId: id, routeVersion: version, hqTerritoryId: h.hqTerritoryId, ratePerKm: DEFAULT_RATE, frozenAt },
          });
        }
      }
      const now = new Date().toISOString();
      submitKeys.set(d.id, key);
      Object.assign(d, { status: 'submitted', submittedAt: now, submittedBy: me.id, sfcRoutes: routes, version: d.version + 1, updatedAt: now });
      return out(d);
    }),
    /**
     * The signed-in persona's drafts (the drafts workspace): GET /v1/dcrs?status=draft[&from&to&sort].
     * Other list queries (team views, submitted history) fall through to the contracts mock.
     */
    http.get(`${base}/v1/dcrs`, ({ request }) => {
      const q = new URL(request.url).searchParams;
      const status = q.get('status');
      if (q.get('mine') !== 'true' && status !== 'draft') return undefined;
      const { me } = persona(request);
      seed(me.id);
      const from = q.get('from');
      const to = q.get('to');
      const sort = q.get('sort') ?? '-date';
      const key = sort.replace(/^-/, '') as 'date' | 'createdAt' | 'updatedAt';
      const dir = sort.startsWith('-') ? -1 : 1;
      const items = dcrs
        .filter((d) => d.userId === me.id)
        .filter((d) => {
          const locked = d.status === 'draft' && isLocked(d.date);
          if (status === 'locked') return locked;
          if (status === 'draft') return d.status === 'draft' && !locked;
          if (status === 'submitted') return d.status === 'submitted';
          return true;
        })
        .filter((d) => (!from || d.date >= from) && (!to || d.date <= to))
        .sort((a, b) => (a[key] < b[key] ? -dir : a[key] > b[key] ? dir : 0))
        .slice(0, Number(q.get('limit') ?? 50))
        .map((d) => Dcr.parse({ ...d, lockAt: lockAt(d.date), callCount: d.calls.length }));
      return HttpResponse.json({ items, nextCursor: null, serverTime: new Date().toISOString() });
    }),
    // Approving leave while a submitted DCR is on a leave date (mock switch, see the header).
    ...[`${base}/v1/leave/requests/:id/decision`, `${base}/v1/approvals/:id/decision`].map((url) =>
      http.post(url, async ({ request }) => {
        const dates = leaveConflictDates();
        if (!dates) return undefined;
        const b = (await request.clone().json().catch(() => null)) as { decision?: string } | null;
        if (b?.decision !== 'approve') return undefined;
        const { me } = persona(request);
        const own = dcrs.filter((d) => d.status === 'submitted' && dates.includes(d.date) && d.userId === me.id).map((d) => d.id);
        const dcrIds = own.length ? own : dates.map((_, i) => `01930000-0000-7000-8000-0000000dc${String(i).padStart(3, '0')}`);
        return err(409, 'LEAVE_DCR_CONFLICT', 'A submitted DCR exists on these leave dates; sort the DCR out (correction) before approving', {
          dates,
          dcrIds: [...new Set(dcrIds)].sort(),
        });
      }),
    ),
    http.delete(`${base}/v1/dcrs/:id`, ({ params, request }) => {
      const { me } = persona(request);
      const i = dcrs.findIndex((x) => x.id === params.id && x.userId === me.id);
      if (i < 0) return err(404, 'NOT_FOUND', 'DCR not found');
      const d = dcrs[i]!;
      if (d.status !== 'draft') return err(409, 'ALREADY_SUBMITTED', 'Submitted DCRs cannot be deleted', { id: d.id });
      if (isLocked(d.date)) return err(409, 'DAY_LOCKED', 'This day is locked; request a correction', { lockAt: lockAt(d.date) });
      dcrs.splice(i, 1);
      return new HttpResponse(null, { status: 204 });
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
