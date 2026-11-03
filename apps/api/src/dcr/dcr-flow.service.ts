import { Injectable, NotFoundException } from '@nestjs/common';
import {
  DcrDetails,
  SFC_CATEGORY_BAND,
  dcrDetailsKind,
  isDeviation,
  type Dcr,
  type DcrBand,
  type DcrDraftPut,
  type DcrSfcSnapshot,
  type SfcCategory,
} from '@ariforce/contracts';
import {
  companies,
  dcrSfcRoutes,
  dcrs,
  leaveRequests,
  sfcRoutes,
  territories,
  users,
  workTypes,
  type Tx,
} from '@ariforce/db';
import {
  and,
  asc,
  eq,
  ilike,
  inArray,
  isNull,
  lte,
  gte,
  ne,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Principal } from '../auth/principal';
import { AuditService } from '../common/audit.service';
import { TenantService } from '../common/tenant.service';
import { err } from '../field/checkins.service';
import { companySettings, localDate } from '../field/field.util';
import { approvedLeaveDays, assertNotOnLeave } from '../leave/leave.util';
import { DcrService } from './dcr.service';

type WorkTypeRow = typeof workTypes.$inferSelect;
type RouteRow = typeof sfcRoutes.$inferSelect;
type DcrRow = typeof dcrs.$inferSelect;
interface Hq {
  id: string;
  name: string;
}

const num = (v: string | null) => (v === null ? null : Number(v));
/** Categories whose band is `band` (ex -> ex_hq, hq -> hq, os -> outstation). */
const categoriesFor = (band: DcrBand) =>
  (Object.keys(SFC_CATEGORY_BAND) as SfcCategory[]).filter((c) => SFC_CATEGORY_BAND[c] === band);
/** Band of a work type: field types with an allowance band only (Meeting and other non-field: none). */
export const workTypeBand = (wt: Pick<WorkTypeRow, 'kind' | 'allowanceBand'>): DcrBand | null =>
  wt.kind === 'field' && wt.allowanceBand !== 'none' ? wt.allowanceBand : null;

const candidate = (r: RouteRow) => ({
  id: r.id,
  fromPlace: r.fromPlace,
  toPlace: r.toPlace,
  oneWayKm: Number(r.oneWayKm),
  bothWayKm: Number(r.bothWayKm),
  oneWayAmount: num(r.oneWayAmount),
  bothWayAmount: num(r.bothWayAmount),
  actualFare: r.actualFare,
  travelMode: r.travelMode,
  category: r.category as SfcCategory,
  band: SFC_CATEGORY_BAND[r.category as SfcCategory],
  da: num(r.da),
  version: r.version,
});

/**
 * DCR redesign flow (docs/DCR-REDESIGN-DESIGN.md): options, territories, Work With, per-HQ SFC
 * match, draft upsert and submit with frozen per-route TA/DA snapshots. The old PUT /v1/dcrs stays.
 */
@Injectable()
export class DcrFlowService {
  constructor(
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
    private readonly dcr: DcrService,
  ) {}

  private async workType(tx: Tx, id: string) {
    const [wt] = await tx
      .select()
      .from(workTypes)
      .where(and(eq(workTypes.id, id), isNull(workTypes.deletedAt), eq(workTypes.active, true)));
    if (!wt) throw err(422, 'VALIDATION', 'Unknown work type', { workTypeId: id });
    return wt;
  }

  /** Territories (HQ or level 'territory', in scope) -> distinct HQs in first-seen order. */
  private async resolveHqs(tx: Tx, p: Principal, ids: string[]): Promise<Hq[]> {
    if (!ids.length) return [];
    const rows = await tx
      .select({ id: territories.id, level: territories.level, parentId: territories.parentId })
      .from(territories)
      .where(
        and(
          inArray(territories.id, ids),
          isNull(territories.deletedAt),
          this.tenant.scope(p, territories.path),
        ),
      );
    const miss = ids.filter((t) => !rows.some((r) => r.id === t));
    if (miss.length)
      throw err(422, 'VALIDATION', 'Unknown or out-of-scope territories', { territoryIds: miss });
    const wrong = rows.filter((r) => r.level !== 'headquarter' && r.level !== 'territory');
    if (wrong.length)
      throw err(422, 'VALIDATION', "Pick HQs or territories (level 'territory') only", {
        territoryIds: wrong.map((r) => r.id),
      });
    const hqIds: string[] = [];
    for (const id of ids) {
      const r = rows.find((x) => x.id === id)!;
      const hq = r.level === 'headquarter' ? r.id : r.parentId;
      if (!hq) throw err(422, 'VALIDATION', 'Territory has no HQ', { territoryIds: [id] });
      if (!hqIds.includes(hq)) hqIds.push(hq);
    }
    const names = await tx
      .select({ id: territories.id, name: territories.name })
      .from(territories)
      .where(inArray(territories.id, hqIds));
    return hqIds.map((id) => ({ id, name: names.find((n) => n.id === id)?.name ?? '' }));
  }

  /** The caller's live routes on these HQs whose category maps to `band`. */
  private async candidates(tx: Tx, userId: string, hqIds: string[], band: DcrBand) {
    if (!hqIds.length) return [];
    return tx
      .select()
      .from(sfcRoutes)
      .where(
        and(
          eq(sfcRoutes.userId, userId),
          inArray(sfcRoutes.hqTerritoryId, hqIds),
          isNull(sfcRoutes.deletedAt),
          inArray(sfcRoutes.category, categoriesFor(band)),
        ),
      )
      .orderBy(asc(sfcRoutes.sortOrder), asc(sfcRoutes.id));
  }

  options(p: Principal, date: string) {
    return this.tenant.run(p, async (tx) => {
      const s = await companySettings(tx, p);
      const wts = await tx
        .select()
        .from(workTypes)
        .where(and(isNull(workTypes.deletedAt), eq(workTypes.active, true)))
        .orderBy(asc(workTypes.code));
      const [row] = await tx
        .select()
        .from(dcrs)
        .where(and(eq(dcrs.userId, p.userId), eq(dcrs.date, date), isNull(dcrs.deletedAt)));
      // Always include day lock/unlock so clients know a day is open after an approved
      // correction even when there is no DCR row yet.
      const li = await this.dcr.lockInfo(tx, s, p.userId, date);
      return {
        date,
        workTypes: wts.map((w) => ({
          id: w.id,
          code: w.code,
          name: w.name,
          kind: w.kind,
          band: workTypeBand(w),
          usesSfc: workTypeBand(w) !== null,
          detailsKind: dcrDetailsKind(w),
        })),
        dcr: row ? (await this.dcr.toDto(tx, s, [row]))[0]! : null,
        lockAt: li.lockAt.toISOString(),
        unlockedUntil: li.unlockedUntil?.toISOString() ?? null,
        locked: li.locked,
      };
    });
  }

  territories(p: Principal) {
    return this.tenant.run(p, async (tx) => {
      const hqs = await tx
        .select({ id: territories.id, code: territories.code, name: territories.name })
        .from(territories)
        .where(
          and(
            eq(territories.level, 'headquarter'),
            isNull(territories.deletedAt),
            this.tenant.scope(p, territories.path),
          ),
        )
        .orderBy(asc(territories.name));
      const kids = hqs.length
        ? await tx
            .select({
              id: territories.id,
              code: territories.code,
              name: territories.name,
              parentId: territories.parentId,
            })
            .from(territories)
            .where(
              and(
                eq(territories.level, 'territory'),
                isNull(territories.deletedAt),
                inArray(
                  territories.parentId,
                  hqs.map((h) => h.id),
                ),
              ),
            )
            .orderBy(asc(territories.name))
        : [];
      return {
        items: hqs.map((h) => ({
          ...h,
          territories: kids
            .filter((k) => k.parentId === h.id)
            .map((k) => ({ id: k.id, code: k.code, name: k.name })),
        })),
      };
    });
  }

  /** Anyone can work with anyone: active users of the company except the caller. */
  workWith(p: Principal, q: { q?: string; limit: number }) {
    return this.tenant.run(p, async (tx) => {
      const term = q.q?.replace(/[\\%_]/g, (m) => `\\${m}`);
      const rows = await tx
        .select({
          id: users.id,
          name: users.name,
          employeeCode: users.employeeCode,
          designation: users.designation,
        })
        .from(users)
        .where(
          and(
            eq(users.status, 'active'),
            isNull(users.deletedAt),
            ne(users.id, p.userId),
            term
              ? or(ilike(users.name, `%${term}%`), ilike(users.employeeCode, `${term}%`))
              : undefined,
          ),
        )
        .orderBy(asc(users.name), asc(users.id))
        .limit(q.limit);
      return { items: rows };
    });
  }

  sfcMatch(p: Principal, q: { date: string; workTypeId: string; territoryIds: string[] }) {
    return this.tenant.run(p, async (tx) => {
      const wt = await this.workType(tx, q.workTypeId);
      const band = workTypeBand(wt);
      if (!band)
        throw err(422, 'VALIDATION', 'SFC applies to field work types only', {
          workTypeId: wt.id,
        });
      const hqs = await this.resolveHqs(tx, p, q.territoryIds);
      let rows: RouteRow[];
      try {
        rows = await this.candidates(
          tx,
          p.userId,
          hqs.map((h) => h.id),
          band,
        );
      } catch {
        throw err(503, 'SFC_UNAVAILABLE', 'SFC lookup failed; retry');
      }
      const out = {
        band,
        hqs: hqs.map((h) => {
          const c = rows.filter((r) => r.hqTerritoryId === h.id).map(candidate);
          return {
            hqTerritoryId: h.id,
            hqName: h.name,
            candidates: c,
            autoSelectedId: c.length === 1 ? c[0]!.id : null,
          };
        }),
      };
      const missingHqIds = out.hqs.filter((h) => !h.candidates.length).map((h) => h.hqTerritoryId);
      if (missingHqIds.length)
        throw err(404, 'SFC_NO_MATCH', 'No SFC route for some HQ of the day', {
          ...out,
          missingHqIds,
        });
      return out;
    });
  }

  /** Chosen routes must be the caller's, on that HQ, live, and in the band. */
  private async checkChoices(
    tx: Tx,
    p: Principal,
    choices: { hqTerritoryId: string; sfcRouteId: string }[],
    hqs: Hq[],
    band: DcrBand | null,
  ) {
    if (!choices.length) return;
    if (!band)
      throw err(422, 'VALIDATION', 'SFC applies to field work types only (Meeting never)', {
        field: 'sfcRoutes',
      });
    const hqDup = choices.map((c) => c.hqTerritoryId);
    if (new Set(hqDup).size !== hqDup.length)
      throw err(422, 'VALIDATION', 'One SFC route per HQ', { field: 'sfcRoutes' });
    const foreignHq = choices.filter((c) => !hqs.some((h) => h.id === c.hqTerritoryId));
    if (foreignHq.length)
      throw err(422, 'SFC_MISMATCH', 'Route HQ is not an HQ of the chosen territories', {
        hqTerritoryIds: foreignHq.map((c) => c.hqTerritoryId),
      });
    const ok = await this.candidates(
      tx,
      p.userId,
      choices.map((c) => c.hqTerritoryId),
      band,
    );
    const bad = choices.filter(
      (c) => !ok.some((r) => r.id === c.sfcRouteId && r.hqTerritoryId === c.hqTerritoryId),
    );
    if (bad.length)
      throw err(
        422,
        'SFC_MISMATCH',
        'Route is not yours, not on that HQ, deleted, or not in the band',
        {
          sfcRouteIds: bad.map((c) => c.sfcRouteId),
          band,
        },
      );
  }

  private checkDetailsKind(wt: WorkTypeRow, details: DcrDetails | null | undefined) {
    const want = dcrDetailsKind(wt);
    if (details && details.kind !== want)
      throw err(
        422,
        'VALIDATION',
        want ? `details.kind must be '${want}'` : 'No details for this work type',
        {
          field: 'details',
          expected: want,
        },
      );
  }

  private async checkWorkWith(tx: Tx, ids: string[]) {
    if (!ids.length) return;
    const found = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, ids), isNull(users.deletedAt)));
    const miss = ids.filter((i) => !found.some((f) => f.id === i));
    if (miss.length) throw err(422, 'VALIDATION', 'Unknown users', { workWithUserIds: miss });
  }

  /** Soft-delete route rows of HQs no longer on the day; upsert `choices` (snapshot cleared). */
  private async writeChoices(
    tx: Tx,
    p: Principal,
    dcrId: string,
    choices: { hqTerritoryId: string; sfcRouteId: string }[] | undefined,
    hqIds: string[],
  ) {
    const now = new Date();
    const keepHqs = choices ? choices.map((c) => c.hqTerritoryId) : hqIds;
    await tx
      .update(dcrSfcRoutes)
      .set({ deletedAt: now })
      .where(
        and(
          eq(dcrSfcRoutes.dcrId, dcrId),
          isNull(dcrSfcRoutes.deletedAt),
          keepHqs.length ? notInArray(dcrSfcRoutes.hqTerritoryId, keepHqs) : sql`true`,
        ),
      );
    for (const c of choices ?? []) {
      const [old] = await tx
        .select()
        .from(dcrSfcRoutes)
        .where(
          and(
            eq(dcrSfcRoutes.dcrId, dcrId),
            eq(dcrSfcRoutes.hqTerritoryId, c.hqTerritoryId),
            isNull(dcrSfcRoutes.deletedAt),
          ),
        );
      if (old && old.sfcRouteId === c.sfcRouteId) continue;
      if (old)
        await tx
          .update(dcrSfcRoutes)
          .set({ sfcRouteId: c.sfcRouteId, snapshot: null })
          .where(eq(dcrSfcRoutes.id, old.id));
      else
        await tx.insert(dcrSfcRoutes).values({
          id: uuidv7(),
          companyId: p.companyId,
          dcrId,
          hqTerritoryId: c.hqTerritoryId,
          sfcRouteId: c.sfcRouteId,
        });
    }
  }

  draft(p: Principal, b: DcrDraftPut) {
    return this.tenant.run(p, async (tx) => {
      const s = await companySettings(tx, p);
      if (b.date > localDate(new Date(), s.timezone))
        throw err(422, 'VALIDATION', 'DCR date is in the future');
      const [cur] = await tx
        .select()
        .from(dcrs)
        .where(and(eq(dcrs.userId, p.userId), eq(dcrs.date, b.date)))
        .for('update');
      const li = await this.dcr.lockInfo(tx, s, p.userId, b.date);
      if (li.locked)
        throw err(409, 'DAY_LOCKED', 'This day is locked; request a correction', {
          lockAt: li.lockAt.toISOString(),
        });
      if (cur && !cur.deletedAt && cur.status === 'submitted')
        throw err(409, 'ALREADY_SUBMITTED', 'Submitted DCRs are read-only; request a correction', {
          id: cur.id,
        });
      if (cur && b.version && b.version !== cur.version)
        throw err(
          409,
          'VERSION_CONFLICT',
          'Stale version',
          (await this.dcr.toDto(tx, s, [cur]))[0],
        );

      const wt = await this.workType(tx, b.workTypeId);
      const band = workTypeBand(wt);
      if (b.band && b.band !== band)
        throw err(422, 'VALIDATION', 'band must match the work type', {
          field: 'band',
          expected: band,
        });
      if (wt.kind === 'field' || wt.kind === 'non_field')
        assertNotOnLeave(await approvedLeaveDays(tx, [p.userId], b.date, b.date), [
          { date: b.date, session: 'full', kind: wt.kind },
        ]);
      if (wt.kind !== 'field' && b.calls.length)
        throw err(422, 'VALIDATION', 'Calls need a field work type', { field: 'calls' });
      this.checkDetailsKind(wt, b.details);
      const hqs = await this.resolveHqs(tx, p, b.territoryIds);
      await this.checkWorkWith(tx, b.workWithUserIds);
      await this.checkChoices(tx, p, b.sfcRoutes ?? [], hqs, band);
      const { ptr } = await this.dcr.validateCalls(tx, p, b, cur?.id);
      const plan = await this.dcr.plan(tx, p.userId, b.date);

      const vals = {
        workTypeId: b.workTypeId,
        territoryId: b.territoryIds[0] ?? null,
        territoryIds: b.territoryIds,
        tourPlanId: plan.tourPlanId,
        deviationReason: b.deviationReason?.trim() || null,
        band,
        details: b.details ?? null,
        workWithUserIds: b.workWithUserIds,
        status: 'draft' as const,
      };
      const [row] = cur
        ? await tx
            .update(dcrs)
            .set({ ...vals, deletedAt: null })
            .where(eq(dcrs.id, cur.id))
            .returning()
        : await tx
            .insert(dcrs)
            .values({
              id: uuidv7(),
              companyId: p.companyId,
              userId: p.userId,
              date: b.date,
              ...vals,
            })
            .returning();
      const dcrId = row!.id;
      await this.dcr.writeCalls(tx, p, dcrId, b.date, b.calls, ptr);
      await this.writeChoices(
        tx,
        p,
        dcrId,
        band ? b.sfcRoutes : [],
        hqs.map((h) => h.id),
      );
      await this.audit.record(tx, p, 'dcr.draft_save', {
        entityType: 'dcr',
        entityId: dcrId,
        after: { date: b.date, calls: b.calls.length, hqs: hqs.length },
      });
      const [fresh] = await tx.select().from(dcrs).where(eq(dcrs.id, dcrId));
      return (await this.dcr.toDto(tx, s, [fresh!]))[0]!;
    });
  }

  submit(p: Principal, id: string, version: number, key: string) {
    return this.tenant.run(p, async (tx) => {
      const s = await companySettings(tx, p);
      const [cur] = await tx
        .select()
        .from(dcrs)
        .where(and(eq(dcrs.id, id), eq(dcrs.userId, p.userId), isNull(dcrs.deletedAt)))
        .for('update');
      if (!cur) throw new NotFoundException('DCR not found');
      if (cur.status === 'submitted') {
        if (cur.submitIdempotencyKey === key) return (await this.dcr.toDto(tx, s, [cur]))[0]!;
        throw err(409, 'ALREADY_SUBMITTED', 'Already submitted; request a correction', { id });
      }
      const [reused] = await tx
        .select({ id: dcrs.id })
        .from(dcrs)
        .where(and(eq(dcrs.userId, p.userId), eq(dcrs.submitIdempotencyKey, key)));
      if (reused)
        throw err(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key already used for another DCR', {
          id: reused.id,
        });
      if (version !== cur.version)
        throw err(
          409,
          'VERSION_CONFLICT',
          'Stale version',
          (await this.dcr.toDto(tx, s, [cur]))[0],
        );
      const li = await this.dcr.lockInfo(tx, s, p.userId, cur.date);
      if (li.locked)
        throw err(409, 'DAY_LOCKED', 'This day is locked; request a correction', {
          lockAt: li.lockAt.toISOString(),
        });
      if (cur.date > localDate(new Date(), s.timezone))
        throw err(422, 'VALIDATION', 'DCR date is in the future');

      const wt = await this.workType(tx, cur.workTypeId);
      const band = workTypeBand(wt);
      if (wt.kind === 'field' || wt.kind === 'non_field')
        assertNotOnLeave(await approvedLeaveDays(tx, [p.userId], cur.date, cur.date), [
          { date: cur.date, session: 'full', kind: wt.kind },
        ]);
      const dto = (await this.dcr.toDto(tx, s, [cur]))[0]!;
      const field = wt.kind === 'field';
      if (field && !cur.territoryIds.length)
        throw err(422, 'VALIDATION', 'Pick at least one territory', { field: 'territoryIds' });
      if (field && !dto.calls.length)
        throw err(422, 'VALIDATION', 'Field work needs at least one call', { field: 'calls' });
      if (!field && dto.calls.length)
        throw err(422, 'VALIDATION', 'Calls need a field work type', { field: 'calls' });
      const hqs = await this.resolveHqs(tx, p, cur.territoryIds);
      await this.checkWorkWith(tx, cur.workWithUserIds);
      await this.details(tx, p, wt, cur);
      await this.dcr.validateCalls(
        tx,
        p,
        {
          calls: dto.calls.map(({ id: clientId, ...c }) => ({
            ...c,
            clientId,
            checkInId: c.checkInId,
          })),
        },
        cur.id,
      );
      const plan = await this.dcr.plan(tx, p.userId, cur.date);
      if (isDeviation(plan.entries, cur.workTypeId, cur.territoryIds) && !cur.deviationReason)
        throw err(
          422,
          'DEVIATION_REASON_REQUIRED',
          'Worked plan differs from the approved tour plan; give a reason',
          {
            planned: plan.entries.map((e) => ({
              workTypeId: e.workTypeId,
              territoryIds: e.territoryIds,
            })),
          },
        );

      // One route per HQ of the day: chosen and valid, or the single candidate.
      const chosen = band
        ? dto.sfcRoutes.filter((r) => hqs.some((h) => h.id === r.hqTerritoryId))
        : [];
      await this.checkChoices(tx, p, chosen, hqs, band);
      const routes: RouteRow[] = [];
      if (band) {
        const all = await this.candidates(
          tx,
          p.userId,
          hqs.map((h) => h.id),
          band,
        );
        const none: string[] = [];
        const many: { hqTerritoryId: string; candidates: number }[] = [];
        for (const h of hqs) {
          const pick = chosen.find((c) => c.hqTerritoryId === h.id);
          const c = all.filter((r) => r.hqTerritoryId === h.id);
          if (pick) routes.push(c.find((r) => r.id === pick.sfcRouteId)!);
          else if (c.length === 1) routes.push(c[0]!);
          else if (!c.length) none.push(h.id);
          else many.push({ hqTerritoryId: h.id, candidates: c.length });
        }
        if (none.length)
          throw err(422, 'SFC_NO_MATCH', 'No SFC route for some HQ of the day', {
            hqTerritoryIds: none,
            band,
          });
        if (many.length)
          throw err(422, 'SFC_ROUTE_REQUIRED', 'Choose one SFC route for each HQ', { hqs: many });
      }
      const [co] = await tx
        .select({ rate: companies.sfcRatePerKm })
        .from(companies)
        .where(eq(companies.id, p.companyId));
      const frozenAt = new Date().toISOString();
      await this.writeChoices(
        tx,
        p,
        cur.id,
        routes.map((r) => ({ hqTerritoryId: r.hqTerritoryId, sfcRouteId: r.id })),
        [],
      );
      for (const r of routes) {
        const snapshot: DcrSfcSnapshot = {
          ...candidate(r),
          sfcRouteId: r.id,
          routeVersion: r.version,
          hqTerritoryId: r.hqTerritoryId,
          band: band!,
          ratePerKm: Number(co!.rate),
          frozenAt,
        };
        delete (snapshot as Partial<{ id: string; version: number }>).id;
        delete (snapshot as Partial<{ id: string; version: number }>).version;
        await tx
          .update(dcrSfcRoutes)
          .set({ snapshot })
          .where(
            and(
              eq(dcrSfcRoutes.dcrId, cur.id),
              eq(dcrSfcRoutes.hqTerritoryId, r.hqTerritoryId),
              isNull(dcrSfcRoutes.deletedAt),
            ),
          );
      }
      await tx
        .update(dcrs)
        .set({
          status: 'submitted',
          submittedAt: new Date(),
          submittedBy: p.userId,
          submitIdempotencyKey: key,
          band,
          tourPlanId: plan.tourPlanId,
        })
        .where(eq(dcrs.id, cur.id));
      await this.audit.record(tx, p, 'dcr.submit', {
        entityType: 'dcr',
        entityId: cur.id,
        after: { date: cur.date, calls: dto.calls.length, sfcRoutes: routes.map((r) => r.id) },
      });
      const [fresh] = await tx.select().from(dcrs).where(eq(dcrs.id, cur.id));
      return (await this.dcr.toDto(tx, s, [fresh!]))[0]! satisfies Dcr;
    });
  }

  /** Non-field details: required shape per work type; leave must reference your leave request. */
  private async details(tx: Tx, p: Principal, wt: WorkTypeRow, cur: DcrRow) {
    const want = dcrDetailsKind(wt);
    if (!want) {
      if (cur.details)
        throw err(422, 'VALIDATION', 'No details for this work type', { field: 'details' });
      return;
    }
    const parsed = DcrDetails.safeParse(cur.details);
    if (!parsed.success || parsed.data.kind !== want)
      throw err(422, 'VALIDATION', `details (kind '${want}') are required`, {
        field: 'details',
        expected: want,
        issues: parsed.success ? undefined : parsed.error.issues.map((i) => i.path.join('.')),
      });
    if (parsed.data.kind === 'leave') {
      const [lr] = await tx
        .select({ id: leaveRequests.id })
        .from(leaveRequests)
        .where(
          and(
            eq(leaveRequests.id, parsed.data.leaveRequestId),
            eq(leaveRequests.userId, p.userId),
            isNull(leaveRequests.deletedAt),
            inArray(leaveRequests.status, ['pending', 'approved']),
            lte(leaveRequests.fromDate, cur.date),
            gte(leaveRequests.toDate, cur.date),
          ),
        );
      if (!lr)
        throw err(
          422,
          'LEAVE_NOT_FOUND',
          'No pending or approved leave request of yours covers this date',
          {
            leaveRequestId: parsed.data.leaveRequestId,
          },
        );
    }
  }
}
