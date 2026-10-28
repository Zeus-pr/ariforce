import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DCR_UNLOCK_HOURS,
  isDeviation,
  type Dcr,
  type DcrCall,
  type DcrUpsert,
  type TourPlan,
} from '@ariforce/contracts';
import {
  chemists,
  dcrCallProducts,
  dcrCallRcpa,
  dcrCalls,
  dcrs,
  dcrSfcRoutes,
  doctors,
  geoCaptures,
  products,
  stockists,
  territories,
  tourPlans,
  users,
  workTypes,
  type Tx,
} from '@ariforce/db';
import { and, asc, desc, eq, inArray, isNull, ne, notInArray, sql, type SQL } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type * as z from 'zod';
import type { Principal } from '../auth/principal';
import { dayStates, loadSubs } from '../plans/tp-submissions';
import { AuditService } from '../common/audit.service';
import { TenantService } from '../common/tenant.service';
import { CheckInsService, err } from '../field/checkins.service';
import { companySettings, localDate, type CompanySettings } from '../field/field.util';
import { decodeCursor, encodeCursor } from '../masters/masters.service';
import { ApprovalsService } from '../plans/approvals.service';
import { approvedLeaveDays, assertNotOnLeave } from '../leave/leave.util';

type Upsert = z.infer<typeof DcrUpsert>;
type DcrRow = typeof dcrs.$inferSelect;
const OUTLETS = { doctor: doctors, chemist: chemists, stockist: stockists } as const;

export interface DcrQuery {
  limit?: number;
  cursor?: string;
  sort?: string;
  includeTotal?: 'true' | 'false';
  from?: string;
  to?: string;
  userId?: string;
  territoryId?: string;
  status?: Dcr['status'];
}

/** SQL: day-lock instant for a dcrs.date-like expression. */
const lockAtSql = (date: SQL | typeof dcrs.date, s: CompanySettings) =>
  sql`((((${date})::date + 1)::timestamp at time zone ${s.timezone}) + make_interval(hours => ${s.dcrLockAfterHours}))`;
/** SQL: end of the unlock window from the latest approved correction for (user, date), or null. */
const unlockedUntilSql = (userId: SQL | typeof dcrs.userId, date: SQL | typeof dcrs.date) =>
  sql`(select max(st.decided_at) + make_interval(hours => ${DCR_UNLOCK_HOURS})
       from approval_requests r join approval_steps st on st.request_id = r.id
       where r.entity_type = 'dcr_correction' and r.state = 'approved' and r.requested_by = ${userId}
         and r.payload->>'date' = (${date})::text)`;

/** #40: POB value = quantity × PTR (INR, 2 dp), or null when the product has no PTR. */
export const pobValue = (quantity: number, ptr: string | null) =>
  ptr == null ? null : (Math.round(quantity * Number(ptr) * 100) / 100).toFixed(2);

@Injectable()
export class DcrService {
  constructor(
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
    private readonly checkIns: CheckInsService,
    private readonly approvals: ApprovalsService,
  ) {}

  async lockInfo(tx: Tx, s: CompanySettings, userId: string, date: string) {
    const res = await tx.execute(
      sql`select ${lockAtSql(sql`${date}`, s)}::text as lock_at,
                 ${unlockedUntilSql(sql`${userId}::uuid`, sql`${date}`)}::text as unlocked_until`,
    );
    const rows = ((res as unknown as { rows?: unknown[] }).rows ?? res) as {
      lock_at: string;
      unlocked_until: string | null;
    }[];
    const lockAt = new Date(rows[0]!.lock_at);
    const uu = rows[0]!.unlocked_until;
    const unlockedUntil = uu ? new Date(uu) : null;
    const now = Date.now();
    const unlocked = !!unlockedUntil && unlockedUntil.getTime() > now;
    return {
      lockAt,
      unlockedUntil: unlocked ? unlockedUntil : null,
      locked: now > lockAt.getTime() && !unlocked,
    };
  }

  async toDto(tx: Tx, s: CompanySettings, rows: DcrRow[]): Promise<Dcr[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const calls = await tx
      .select()
      .from(dcrCalls)
      .where(and(inArray(dcrCalls.dcrId, ids), isNull(dcrCalls.deletedAt)))
      .orderBy(asc(dcrCalls.calledAt), asc(dcrCalls.id));
    const lines = calls.length
      ? await tx
          .select()
          .from(dcrCallProducts)
          .where(
            and(
              inArray(
                dcrCallProducts.callId,
                calls.map((c) => c.id),
              ),
              isNull(dcrCallProducts.deletedAt),
            ),
          )
      : [];
    const rcpa = calls.length
      ? await tx
          .select()
          .from(dcrCallRcpa)
          .where(
            and(
              inArray(
                dcrCallRcpa.callId,
                calls.map((c) => c.id),
              ),
              isNull(dcrCallRcpa.deletedAt),
            ),
          )
          .orderBy(asc(dcrCallRcpa.id))
      : [];
    const routes = await tx
      .select()
      .from(dcrSfcRoutes)
      .where(and(inArray(dcrSfcRoutes.dcrId, ids), isNull(dcrSfcRoutes.deletedAt)))
      .orderBy(asc(dcrSfcRoutes.createdAt), asc(dcrSfcRoutes.id));
    const out: Dcr[] = [];
    for (const r of rows) {
      const li = await this.lockInfo(tx, s, r.userId, r.date);
      out.push({
        id: r.id,
        companyId: r.companyId,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        deletedAt: r.deletedAt?.toISOString() ?? null,
        version: r.version,
        userId: r.userId,
        date: r.date,
        workTypeId: r.workTypeId,
        territoryIds: r.territoryIds.length ? r.territoryIds : r.territoryId ? [r.territoryId] : [],
        tourPlanId: r.tourPlanId,
        deviationReason: r.deviationReason,
        status: li.locked ? 'locked' : r.status === 'submitted' ? 'submitted' : 'draft',
        submittedAt: r.submittedAt?.toISOString() ?? null,
        lockAt: li.lockAt.toISOString(),
        unlockedUntil: li.unlockedUntil?.toISOString() ?? null,
        band: r.band,
        details: (r.details as Dcr['details']) ?? null,
        workWithUserIds: r.workWithUserIds,
        sfcRoutes: routes
          .filter((x) => x.dcrId === r.id)
          .map((x) => ({
            hqTerritoryId: x.hqTerritoryId,
            sfcRouteId: x.sfcRouteId,
            snapshot: (x.snapshot as Dcr['sfcRoutes'][number]['snapshot']) ?? null,
          })),
        submittedBy: r.submittedBy,
        calls: calls
          .filter((c) => c.dcrId === r.id)
          .map((c): DcrCall => {
            const l = lines.filter((x) => x.callId === c.id);
            return {
              id: c.id,
              outletKind: c.outletKind,
              outletId: c.outletId,
              checkInId: c.geoCaptureId,
              jointWorkUserIds: c.jointWorkUserIds,
              productsDetailed: l
                .filter((x) => x.kind === 'detailed')
                .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
                .map((x) => ({ productId: x.productId, order: x.seq ?? 1 })),
              samples: l
                .filter((x) => x.kind === 'sample')
                .map((x) => ({ productId: x.productId, quantity: x.quantity ?? 0 })),
              pob: l
                .filter((x) => x.kind === 'pob')
                .map((x) => ({
                  productId: x.productId,
                  quantity: x.quantity ?? 0,
                  stockistId: x.stockistId,
                  value: x.value === null ? null : Number(x.value),
                })),
              rcpa: rcpa
                .filter((x) => x.callId === c.id)
                .map((x) => ({
                  productId: x.productId,
                  competitorBrand: x.competitorBrand,
                  competitorCompany: x.competitorCompany,
                  quantity: x.quantity,
                  prescriptions: x.prescriptions,
                  doctorId: x.doctorId,
                })),
              remarks: c.remarks,
              calledAt: (c.calledAt ?? c.createdAt).toISOString(),
            };
          }),
      });
    }
    return out;
  }

  list(p: Principal, q: DcrQuery) {
    return this.tenant.run(p, async (tx) => {
      const s = await companySettings(tx, p);
      const locked = sql`(now() > ${lockAtSql(dcrs.date, s)} and coalesce(${unlockedUntilSql(dcrs.userId, dcrs.date)} < now(), true))`;
      const where = [
        isNull(dcrs.deletedAt),
        this.checkIns.userFilter(p, q.userId, dcrs.userId),
        q.from ? sql`${dcrs.date} >= ${q.from}` : undefined,
        q.to ? sql`${dcrs.date} <= ${q.to}` : undefined,
        q.territoryId
          ? sql`${dcrs.territoryIds} && array(${this.checkIns.territorySubtree(tx, q.territoryId)})`
          : undefined,
        q.status === 'locked'
          ? locked
          : q.status
            ? and(eq(dcrs.status, q.status), sql`not ${locked}`)
            : undefined,
      ].filter(Boolean) as SQL[];
      const sort = q.sort ?? '-date';
      const field = sort.replace(/^-/, '');
      const col = { date: dcrs.date, createdAt: dcrs.createdAt, updatedAt: dcrs.updatedAt }[field];
      if (!col) throw err(422, 'VALIDATION', `Unknown sort field ${field}`);
      const dir = sort.startsWith('-') ? desc : asc;
      const limit = q.limit ?? 50;
      const offset = decodeCursor(q.cursor);
      const rows = await tx
        .select()
        .from(dcrs)
        .where(and(...where))
        .orderBy(dir(col), dir(dcrs.id))
        .limit(limit + 1)
        .offset(offset);
      const out: Record<string, unknown> = {
        items: await this.toDto(tx, s, rows.slice(0, limit)),
        nextCursor: rows.length > limit ? encodeCursor(offset + limit) : null,
        serverTime: new Date().toISOString(),
      };
      if (q.includeTotal === 'true') {
        const [t] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(dcrs)
          .where(and(...where));
        out.total = t!.n;
      }
      return out;
    });
  }

  get(p: Principal, id: string) {
    return this.tenant.run(p, async (tx) => {
      const s = await companySettings(tx, p);
      const [r] = await tx
        .select()
        .from(dcrs)
        .where(
          and(
            eq(dcrs.id, id),
            isNull(dcrs.deletedAt),
            this.checkIns.userFilter(p, undefined, dcrs.userId),
          ),
        );
      if (!r) throw new NotFoundException('DCR not found');
      return (await this.toDto(tx, s, [r]))[0]!;
    });
  }

  /** The TP for the date's month and its entries for that date, if that day is approved (#86). */
  async plan(tx: Tx, userId: string, date: string) {
    const [tp] = await tx
      .select()
      .from(tourPlans)
      .where(
        and(
          eq(tourPlans.userId, userId),
          eq(tourPlans.month, `${date.slice(0, 7)}-01`),
          isNull(tourPlans.deletedAt),
        ),
      );
    if (!tp || dayStates(tp, await loadSubs(tx, [tp.id])).get(date)?.status !== 'approved')
      return { tourPlanId: null, entries: [] };
    const entries =
      ((tp.days ?? []) as TourPlan['days']).find((d) => d.date === date)?.entries ?? [];
    return { tourPlanId: tp.id, entries };
  }

  async validateCalls(tx: Tx, p: Principal, b: Pick<Upsert, 'calls'>, dcrId: string | undefined) {
    const bad: Record<string, string[]> = {};
    const scope = this.tenant.scope(p, territories.path);
    for (const kind of ['doctor', 'chemist', 'stockist'] as const) {
      const ids = [...new Set(b.calls.filter((c) => c.outletKind === kind).map((c) => c.outletId))];
      if (!ids.length) continue;
      const t = OUTLETS[kind];
      const found = await tx
        .select({ id: t.id })
        .from(t)
        .innerJoin(territories, eq(territories.id, t.territoryId))
        .where(
          and(
            inArray(t.id, ids),
            isNull(t.deletedAt),
            scope,
            // Rejected field-added doctors cannot be reported (#26); pending ones can.
            kind === 'doctor' ? ne(doctors.approvalStatus, 'rejected') : undefined,
          ),
        );
      const miss = ids.filter((i) => !found.some((f) => f.id === i));
      if (miss.length) bad[`${kind}Ids`] = miss;
    }
    const prodIds = [
      ...new Set(
        b.calls.flatMap((c) => [
          ...c.productsDetailed.map((x) => x.productId),
          ...c.samples.map((x) => x.productId),
          ...c.pob.map((x) => x.productId),
          ...c.rcpa.map((x) => x.productId),
        ]),
      ),
    ];
    const ptr = new Map<string, string | null>();
    if (prodIds.length) {
      const found = await tx
        .select({ id: products.id, active: products.active, ptr: products.ptr })
        .from(products)
        .where(and(inArray(products.id, prodIds), isNull(products.deletedAt)));
      const miss = prodIds.filter((i) => !found.some((f) => f.id === i));
      if (miss.length) bad.productIds = miss;
      for (const f of found) ptr.set(f.id, f.ptr);
      // #40: POB and RCPA lines need an active product (detailing/samples keep the old rule).
      const orderIds = new Set(
        b.calls.flatMap((c) => [...c.pob, ...c.rcpa].map((x) => x.productId)),
      );
      const inactive = found.filter((f) => !f.active && orderIds.has(f.id)).map((f) => f.id);
      if (inactive.length) bad.inactiveProductIds = inactive;
    }
    // #40: POB on doctor/chemist/stockist calls, RCPA on chemist calls only, no duplicate lines in a call.
    const rcpaOutlet = b.calls.filter((c) => c.rcpa.length && c.outletKind !== 'chemist');
    if (rcpaOutlet.length) bad.rcpaOutletCallIds = rcpaOutlet.map((c) => c.clientId);
    const dup = (keys: string[]) => new Set(keys).size !== keys.length;
    const dupPob = b.calls.filter((c) => dup(c.pob.map((x) => x.productId)));
    if (dupPob.length) bad.duplicatePob = dupPob.map((c) => c.clientId);
    const dupRcpa = b.calls.filter((c) =>
      dup(c.rcpa.map((x) => `${x.productId}|${(x.competitorBrand ?? '').toLowerCase()}`)),
    );
    if (dupRcpa.length) bad.duplicateRcpa = dupRcpa.map((c) => c.clientId);
    const inScope = async (kind: 'doctor' | 'stockist', ids: string[]) => {
      if (!ids.length) return [];
      const t = OUTLETS[kind];
      const found = await tx
        .select({ id: t.id })
        .from(t)
        .innerJoin(territories, eq(territories.id, t.territoryId))
        .where(and(inArray(t.id, ids), isNull(t.deletedAt), scope));
      return ids.filter((i) => !found.some((f) => f.id === i));
    };
    const badStockists = await inScope('stockist', [
      ...new Set(
        b.calls.flatMap((c) => c.pob.flatMap((x) => (x.stockistId ? [x.stockistId] : []))),
      ),
    ]);
    if (badStockists.length) bad.stockistIds = badStockists;
    const badDoctors = await inScope('doctor', [
      ...new Set(b.calls.flatMap((c) => c.rcpa.flatMap((x) => (x.doctorId ? [x.doctorId] : [])))),
    ]);
    if (badDoctors.length) bad.rcpaDoctorIds = badDoctors;
    const jw = [...new Set(b.calls.flatMap((c) => c.jointWorkUserIds))];
    if (jw.length) {
      const found = await tx.select({ id: users.id }).from(users).where(inArray(users.id, jw));
      const miss = jw.filter((i) => !found.some((f) => f.id === i));
      if (miss.length) bad.jointWorkUserIds = miss;
    }
    const ci = b.calls.filter((c) => c.checkInId);
    if (ci.length) {
      const caps = await tx
        .select()
        .from(geoCaptures)
        .where(
          inArray(
            geoCaptures.id,
            ci.map((c) => c.checkInId!),
          ),
        );
      const wrong = ci.filter((c) => {
        const g = caps.find((x) => x.id === c.checkInId);
        return (
          !g ||
          g.userId !== p.userId ||
          g.kind !== 'visit' ||
          g.entityType !== c.outletKind ||
          g.entityId !== c.outletId
        );
      });
      if (wrong.length) bad.checkInIds = wrong.map((c) => c.checkInId!);
      const used = await tx
        .select({ geo: dcrCalls.geoCaptureId })
        .from(dcrCalls)
        .where(
          and(
            inArray(
              dcrCalls.geoCaptureId,
              ci.map((c) => c.checkInId!),
            ),
            isNull(dcrCalls.deletedAt),
            notInArray(
              dcrCalls.id,
              b.calls.map((c) => c.clientId),
            ),
          ),
        );
      if (used.length) bad.checkInIdsAlreadyLinked = used.map((u) => u.geo!);
    }
    const ids = b.calls.map((c) => c.clientId);
    if (new Set(ids).size !== ids.length) bad.clientIds = ['duplicate clientId'];
    if (Object.keys(bad).length) throw err(422, 'VALIDATION', 'Invalid calls', bad);
    const foreign = await tx
      .select({ id: dcrCalls.id })
      .from(dcrCalls)
      .where(and(inArray(dcrCalls.id, ids), dcrId ? ne(dcrCalls.dcrId, dcrId) : sql`true`));
    if (foreign.length)
      throw err(409, 'IDEMPOTENCY_CONFLICT', 'Call clientId belongs to another DCR', {
        clientIds: foreign.map((f) => f.id),
      });
    return { ptr };
  }

  upsert(p: Principal, b: Upsert) {
    return this.tenant.run(p, async (tx) => {
      const s = await companySettings(tx, p);
      if (b.date > localDate(new Date(), s.timezone))
        throw err(422, 'VALIDATION', 'DCR date is in the future');
      const [cur] = await tx
        .select()
        .from(dcrs)
        .where(and(eq(dcrs.userId, p.userId), eq(dcrs.date, b.date)))
        .for('update');
      const li = await this.lockInfo(tx, s, p.userId, b.date);
      if (li.locked)
        throw err(409, 'DAY_LOCKED', 'This day is locked; request a correction', {
          lockAt: li.lockAt.toISOString(),
        });
      if (cur?.submitIdempotencyKey)
        throw err(409, 'ALREADY_SUBMITTED', 'Submitted DCRs are read-only; request a correction');
      if (cur && b.version && b.version !== cur.version)
        throw err(409, 'VERSION_CONFLICT', 'Stale version', (await this.toDto(tx, s, [cur]))[0]);

      const [wt] = await tx
        .select()
        .from(workTypes)
        .where(
          and(
            eq(workTypes.id, b.workTypeId),
            isNull(workTypes.deletedAt),
            eq(workTypes.active, true),
          ),
        );
      if (!wt) throw err(422, 'VALIDATION', 'Unknown work type', { workTypeId: b.workTypeId });
      if (wt.kind === 'field' || wt.kind === 'non_field')
        assertNotOnLeave(await approvedLeaveDays(tx, [p.userId], b.date, b.date), [
          { date: b.date, session: 'full', kind: wt.kind },
        ]);
      const field = wt.kind === 'field';
      if (!field && b.calls.length) throw err(422, 'VALIDATION', 'Calls need a field work type');
      if (field && b.submit && !b.calls.length)
        throw err(422, 'VALIDATION', 'Field work needs at least one call');
      if (b.territoryIds.length) {
        const found = await tx
          .select({ id: territories.id })
          .from(territories)
          .where(
            and(inArray(territories.id, b.territoryIds), this.tenant.scope(p, territories.path)),
          );
        const miss = b.territoryIds.filter((t) => !found.some((f) => f.id === t));
        if (miss.length)
          throw err(422, 'VALIDATION', 'Unknown or out-of-scope territories', {
            territoryIds: miss,
          });
      }

      const plan = await this.plan(tx, p.userId, b.date);
      const reason = b.deviationReason?.trim() || null;
      if (isDeviation(plan.entries, b.workTypeId, b.territoryIds) && !reason)
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

      const { ptr } = await this.validateCalls(tx, p, b, cur?.id);

      const vals = {
        workTypeId: b.workTypeId,
        territoryId: b.territoryIds[0] ?? null,
        territoryIds: b.territoryIds,
        tourPlanId: plan.tourPlanId,
        deviationReason: reason,
        ...(b.submit ? { status: 'submitted' as const, submittedAt: new Date() } : {}),
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
      await this.writeCalls(tx, p, dcrId, b.date, b.calls, ptr);
      await this.audit.record(tx, p, b.submit ? 'dcr.submit' : 'dcr.save', {
        entityType: 'dcr',
        entityId: dcrId,
        after: {
          date: b.date,
          calls: b.calls.length,
          deviation: !!reason,
          pobLines: b.calls.reduce((n, c) => n + c.pob.length, 0),
          rcpaLines: b.calls.reduce((n, c) => n + c.rcpa.length, 0),
        },
      });
      const [fresh] = await tx.select().from(dcrs).where(eq(dcrs.id, dcrId));
      return (await this.toDto(tx, s, [fresh!]))[0]!;
    });
  }

  /** Replace the DCR's calls, product lines and RCPA with `calls` (soft delete + upsert by clientId). */
  async writeCalls(
    tx: Tx,
    p: Principal,
    dcrId: string,
    date: string,
    calls: Upsert['calls'],
    ptr: Map<string, string | null>,
  ) {
    const now = new Date();
    const keep = calls.map((c) => c.clientId);
    await tx
      .update(dcrCalls)
      .set({ deletedAt: now })
      .where(
        and(
          eq(dcrCalls.dcrId, dcrId),
          isNull(dcrCalls.deletedAt),
          keep.length ? notInArray(dcrCalls.id, keep) : sql`true`,
        ),
      );
    for (const c of calls) {
      const v = {
        outletKind: c.outletKind,
        outletId: c.outletId,
        calledAt: new Date(c.calledAt),
        geoCaptureId: c.checkInId ?? null,
        jointWorkUserId: c.jointWorkUserIds[0] ?? null,
        jointWorkUserIds: c.jointWorkUserIds,
        remarks: c.remarks ?? null,
      };
      await tx
        .insert(dcrCalls)
        .values({
          id: c.clientId,
          companyId: p.companyId,
          dcrId,
          userId: p.userId,
          date: date,
          ...v,
        })
        .onConflictDoUpdate({ target: dcrCalls.id, set: { ...v, deletedAt: null } });
    }
    if (keep.length) {
      // Saved POB values stay as saved (lead rule): an existing line for the same call and
      // product with the same quantity keeps its stored value; an edited quantity or a new
      // line is priced at the current PTR. A stored null (no PTR then) is priced now.
      const prior = new Map<string, { quantity: number | null; value: string | null }>();
      for (const l of await tx
        .select({
          callId: dcrCallProducts.callId,
          productId: dcrCallProducts.productId,
          quantity: dcrCallProducts.quantity,
          value: dcrCallProducts.value,
        })
        .from(dcrCallProducts)
        .where(
          and(
            inArray(dcrCallProducts.callId, keep),
            eq(dcrCallProducts.kind, 'pob'),
            isNull(dcrCallProducts.deletedAt),
          ),
        ))
        prior.set(`${l.callId}|${l.productId}`, { quantity: l.quantity, value: l.value });
      const pobLineValue = (callId: string, productId: string, quantity: number) => {
        const was = prior.get(`${callId}|${productId}`);
        if (was && was.quantity === quantity && was.value !== null) return was.value;
        return pobValue(quantity, ptr.get(productId) ?? null);
      };
      await tx
        .update(dcrCallProducts)
        .set({ deletedAt: now })
        .where(and(inArray(dcrCallProducts.callId, keep), isNull(dcrCallProducts.deletedAt)));
      const lines = calls.flatMap((c) => [
        ...c.productsDetailed.map((x) => ({
          callId: c.clientId,
          productId: x.productId,
          kind: 'detailed' as const,
          seq: x.order,
        })),
        ...c.samples.map((x) => ({
          callId: c.clientId,
          productId: x.productId,
          kind: 'sample' as const,
          quantity: x.quantity,
        })),
        ...c.pob.map((x) => ({
          callId: c.clientId,
          productId: x.productId,
          kind: 'pob' as const,
          quantity: x.quantity,
          stockistId: x.stockistId ?? null,
          value: pobLineValue(c.clientId, x.productId, x.quantity),
        })),
      ]);
      if (lines.length)
        await tx
          .insert(dcrCallProducts)
          .values(lines.map((l) => ({ id: uuidv7(), companyId: p.companyId, ...l })));
      await tx
        .update(dcrCallRcpa)
        .set({ deletedAt: now })
        .where(and(inArray(dcrCallRcpa.callId, keep), isNull(dcrCallRcpa.deletedAt)));
      const rcpa = calls.flatMap((c) =>
        c.rcpa.map((x) => ({
          id: uuidv7(),
          companyId: p.companyId,
          callId: c.clientId,
          productId: x.productId,
          competitorBrand: x.competitorBrand ?? null,
          competitorCompany: x.competitorCompany ?? null,
          quantity: x.quantity,
          prescriptions: x.prescriptions ?? null,
          doctorId: x.doctorId ?? null,
        })),
      );
      if (rcpa.length) await tx.insert(dcrCallRcpa).values(rcpa);
    }
  }

  /** Distinct competitor brands captured in RCPA in the caller's company (#40). */
  competitorBrands(p: Principal, q: { q?: string; limit: number }) {
    return this.tenant.run(p, async (tx) => {
      const term = q.q
        ?.trim()
        .toLowerCase()
        .replace(/[\\%_]/g, (m) => `\\${m}`);
      const res = await tx.execute(sql`
        select min(r.competitor_brand) as brand,
               mode() within group (order by r.competitor_company) as company,
               count(*)::int as uses
        from dcr_call_rcpa r
        join dcr_calls c on c.id = r.call_id and c.deleted_at is null
        where r.deleted_at is null and r.competitor_brand is not null
          ${term ? sql`and (lower(r.competitor_brand) like ${`${term}%`} or lower(r.competitor_brand) like ${`% ${term}%`})` : sql``}
        group by lower(r.competitor_brand)
        order by uses desc, brand asc
        limit ${q.limit}`);
      const rows = ((res as unknown as { rows?: unknown[] }).rows ?? res) as {
        brand: string;
        company: string | null;
        uses: number;
      }[];
      return { items: rows.map((r) => ({ brand: r.brand, company: r.company, uses: r.uses })) };
    });
  }

  requestCorrection(p: Principal, date: string, reason: string) {
    return this.tenant.run(p, async (tx) => {
      if (!p.teamUserIds && !p.roles.length) throw new ForbiddenException();
      const s = await companySettings(tx, p);
      const li = await this.lockInfo(tx, s, p.userId, date);
      if (!li.locked)
        throw err(
          409,
          'CONFLICT',
          li.unlockedUntil ? 'Day is already unlocked' : 'Day is not locked',
          {
            lockAt: li.lockAt.toISOString(),
            unlockedUntil: li.unlockedUntil?.toISOString() ?? null,
          },
        );
      const [cur] = await tx
        .select({ id: dcrs.id })
        .from(dcrs)
        .where(and(eq(dcrs.userId, p.userId), eq(dcrs.date, date)));
      const id = await this.approvals.request(
        tx,
        p,
        'dcr_correction',
        cur?.id ?? uuidv7(),
        reason,
        { date },
      );
      await this.audit.record(tx, p, 'dcr.correction_request', {
        entityType: 'dcr',
        entityId: cur?.id ?? null,
        after: { date, reason },
      });
      return this.approvals.byId(tx, id);
    });
  }
}
