import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { assertDcrDateWritable } from './dcr-date';
import {
  DCR_UNLOCK_HOURS,
  type Dcr,
  type DcrCall,
  type DcrUpsert,
  type TourPlan,
} from '@ariforce/contracts';
import {
  chemists,
  consentRecords,
  dcrCallProducts,
  dcrCallRcpa,
  dcrCalls,
  dcrs,
  dcrSfcRoutes,
  devices,
  expenseLines,
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
import { SUBMITTED_STATUSES, dayReport, isDaySubmittedViolation } from './day-report';
import { AuditService } from '../common/audit.service';
import { TenantService } from '../common/tenant.service';
import { CheckInsService, capDate, err } from '../field/checkins.service';
import { companySettings, localDate, type CompanySettings } from '../field/field.util';
import { OutletLocationsService } from '../field/outlet-locations.service';
import { decodeCursor, encodeCursor } from '../masters/masters.service';
import { ApprovalsService } from '../plans/approvals.service';
import { autoApproveAudit, isDirector, systemPrincipal } from '../plans/auto-approve';
import { NotificationsService } from '../notifications/notifications.service';
import { ExceptionRecheck } from '../jobs/exception-recheck';
import { approvedLeaveDays, assertNotOnLeave, lockDcrLeave } from '../leave/leave.util';
import {
  DCR_LOCK_TZ,
  doctorPob,
  missingCheckIns,
  missingPresentation,
  pobValue,
} from './dcr-rules';

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
  mine?: 'true' | 'false';
  doctorId?: string;
}

/**
 * SQL: day-lock instant for a dcrs.date-like expression: 00:00 Asia/Kolkata on the next day (submit
 * by 23:59 IST the same day). companies.dcr_lock_after_hours / timezone no longer apply to DCRs.
 */
const lockAtSql = (date: SQL | typeof dcrs.date, _s?: CompanySettings) =>
  sql`((((${date})::date + 1)::timestamp at time zone ${DCR_LOCK_TZ}))`;
/**
 * SQL: end of the unlock window for (user, date), or null: 48 h after the latest approved correction
 * (dcr_unlock) or the latest manager rejection of a report of that day (automatic reopen).
 */
// Parenthesised as a whole: callers append ::text / comparisons, and `a + b::text` would cast b.
const unlockedUntilSql = (userId: SQL | typeof dcrs.userId, date: SQL | typeof dcrs.date) =>
  sql`(greatest(
       (select max(st.decided_at)
          from approval_requests r join approval_steps st on st.request_id = r.id
          where r.entity_type = 'dcr_correction' and r.state = 'approved' and r.requested_by = ${userId}
            and r.payload->>'date' = (${date})::text),
       (select max(x.rejected_at) from dcrs x
          where x.user_id = ${userId} and x.date = (${date})::date and x.status = 'rejected'
            and x.deleted_at is null)
     ) + make_interval(hours => ${DCR_UNLOCK_HOURS}))`;

export { pobValue };

/** Audit of a director's DCR approved at submit (same after{} shape as approval.auto_approved). */
export async function auditDcrAutoApproved(
  audit: AuditService,
  tx: Tx,
  p: Principal,
  dcrId: string,
  date: string,
) {
  await audit.record(tx, p, 'dcr.auto_approved', {
    entityType: 'dcr',
    entityId: dcrId,
    after: {
      ...autoApproveAudit({
        subjectType: 'dcr',
        subjectId: dcrId,
        requestId: null,
        requestedBy: p.userId,
        at: new Date(),
      }),
      date,
    },
  });
}

/** SQL: the DCR owner is a director (never locks; DCRs auto-approved at submit). By role, no flag. */
export const neverLocksSql = (userId: SQL | typeof dcrs.userId) =>
  sql`(exists (select 1 from user_roles nl_ur join roles nl_r on nl_r.id = nl_ur.role_id
       where nl_ur.user_id = ${userId} and nl_r.key = 'director' and nl_r.deleted_at is null))`;

/** Status columns of a DCR submit: a director's report is approved by the system at once. */
export const submitStatus = (p: Pick<Principal, 'roles'>, at: Date) =>
  isDirector(p)
    ? { status: 'approved' as const, approvedAt: at, approvedBy: null }
    : { status: 'submitted' as const };

@Injectable()
export class DcrService {
  constructor(
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
    private readonly checkIns: CheckInsService,
    private readonly outlets: OutletLocationsService,
    private readonly approvals: ApprovalsService,
    private readonly notifications: NotificationsService,
    private readonly recheck: ExceptionRecheck,
  ) {}

  /**
   * After a DCR submit (same transaction; never fails it). Director: dcr.approved to themselves
   * (system, autoApproved). Others: dcr.submitted ('waiting for you') to the dcr:review chain.
   */
  async notifySubmit(tx: Tx, p: Principal, d: typeof dcrs.$inferSelect) {
    // Resolve dcr_missing / punch_without_dcr for the day within a minute (not the next daily run).
    await this.recheck.queue(tx, p, d.date);
    const stamp = (d.submittedAt ?? d.updatedAt).getTime();
    const base = { entityType: 'dcr' as const, entityId: d.id, data: { date: d.date } };
    if (isDirector(p))
      return this.notifications.notify(tx, systemPrincipal(p), {
        ...base,
        type: 'dcr.approved',
        recipientId: p.userId,
        dedupeKey: `dcr.approved:${d.id}:${stamp}`,
      });
    await this.notifications.notifyMany(
      tx,
      p,
      { ...base, type: 'dcr.submitted', dedupeKey: `dcr.submitted:${d.id}:${stamp}` },
      await this.notifications.reviewerChain(tx, d.userId, 'dcr:review'),
    );
  }

  async lockInfo(tx: Tx, s: CompanySettings, userId: string, date: string) {
    const res = await tx.execute(
      sql`select ${lockAtSql(sql`${date}`, s)}::text as lock_at,
                 ${unlockedUntilSql(sql`${userId}::uuid`, sql`${date}`)}::text as unlocked_until,
                 ${neverLocksSql(sql`${userId}::uuid`)} as never_locks`,
    );
    const rows = ((res as unknown as { rows?: unknown[] }).rows ?? res) as {
      lock_at: string;
      unlocked_until: string | null;
      never_locks: boolean;
    }[];
    const lockAt = new Date(rows[0]!.lock_at);
    const uu = rows[0]!.unlocked_until;
    const unlockedUntil = uu ? new Date(uu) : null;
    const now = Date.now();
    const unlocked = !!unlockedUntil && unlockedUntil.getTime() > now;
    const neverLocks = !!rows[0]!.never_locks;
    return {
      lockAt,
      unlockedUntil: unlocked ? unlockedUntil : null,
      // Directors' days never lock (no 00:00 IST lock, no unlock request).
      locked: !neverLocks && now > lockAt.getTime() && !unlocked,
      neverLocks,
    };
  }

  private async lockInfoForRows(tx: Tx, s: CompanySettings, rows: DcrRow[]) {
    const pairs = [
      ...new Map(
        rows.map((r) => [`${r.userId}:${r.date}`, { userId: r.userId, date: r.date }]),
      ).values(),
    ];
    const values = sql.join(
      pairs.map((p) => sql`(${p.userId}::uuid, ${p.date}::date)`),
      sql`, `,
    );
    const result = await tx.execute(sql`
      with pairs(user_id, report_date) as (values ${values})
      select user_id::text as user_id, report_date::text as report_date,
             ${lockAtSql(sql`pairs.report_date`, s)}::text as lock_at,
             ${unlockedUntilSql(sql`pairs.user_id`, sql`pairs.report_date`)}::text as unlocked_until,
             ${neverLocksSql(sql`pairs.user_id`)} as never_locks
        from pairs
    `);
    const data = ((result as unknown as { rows?: unknown[] }).rows ?? result) as {
      user_id: string;
      report_date: string;
      lock_at: string;
      unlocked_until: string | null;
      never_locks: boolean;
    }[];
    const now = Date.now();
    return new Map(
      data.map((r) => {
        const lockAt = new Date(r.lock_at);
        const unlockedUntil = r.unlocked_until ? new Date(r.unlocked_until) : null;
        const unlocked = !!unlockedUntil && unlockedUntil.getTime() > now;
        const neverLocks = !!r.never_locks;
        return [
          `${r.user_id}:${r.report_date}`,
          {
            lockAt,
            unlockedUntil: unlocked ? unlockedUntil : null,
            locked: !neverLocks && now > lockAt.getTime() && !unlocked,
            neverLocks,
          },
        ];
      }),
    );
  }

  async toDto(tx: Tx, s: CompanySettings, rows: DcrRow[]): Promise<Dcr[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const lockInfo = await this.lockInfoForRows(tx, s, rows);
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
    // Expense link read fields: one grouped query over the live origin-dcr lines (no N+1).
    const exp = new Map(
      (
        await tx
          .select({
            dcrId: expenseLines.dcrId,
            claimId: sql<string>`(array_agg(${expenseLines.claimId}))[1]`,
            total: sql<string>`coalesce(sum(${expenseLines.amount}), 0)`,
            count: sql<number>`count(*)::int`,
          })
          .from(expenseLines)
          .where(
            and(
              inArray(expenseLines.dcrId, ids),
              eq(expenseLines.origin, 'dcr'),
              isNull(expenseLines.deletedAt),
            ),
          )
          .groupBy(expenseLines.dcrId)
      ).map((x) => [x.dcrId, x]),
    );
    const out: Dcr[] = [];
    for (const r of rows) {
      const e = exp.get(r.id);
      const li = lockInfo.get(`${r.userId}:${r.date}`)!;
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
        tourPlanItemId: r.tourPlanItemId ?? null,
        deviationReason: r.deviationReason,
        status:
          r.status === 'approved' || r.status === 'rejected'
            ? r.status
            : li.locked
              ? 'locked'
              : r.status === 'submitted'
                ? 'submitted'
                : 'draft',
        reviewStatus:
          r.status === 'submitted'
            ? 'pending'
            : r.status === 'approved' || r.status === 'rejected'
              ? r.status
              : null,
        approvedAt: r.approvedAt?.toISOString() ?? null,
        autoApproved: r.status === 'approved' && !!r.approvedAt && !r.approvedBy,
        neverLocks: li.neverLocks,
        approvedBy: r.approvedBy,
        rejectedAt: r.rejectedAt?.toISOString() ?? null,
        rejectedBy: r.rejectedBy,
        rejectionReason: r.rejectionReason,
        submittedAt: r.submittedAt?.toISOString() ?? null,
        lockAt: li.lockAt.toISOString(),
        unlockedUntil: li.unlockedUntil?.toISOString() ?? null,
        band: r.band,
        details: (r.details as Dcr['details']) ?? null,
        expenses: (r.expenses as Dcr['expenses']) ?? [],
        expenseClaimId: e?.claimId ?? null,
        expenseTotal: e ? Number(e.total) : 0,
        expenseCount: e?.count ?? 0,
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
              presentationOpenedAt: c.presentationOpenedAt?.toISOString() ?? null,
              presentationLocationId: c.presentationLocationId ?? null,
              presentationDistanceM: c.presentationDistanceM ?? null,
              presentationAccuracyM: c.presentationAccuracyM ?? null,
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
      const locked = sql`(now() > ${lockAtSql(dcrs.date, s)} and coalesce(${unlockedUntilSql(dcrs.userId, dcrs.date)} < now(), true) and not ${neverLocksSql(dcrs.userId)})`;
      const where = [
        isNull(dcrs.deletedAt),
        // Team scope (approvals hierarchy) only for reviewers (dcr:review) not asking mine=true;
        // everyone else sees only their own DCRs.
        q.mine === 'true' || !p.permissions.includes('dcr:review')
          ? eq(dcrs.userId, p.userId)
          : this.checkIns.userFilter(p, q.userId, dcrs.userId),
        q.doctorId
          ? sql`exists (select 1 from dcr_calls c where c.company_id = ${dcrs.companyId} and c.dcr_id = ${dcrs.id} and c.outlet_kind = 'doctor' and c.outlet_id = ${q.doctorId} and c.deleted_at is null)`
          : undefined,
        q.from ? sql`${dcrs.date} >= ${q.from}` : undefined,
        q.to ? sql`${dcrs.date} <= ${q.to}` : undefined,
        q.territoryId
          ? sql`${dcrs.territoryIds} && array(${this.checkIns.territorySubtree(tx, q.territoryId)})`
          : undefined,
        q.status === 'locked'
          ? and(inArray(dcrs.status, ['draft', 'submitted']), locked)
          : q.status === 'approved' || q.status === 'rejected'
            ? eq(dcrs.status, q.status)
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
        items: (await this.toDto(tx, s, rows.slice(0, limit))).map((d) => ({
          ...d,
          callCount: d.calls.length,
        })),
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
    // POB is priced at PTS (Sharanya, 2026-10-29); the stored value is kept as saved.
    const pts = new Map<string, string | null>();
    if (prodIds.length) {
      const found = await tx
        .select({ id: products.id, active: products.active, pts: products.pts })
        .from(products)
        .where(and(inArray(products.id, prodIds), isNull(products.deletedAt)));
      const miss = prodIds.filter((i) => !found.some((f) => f.id === i));
      if (miss.length) bad.productIds = miss;
      for (const f of found) pts.set(f.id, f.pts);
      // #40: POB and RCPA lines need an active product (detailing/samples keep the old rule).
      const orderIds = new Set(
        b.calls.flatMap((c) => [...c.pob, ...c.rcpa].map((x) => x.productId)),
      );
      const inactive = found.filter((f) => !f.active && orderIds.has(f.id)).map((f) => f.id);
      if (inactive.length) bad.inactiveProductIds = inactive;
    }
    // POB on chemist/stockist calls only; RCPA on chemist calls only; no duplicate lines in a call.
    const docPob = doctorPob(b.calls);
    if (docPob) throw err(422, 'VALIDATION', 'POB is not allowed on doctor calls', docPob);
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
      // Multi-draft (0045): a check-in counts as used only by a live submitted report; other
      // drafts of the day are alternatives and may reuse it.
      const used = await tx
        .select({ geo: dcrCalls.geoCaptureId })
        .from(dcrCalls)
        .innerJoin(dcrs, eq(dcrs.id, dcrCalls.dcrId))
        .where(
          and(
            inArray(
              dcrCalls.geoCaptureId,
              ci.map((c) => c.checkInId!),
            ),
            isNull(dcrCalls.deletedAt),
            isNull(dcrs.deletedAt),
            inArray(dcrs.status, [...SUBMITTED_STATUSES]),
            dcrId ? ne(dcrCalls.dcrId, dcrId) : sql`true`,
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
    return { pts };
  }

  /** Submit rule: every field call needs a linked visit check-in. */
  assertCheckIns(calls: Parameters<typeof missingCheckIns>[0]) {
    const miss = missingCheckIns(calls);
    if (miss) throw err(422, 'VALIDATION', 'Check in at every call outlet before submitting', miss);
  }

  /** Submit rule: doctor calls with products detailed need presentationOpenedAt. */
  assertPresentations(calls: Parameters<typeof missingPresentation>[0]) {
    const miss = missingPresentation(calls);
    if (miss)
      throw err(
        422,
        'VALIDATION',
        'Open the presentation on every doctor call with products detailed',
        miss,
      );
  }

  upsert(p: Principal, b: Upsert) {
    return this.tenant.run(p, async (tx) => {
      const s = await companySettings(tx, p);
      // Multi-draft (0045): the legacy upsert edits the day report (submitted, else latest draft)
      // and no longer revives soft-deleted rows.
      const cur = dayReport(
        await tx
          .select()
          .from(dcrs)
          .where(and(eq(dcrs.userId, p.userId), eq(dcrs.date, b.date), isNull(dcrs.deletedAt)))
          .for('update'),
      );
      const li = await this.lockInfo(tx, s, p.userId, b.date);
      if (li.locked)
        throw err(409, 'DAY_LOCKED', 'This day is locked; request a correction', {
          lockAt: li.lockAt.toISOString(),
        });
      // Then today only (IST); a past day only while unlocked (dcr-date.ts).
      assertDcrDateWritable(b.date, { unlocked: !!li.unlockedUntil });
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
      // Legacy submit: serialise with leave approval before the approved-leave check.
      if (b.submit) await lockDcrLeave(tx, p.userId);
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
      // TP feature: changes from the approved tour plan no longer need a deviation reason
      // (deviationReason stays optional and is stored as given).

      const { pts } = await this.validateCalls(tx, p, b, cur?.id);
      if (b.submit) {
        this.assertCheckIns(b.calls);
        this.assertPresentations(b.calls);
      }

      const vals = {
        workTypeId: b.workTypeId,
        territoryId: b.territoryIds[0] ?? null,
        territoryIds: b.territoryIds,
        tourPlanId: plan.tourPlanId,
        deviationReason: reason,
        ...(b.submit ? { ...submitStatus(p, new Date()), submittedAt: new Date() } : {}),
      };
      let row: DcrRow | undefined;
      try {
        // Savepoint: a concurrent submit of the same day trips dcrs_user_date_submitted_uq.
        [row] = await tx.transaction((sp) =>
          cur
            ? sp.update(dcrs).set(vals).where(eq(dcrs.id, cur.id)).returning()
            : sp
                .insert(dcrs)
                .values({
                  id: uuidv7(),
                  companyId: p.companyId,
                  userId: p.userId,
                  date: b.date,
                  ...vals,
                })
                .returning(),
        );
      } catch (e) {
        if (!isDaySubmittedViolation(e)) throw e;
        const [other] = await tx
          .select({ id: dcrs.id })
          .from(dcrs)
          .where(
            and(
              eq(dcrs.userId, p.userId),
              eq(dcrs.date, b.date),
              isNull(dcrs.deletedAt),
              inArray(dcrs.status, [...SUBMITTED_STATUSES]),
            ),
          );
        throw err(409, 'DAY_ALREADY_SUBMITTED', 'This day already has a submitted report', {
          existingId: other?.id ?? null,
        });
      }
      const dcrId = row!.id;
      await this.writeCalls(tx, p, dcrId, b.date, b.calls, pts);
      if (b.submit && isDirector(p)) await auditDcrAutoApproved(this.audit, tx, p, dcrId, b.date);
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
      if (b.submit) await this.notifySubmit(tx, p, fresh!);
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
    pts: Map<string, string | null>,
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
    const s = await companySettings(tx, p);
    const existing = keep.length
      ? await tx
          .select({
            id: dcrCalls.id,
            presentationOpenedAt: dcrCalls.presentationOpenedAt,
            presentationLocationId: dcrCalls.presentationLocationId,
            presentationDistanceM: dcrCalls.presentationDistanceM,
            presentationAccuracyM: dcrCalls.presentationAccuracyM,
            geoCaptureId: dcrCalls.geoCaptureId,
          })
          .from(dcrCalls)
          .where(and(inArray(dcrCalls.id, keep), isNull(dcrCalls.deletedAt)))
      : [];
    const priorCalls = new Map(existing.map((r) => [r.id, r]));

    // Batch-load locks only for calls newly opening Presentation.
    const opening = calls.filter((c) => {
      const was = priorCalls.get(c.clientId);
      return !!c.presentationCapture || (!!c.presentationOpenedAt && !was?.presentationOpenedAt);
    });
    const locks = await this.outlets.loadActive(
      tx,
      opening.map((c) => ({ outletKind: c.outletKind, outletId: c.outletId })),
    );
    const locksByOutlet = new Map<string, typeof locks>();
    for (const loc of locks) {
      const k = `${loc.outletKind}:${loc.outletId}`;
      const arr = locksByOutlet.get(k) ?? [];
      arr.push(loc);
      locksByOutlet.set(k, arr);
    }

    for (const c of calls) {
      // calledAt is server time when the call (clientId) is first saved; re-saves keep it and any
      // client value is ignored (Sharanya, 2026-10-29).
      const was = priorCalls.get(c.clientId);
      let geoCaptureId = c.checkInId ?? was?.geoCaptureId ?? null;
      let presentationOpenedAt: Date | null = c.presentationOpenedAt
        ? new Date(c.presentationOpenedAt)
        : null;
      let presentationLocationId: string | null = was?.presentationLocationId ?? null;
      let presentationDistanceM: number | null = was?.presentationDistanceM ?? null;
      let presentationAccuracyM: number | null = was?.presentationAccuracyM ?? null;

      const openingNow =
        !!c.presentationCapture || (!!presentationOpenedAt && !was?.presentationOpenedAt);

      if (!presentationOpenedAt) {
        presentationLocationId = null;
        presentationDistanceM = null;
        presentationAccuracyM = null;
      } else if (openingNow) {
        // Per-call visit check-in first; Presentation is a second step on that visit.
        if (!geoCaptureId)
          throw err(
            422,
            'CALL_NOT_CHECKED_IN',
            'Check in at this outlet before opening Presentation',
            { outletKind: c.outletKind, outletId: c.outletId },
          );
        if (!c.presentationCapture)
          throw err(
            422,
            'PRESENTATION_CAPTURE_REQUIRED',
            'presentationCapture is required when opening Presentation',
          );
        const cap = c.presentationCapture;
        const dayLocs = locksByOutlet.get(`${c.outletKind}:${c.outletId}`) ?? [];
        if (!dayLocs.length)
          throw err(422, 'OUTLET_NOT_LOCKED', 'Lock this outlet location before Presentation', {
            outletKind: c.outletKind,
            outletId: c.outletId,
          });

        const day = localDate(new Date(cap.capturedAt), s.timezone);
        const punched = await tx
          .select({ id: geoCaptures.id })
          .from(geoCaptures)
          .where(
            and(
              eq(geoCaptures.userId, p.userId),
              eq(geoCaptures.kind, 'punch_in'),
              sql`${capDate(s.timezone)} = ${day}::date`,
            ),
          )
          .limit(1);
        if (!punched.length)
          throw err(422, 'NOT_PUNCHED_IN', 'Punch in before opening Presentation');

        if (cap.isMock && s.blockMockLocation)
          throw err(422, 'MOCK_LOCATION', 'Mock location is not allowed');
        if (cap.accuracyM > s.maxAccuracyM)
          throw err(
            422,
            'LOW_ACCURACY',
            `GPS accuracy ${cap.accuracyM} m exceeds ${s.maxAccuracyM} m`,
            { maxAccuracyM: s.maxAccuracyM },
          );

        const hit = this.outlets.nearest(dayLocs, cap.location, cap.locationId);
        if (!hit)
          throw err(
            422,
            'LOCATION_NOT_FOUND',
            'presentationCapture.locationId is not an active lock',
          );
        if (hit.distanceM > s.presentationRadiusM)
          throw err(
            422,
            'PRESENTATION_OUT_OF_FENCE',
            `You are ${hit.distanceM} m from the outlet (limit ${s.presentationRadiusM} m)`,
            { distanceM: hit.distanceM, radiusM: s.presentationRadiusM, locationId: hit.loc.id },
          );

        const active = await tx
          .select({ id: devices.id })
          .from(devices)
          .where(and(eq(devices.userId, p.userId), eq(devices.status, 'active')));
        const deviceId = cap.deviceId ?? (active.length === 1 ? active[0]!.id : undefined);
        if (!deviceId || !active.some((d) => d.id === deviceId))
          throw err(412, 'DEVICE_NOT_ACTIVE', 'Enrol this device before Presentation');
        const [consent] = await tx
          .select({ granted: consentRecords.granted })
          .from(consentRecords)
          .where(
            and(
              eq(consentRecords.userId, p.userId),
              eq(consentRecords.purpose, 'location_checkin'),
            ),
          )
          .orderBy(desc(consentRecords.at), desc(consentRecords.id))
          .limit(1);
        if (!consent?.granted)
          throw err(412, 'CONSENT_REQUIRED', 'Location check-in consent not granted');

        const t = OUTLETS[c.outletKind];
        const [o] = await tx
          .select({ territoryId: t.territoryId })
          .from(t)
          .where(eq(t.id, c.outletId));

        const [prevCap] = await tx
          .select()
          .from(geoCaptures)
          .where(eq(geoCaptures.id, cap.clientId));
        if (prevCap) {
          if (prevCap.userId !== p.userId || prevCap.kind !== 'visit')
            throw err(
              409,
              'IDEMPOTENCY_CONFLICT',
              'clientId already used for a different check-in',
            );
          geoCaptureId = prevCap.id;
        } else {
          await tx.insert(geoCaptures).values({
            id: cap.clientId,
            companyId: p.companyId,
            userId: p.userId,
            deviceId,
            kind: 'visit',
            location: { x: cap.location.lng, y: cap.location.lat },
            accuracyM: cap.accuracyM,
            source: 'gps',
            isMock: cap.isMock ?? false,
            entityType: c.outletKind,
            entityId: c.outletId,
            distanceM: hit.distanceM,
            territoryId: o?.territoryId ?? null,
            capturedAt: new Date(cap.capturedAt),
          });
          geoCaptureId = cap.clientId;
        }

        presentationOpenedAt = presentationOpenedAt ?? new Date(cap.capturedAt);
        presentationLocationId = hit.loc.id;
        presentationDistanceM = hit.distanceM;
        presentationAccuracyM = cap.accuracyM;
      }

      const v = {
        outletKind: c.outletKind,
        outletId: c.outletId,
        geoCaptureId,
        jointWorkUserId: c.jointWorkUserIds[0] ?? null,
        jointWorkUserIds: c.jointWorkUserIds,
        remarks: c.remarks ?? null,
        presentationOpenedAt,
        presentationLocationId,
        presentationDistanceM,
        presentationAccuracyM,
      };
      await tx
        .insert(dcrCalls)
        .values({
          id: c.clientId,
          companyId: p.companyId,
          dcrId,
          userId: p.userId,
          date: date,
          calledAt: now,
          ...v,
        })
        .onConflictDoUpdate({
          target: dcrCalls.id,
          set: { ...v, calledAt: sql`coalesce(${dcrCalls.calledAt}, ${now})`, deletedAt: null },
        });
    }
    if (keep.length) {
      // Saved POB values stay as saved (lead rule): an existing line for the same call and
      // product with the same quantity keeps its stored value; an edited quantity or a new
      // line is priced at the current PTS. A stored null (no PTS then) is priced now.
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
        return pobValue(quantity, pts.get(productId) ?? null);
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
      // The day report (submitted, else latest draft) is the subject of the correction.
      const cur = dayReport(
        await tx
          .select({
            id: dcrs.id,
            date: dcrs.date,
            status: dcrs.status,
            version: dcrs.version,
            updatedAt: dcrs.updatedAt,
          })
          .from(dcrs)
          .where(and(eq(dcrs.userId, p.userId), eq(dcrs.date, date), isNull(dcrs.deletedAt))),
      );
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
