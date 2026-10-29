import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  Approval,
  ApprovalDecision,
  ApprovalDetail,
  ApprovalSubject,
  NotificationType,
  Permission,
} from '@ariforce/contracts';
import type * as z from 'zod';
import {
  approvalRequests,
  approvalSteps,
  chemists,
  doctorCategories,
  doctors,
  expenseLines,
  specialties,
  territories,
  tourPlanSubmissions,
  tourPlans,
  users,
  workTypes,
  type Tx,
} from '@ariforce/db';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Principal } from '../auth/principal';
import { AuditService } from '../common/audit.service';
import { TenantService } from '../common/tenant.service';
import { err } from '../field/checkins.service';
import { NotificationsService } from '../notifications/notifications.service';
import { rejectionReason } from '../common/rejection';
import { plansOut, syncStatus } from './tp-submissions';
import { routeToHolders } from './approval-routing';
import { decodeCursor, encodeCursor } from '../masters/masters.service';

type EntityType = (typeof approvalRequests.$inferInsert)['entityType'];
const SUBJECT: Partial<Record<EntityType, Approval['subjectType']>> = {
  tour_plan: 'tour_plan',
  dcr_correction: 'dcr_unlock',
  doctor: 'doctor',
  leave: 'leave',
  expense: 'expense',
};
const ENTITY = Object.fromEntries(Object.entries(SUBJECT).map(([k, v]) => [v, k])) as Record<
  Approval['subjectType'],
  EntityType | undefined
>;
const STATUS = (s: string): Approval['status'] =>
  s === 'approved' || s === 'rejected' || s === 'cancelled'
    ? s
    : s === 'returned'
      ? 'rejected'
      : 'pending';

/** Effect of a final decision on the subject (registered per entity type; DCR unlock adds its own). */
export type DecisionHook = (
  tx: Tx,
  p: Principal,
  req: typeof approvalRequests.$inferSelect,
  approved: boolean,
  comment: string | null,
) => Promise<void>;

/** Called when a non-final step is approved and the request moves up the chain. */
export type StepHook = (
  tx: Tx,
  p: Principal,
  req: typeof approvalRequests.$inferSelect,
  nextStep: number,
  nextApproverId: string,
) => Promise<void>;

export interface EntityOptions {
  /** Approval levels up the reporting line (1 = reporting manager only); a function reads company settings. */
  levels?: number | ((tx: Tx, p: Principal) => Promise<number>);
  /** Extra permission the decider needs for this entity type (decide and the to_decide list). */
  permission?: Permission;
  /**
   * 'permission_holders': route to every active user of the company holding `permission` (not the
   * requester's manager). Any one of them decides; all of them see it (to_decide, GET, decide), even
   * outside their team. One holder: step 1 names them; several: step 1 approver is null (shared queue)
   * and payload.approverIds lists them. None: request() throws 422 NO_APPROVER.
   */
  route?: 'manager' | 'permission_holders';
  onStep?: StepHook;
  /** Runs before any approve (every step, every route); throw to block (e.g. DCR_NOT_APPROVED). */
  beforeApprove?: (
    tx: Tx,
    p: Principal,
    req: typeof approvalRequests.$inferSelect,
  ) => Promise<void>;
}

/** Full subject details for GET /v1/approvals/{id} (access is checked by the caller). */
export type DetailLoader = (
  tx: Tx,
  p: Principal,
  req: typeof approvalRequests.$inferSelect,
) => Promise<ApprovalSubject | null>;

export interface DetailOptions {
  /** In-line viewers (not requester, not an assigned approver) see details only with one of these. */
  readPermissions?: Permission[];
}

/** Final-approval notification for subjects without their own decision notification. */
const APPROVE_NOTICE: Partial<
  Record<EntityType, { type: NotificationType; entityType: 'tour_plan' | 'doctor' }>
> = {
  tour_plan: { type: 'tour_plan.approved', entityType: 'tour_plan' },
  doctor: { type: 'doctor.approved', entityType: 'doctor' },
};

/** Rejection notification for subjects without their own decision notification. */
const REJECT_NOTICE: Partial<
  Record<
    EntityType,
    { type: NotificationType; entityType: 'tour_plan' | 'doctor' | 'approval_request' }
  >
> = {
  tour_plan: { type: 'tour_plan.rejected', entityType: 'tour_plan' },
  doctor: { type: 'doctor.rejected', entityType: 'doctor' },
  dcr_correction: { type: 'dcr_unlock.rejected', entityType: 'approval_request' },
};

export interface ApprovalQuery {
  limit?: number;
  cursor?: string;
  sort?: string;
  includeTotal?: 'true' | 'false';
  status?: Approval['status'];
  subjectType?: Approval['subjectType'];
  mine?: 'to_decide' | 'requested';
}

/**
 * Approvals (#11, #26). One step: the requester's reporting manager (approver_user_id), but any manager
 * above the requester with approvals:decide may decide. Nobody decides their own request.
 * Multi-level (leave, expense): each approval moves to the current approver's manager until
 * `levels` is reached; it finishes early when there is no next manager (skipped ranks, e.g. a ZBM
 * reporting straight to the director) or when the decider already sits at or above the next approver.
 */
@Injectable()
export class ApprovalsService {
  private readonly hooks = new Map<string, DecisionHook>();
  private readonly options = new Map<string, EntityOptions>();
  private readonly details = new Map<string, { load: DetailLoader; opt: DetailOptions }>();
  constructor(
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {
    // DCR unlock/correction requests: director only (dcr_unlock:decide), Sharanya 2026-10-29.
    // Routed to the company's directors (dcr_unlock:decide holders), not the rep's manager (Phase B).
    this.options.set('dcr_correction', {
      permission: 'dcr_unlock:decide',
      route: 'permission_holders',
    });
    this.registerDetail('tour_plan', (tx, _p, req) => this.tourPlanDetail(tx, req.entityId));
    this.registerDetail('doctor', (tx, _p, req) => this.doctorDetail(tx, req), {
      readPermissions: ['masters:read'],
    });
    this.registerDetail('dcr_correction', async (_tx, _p, req) => ({
      type: 'dcr_unlock',
      date: typeof req.payload?.date === 'string' ? req.payload.date : null,
      reason: req.reason,
    }));
    // entity_id is a submission id (#86); requests made before #86 point at the plan itself.
    this.register('tour_plan', async (tx, p, req, approved, comment) => {
      const now = new Date();
      const decided = {
        status: approved ? ('approved' as const) : ('rejected' as const),
        decidedAt: now,
        decidedBy: p.userId,
        decisionComment: comment,
      };
      const [sub] = await tx
        .update(tourPlanSubmissions)
        .set(decided)
        .where(eq(tourPlanSubmissions.id, req.entityId))
        .returning({ planId: tourPlanSubmissions.tourPlanId });
      const planId = sub?.planId ?? req.entityId;
      const { status: _s, ...last } = decided;
      await tx
        .update(tourPlans)
        .set(sub ? last : decided)
        .where(eq(tourPlans.id, planId));
      if (sub) await syncStatus(tx, planId);
    });
  }

  register(entity: EntityType, hook: DecisionHook, options: EntityOptions = {}) {
    this.hooks.set(entity, hook);
    this.options.set(entity, { ...this.options.get(entity), ...options });
  }

  /** Entity types whose extra decide permission the caller lacks (never actionable for them). */
  private undecidable(p: Principal): EntityType[] {
    return [...this.options.entries()]
      .filter(([, o]) => o.permission && !p.permissions.includes(o.permission))
      .map(([k]) => k as EntityType);
  }

  registerDetail(entity: EntityType, load: DetailLoader, opt: DetailOptions = {}) {
    this.details.set(entity, { load, opt });
  }

  /**
   * GET /v1/approvals/{id}. Visible to the requester, any assigned approver (current or past step) and
   * the reporting line above the requester. `subject` (full details) only for the requester, an
   * assigned approver, or an in-line viewer holding the subject's read permission.
   */
  /** True when the caller is (or was) an approver on any approval request for this record. */
  async isAssigned(tx: Tx, p: Principal, entityType: EntityType, entityId: string) {
    const [hit] = await tx
      .select({ id: approvalSteps.id })
      .from(approvalSteps)
      .innerJoin(approvalRequests, eq(approvalRequests.id, approvalSteps.requestId))
      .where(
        and(
          eq(approvalRequests.entityType, entityType),
          eq(approvalRequests.entityId, entityId),
          or(eq(approvalSteps.approverUserId, p.userId), eq(approvalSteps.decidedBy, p.userId)),
        ),
      )
      .limit(1);
    return !!hit;
  }

  /**
   * Latest decided request per record: who requested it, who decided, the step comment. Used to put
   * rejection info on records that have no decision columns of their own (doctors).
   */
  async latestDecisions(tx: Tx, entityType: EntityType, ids: string[]) {
    const out = new Map<
      string,
      {
        requestedBy: string;
        status: string;
        comment: string | null;
        by: string | null;
        at: Date | null;
        approvers: string[];
      }
    >();
    if (!ids.length) return out;
    const reqs = await tx
      .select()
      .from(approvalRequests)
      .where(
        and(eq(approvalRequests.entityType, entityType), inArray(approvalRequests.entityId, ids)),
      )
      .orderBy(desc(approvalRequests.createdAt));
    const latest = reqs.filter((r, i) => reqs.findIndex((x) => x.entityId === r.entityId) === i);
    if (!latest.length) return out;
    const steps = await tx
      .select()
      .from(approvalSteps)
      .where(
        inArray(
          approvalSteps.requestId,
          latest.map((r) => r.id),
        ),
      )
      .orderBy(desc(approvalSteps.decidedAt));
    for (const r of latest) {
      const st = steps.filter((x) => x.requestId === r.id);
      const d = st.find((x) => x.decidedAt);
      out.set(r.entityId, {
        requestedBy: r.requestedBy,
        status: r.state,
        comment: d?.comment ?? null,
        by: d?.decidedBy ?? null,
        at: d?.decidedAt ?? null,
        approvers: st.flatMap((x) =>
          [x.approverUserId, x.decidedBy].filter((v): v is string => !!v),
        ),
      });
    }
    return out;
  }

  get(p: Principal, id: string): Promise<ApprovalDetail> {
    return this.tenant.run(p, async (tx) => {
      const [req] = await tx.select().from(approvalRequests).where(eq(approvalRequests.id, id));
      if (!req) throw new NotFoundException('Approval not found');
      const steps = await tx
        .select({ a: approvalSteps.approverUserId, d: approvalSteps.decidedBy })
        .from(approvalSteps)
        .where(eq(approvalSteps.requestId, id));
      const own = req.requestedBy === p.userId;
      const assigned =
        steps.some((s) => s.a === p.userId || s.d === p.userId) ||
        this.routedToMe(p).includes(req.entityType);
      const inLine = !p.teamUserIds || p.teamUserIds.includes(req.requestedBy);
      if (!own && !assigned && !inLine) throw new NotFoundException('Approval not found');
      const det = this.details.get(req.entityType);
      const may =
        own ||
        assigned ||
        (det?.opt.readPermissions ?? []).length === 0 ||
        (det?.opt.readPermissions ?? []).some((x) => p.permissions.includes(x));
      const subject = det && may ? await det.load(tx, p, req) : null;
      return { ...(await this.toDto(tx, [req], p))[0]!, subject };
    });
  }

  private async tourPlanDetail(tx: Tx, entityId: string): Promise<ApprovalSubject | null> {
    const [sub] = await tx
      .select({ planId: tourPlanSubmissions.tourPlanId })
      .from(tourPlanSubmissions)
      .where(eq(tourPlanSubmissions.id, entityId));
    const [row] = await tx
      .select()
      .from(tourPlans)
      .where(eq(tourPlans.id, sub?.planId ?? entityId));
    if (!row) return null;
    const full = (await plansOut(tx, [row]))[0]!;
    const submission = sub ? (full.submissions ?? []).find((x) => x.id === entityId)! : null;
    // Scoped to the submission's days (the whole plan for pre-#86 requests).
    const plan = submission
      ? { ...full, days: full.days.filter((d) => submission.dates.includes(d.date)) }
      : full;
    const entries = plan.days.flatMap((d) => d.entries);
    const ids = (f: (e: (typeof entries)[number]) => string[]) => [...new Set(entries.flatMap(f))];
    const wt = ids((e) => [e.workTypeId]);
    const tr = ids((e) => e.territoryIds);
    const ju = ids((e) => e.jointWorkUserIds ?? []);
    const dr = ids((e) => e.plannedDoctorIds ?? []);
    const ch = ids((e) => e.plannedChemistIds ?? []);
    const toMap = (rows: { id: string; name: string }[]) =>
      new Map(rows.map((r) => [r.id, r.name] as const));
    const pick = <T extends { id: string; name: string }>(q: Promise<T[]>, xs: string[]) =>
      xs.length ? q.then(toMap) : Promise.resolve(new Map<string, string>());
    const [wtN, trN, juN, chN] = await Promise.all([
      pick(
        tx
          .select({ id: workTypes.id, name: workTypes.name })
          .from(workTypes)
          .where(inArray(workTypes.id, wt)),
        wt,
      ),
      pick(
        tx
          .select({ id: territories.id, name: territories.name })
          .from(territories)
          .where(inArray(territories.id, tr)),
        tr,
      ),
      pick(
        tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ju)),
        ju,
      ),
      pick(
        tx
          .select({ id: chemists.id, name: chemists.name })
          .from(chemists)
          .where(inArray(chemists.id, ch)),
        ch,
      ),
    ]);
    const docs = dr.length
      ? await tx
          .select({
            id: doctors.id,
            name: doctors.name,
            specialtyName: specialties.name,
            categoryName: doctorCategories.name,
          })
          .from(doctors)
          .leftJoin(specialties, eq(specialties.id, doctors.specialtyId))
          .leftJoin(doctorCategories, eq(doctorCategories.id, doctors.categoryId))
          .where(inArray(doctors.id, dr))
      : [];
    const ref = (m: Map<string, string>, id: string) => ({ id, name: m.get(id) ?? '' });
    return {
      type: 'tour_plan',
      plan: full,
      submission,
      days: plan.days.map((d) => ({
        date: d.date,
        entries: d.entries.map((e) => ({
          session: e.session,
          workType: ref(wtN, e.workTypeId),
          territories: e.territoryIds.map((i) => ref(trN, i)),
          jointWorkUsers: (e.jointWorkUserIds ?? []).map((i) => ref(juN, i)),
          doctors: (e.plannedDoctorIds ?? []).map(
            (i) =>
              docs.find((x) => x.id === i) ?? {
                id: i,
                name: '',
                specialtyName: null,
                categoryName: null,
              },
          ),
          chemists: (e.plannedChemistIds ?? []).map((i) => ref(chN, i)),
          notes: e.notes ?? null,
        })),
      })),
    };
  }

  private async doctorDetail(
    tx: Tx,
    req: typeof approvalRequests.$inferSelect,
  ): Promise<ApprovalSubject | null> {
    const [d] = await tx
      .select({
        id: doctors.id,
        name: doctors.name,
        specialtyName: specialties.name,
        categoryName: doctorCategories.name,
        territoryId: doctors.territoryId,
        territoryName: territories.name,
        city: doctors.city,
        pincode: doctors.pincode,
        registrationNo: doctors.registrationNo,
        approvalStatus: doctors.approvalStatus,
      })
      .from(doctors)
      .leftJoin(specialties, eq(specialties.id, doctors.specialtyId))
      .leftJoin(doctorCategories, eq(doctorCategories.id, doctors.categoryId))
      .leftJoin(territories, eq(territories.id, doctors.territoryId))
      .where(eq(doctors.id, req.entityId));
    if (!d) return null;
    const dupIds = Array.isArray(req.payload?.possibleDuplicates)
      ? (req.payload.possibleDuplicates as unknown[]).filter(
          (x): x is string => typeof x === 'string',
        )
      : [];
    const dups = dupIds.length
      ? await tx
          .select({ id: doctors.id, name: doctors.name })
          .from(doctors)
          .where(inArray(doctors.id, dupIds))
      : [];
    return {
      type: 'doctor',
      doctor: {
        id: d.id,
        name: d.name,
        specialtyName: d.specialtyName ?? null,
        categoryName: d.categoryName ?? null,
        territory: d.territoryName ? { id: d.territoryId, name: d.territoryName } : null,
        city: d.city ?? null,
        pincode: d.pincode ?? null,
        registrationNo: d.registrationNo,
        approvalStatus: d.approvalStatus,
      },
      possibleDuplicates: dupIds.map((i) => ({
        id: i,
        name: dups.find((x) => x.id === i)?.name ?? '',
      })),
    };
  }

  /** Approver of the request's current step (null when unresolved, e.g. no manager). */
  async currentApprover(tx: Tx, requestId: string): Promise<string | null> {
    const [r] = await tx
      .select({ uid: approvalSteps.approverUserId })
      .from(approvalSteps)
      .innerJoin(approvalRequests, eq(approvalRequests.id, approvalSteps.requestId))
      .where(
        and(
          eq(approvalSteps.requestId, requestId),
          eq(approvalSteps.stepNo, approvalRequests.currentStep),
        ),
      )
      .orderBy(desc(approvalSteps.stepNo))
      .limit(1);
    return r?.uid ?? null;
  }

  /** Creates a pending request (cancelling an older pending one for the same subject). */
  async request(
    tx: Tx,
    p: Principal,
    entityType: EntityType,
    entityId: string,
    reason: string | null,
    payload?: Record<string, unknown>,
  ) {
    await tx
      .update(approvalRequests)
      .set({ state: 'cancelled' })
      .where(
        and(
          eq(approvalRequests.entityType, entityType),
          eq(approvalRequests.entityId, entityId),
          eq(approvalRequests.state, 'pending'),
        ),
      );
    const opt = this.options.get(entityType) ?? {};
    let approverUserId: string | null;
    let extra: Record<string, unknown> = {};
    if (opt.route === 'permission_holders' && opt.permission) {
      const route = routeToHolders(
        await this.permissionHolders(tx, opt.permission, p.userId),
        p.userId,
      );
      if (!route)
        throw err(
          422,
          'NO_APPROVER',
          `Nobody in your company can decide this (${opt.permission})`,
          {
            permission: opt.permission,
          },
        );
      approverUserId = route.approverUserId;
      extra = route.payload;
    } else {
      const [me] = await tx
        .select({ managerId: users.managerId })
        .from(users)
        .where(eq(users.id, p.userId));
      approverUserId = me?.managerId ?? null;
    }
    const id = uuidv7();
    await tx.insert(approvalRequests).values({
      id,
      companyId: p.companyId,
      entityType,
      entityId,
      requestedBy: p.userId,
      reason,
      payload: payload || Object.keys(extra).length ? { ...(payload ?? {}), ...extra } : null,
    });
    await tx.insert(approvalSteps).values({
      id: uuidv7(),
      companyId: p.companyId,
      requestId: id,
      stepNo: 1,
      approverUserId,
    });
    return id;
  }

  /** Active users of the tenant (RLS) holding `perm` through any role; never `exceptUserId`. */
  async permissionHolders(tx: Tx, perm: Permission, exceptUserId: string): Promise<string[]> {
    const rows = await tx.execute<{ id: string }>(sql`select distinct u.id, u.created_at
      from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id
      where u.deleted_at is null and u.status = 'active' and r.deleted_at is null
        and ${perm} = any(r.permissions) and u.id <> ${exceptUserId}
      order by u.created_at, u.id`);
    return rows.rows.map((r) => r.id);
  }

  async byId(tx: Tx, id: string): Promise<Approval> {
    const [r] = await tx.select().from(approvalRequests).where(eq(approvalRequests.id, id));
    return (await this.toDto(tx, [r!]))[0]!;
  }

  /** Entity types routed to permission holders that the caller holds (visible company-wide). */
  private routedToMe(p: Principal): EntityType[] {
    return [...this.options.entries()]
      .filter(
        ([, o]) =>
          o.route === 'permission_holders' && o.permission && p.permissions.includes(o.permission),
      )
      .map(([k]) => k as EntityType);
  }

  private visible(p: Principal): SQL | undefined {
    if (!p.teamUserIds) return undefined;
    const team = inArray(approvalRequests.requestedBy, p.teamUserIds);
    const routed = this.routedToMe(p);
    return routed.length ? or(team, inArray(approvalRequests.entityType, routed)) : team;
  }

  private async toDto(
    tx: Tx,
    rows: (typeof approvalRequests.$inferSelect)[],
    p?: Principal,
  ): Promise<Approval[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const steps = await tx
      .select()
      .from(approvalSteps)
      .where(inArray(approvalSteps.requestId, ids))
      .orderBy(asc(approvalSteps.stepNo));
    const names = await tx
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, [...new Set(rows.map((r) => r.requestedBy))]));
    // Approver warning: expense claims with lines on days whose DCR was rejected (0052 flag).
    const claimIds = rows.filter((r) => r.entityType === 'expense').map((r) => r.entityId);
    const flaggedClaims = new Set(
      claimIds.length
        ? (
            await tx
              .selectDistinct({ id: expenseLines.claimId })
              .from(expenseLines)
              .where(
                and(
                  inArray(expenseLines.claimId, claimIds),
                  isNull(expenseLines.deletedAt),
                  sql`${expenseLines.dcrRejectedAt} is not null`,
                ),
              )
          ).map((x) => x.id)
        : [],
    );
    return rows.map((r) => {
      const all = steps.filter((s) => s.requestId === r.id);
      const st = all.at(-1);
      const perm = this.options.get(r.entityType)?.permission;
      const canDecide =
        !!p &&
        r.state === 'pending' &&
        r.requestedBy !== p.userId &&
        p.permissions.includes('approvals:decide') &&
        (!perm || p.permissions.includes(perm)) &&
        (this.options.get(r.entityType)?.route === 'permission_holders' ||
          !st?.approverUserId ||
          !p.teamUserIds ||
          p.teamUserIds.includes(st.approverUserId)) &&
        !all.some((s) => s.stepNo < r.currentStep && s.decidedBy === p.userId);
      return {
        canDecide,
        id: r.id,
        companyId: r.companyId,
        subjectType: SUBJECT[r.entityType] ?? 'leave',
        subjectId: r.entityId,
        requestedBy: r.requestedBy,
        requestedByName: names.find((n) => n.id === r.requestedBy)?.name ?? '',
        approverId: st?.approverUserId ?? null,
        status: STATUS(r.state),
        summary:
          r.entityType === 'tour_plan' && typeof r.payload?.month === 'string'
            ? `Tour plan ${r.payload.month}`
            : r.entityType === 'dcr_correction' && typeof r.payload?.date === 'string'
              ? `DCR correction ${r.payload.date}`
              : r.entityType === 'expense' && typeof r.payload?.month === 'string'
                ? `Expense claim ${r.payload.month}`
                : r.entityType === 'leave' && typeof r.payload?.typeCode === 'string'
                  ? `Leave ${r.payload.typeCode} ${String(r.payload.fromDate)}..${String(r.payload.toDate)} (${String(r.payload.days)} d)`
                  : (r.reason ?? r.entityType),
        comment: st?.comment ?? null,
        createdAt: r.createdAt.toISOString(),
        decidedAt: st?.decidedAt?.toISOString() ?? null,
        decidedBy: st?.decidedBy ?? null,
        rejectionReason: STATUS(r.state) === 'rejected' ? (st?.comment ?? null) : null,
        ...(r.entityType === 'expense'
          ? {
              flags: flaggedClaims.has(r.entityId) ? (['dcr_rejected_lines'] as const).slice() : [],
            }
          : {}),
      };
    });
  }

  list(p: Principal, q: ApprovalQuery) {
    return this.tenant.run(p, async (tx) => {
      const canDecide = p.permissions.includes('approvals:decide');
      const state =
        q.status === 'pending' ? ['pending', 'draft'] : q.status ? [q.status] : undefined;
      const where = [
        this.visible(p),
        // Tour plan items have their own queue (GET /v1/tour-plans/items); not an Approval subject.
        ne(approvalRequests.entityType, 'tour_plan_item'),
        state ? inArray(approvalRequests.state, state as never[]) : undefined,
        q.subjectType
          ? eq(approvalRequests.entityType, ENTITY[q.subjectType] ?? ('none' as never))
          : undefined,
        q.mine === 'requested' ? eq(approvalRequests.requestedBy, p.userId) : undefined,
        q.mine === 'to_decide'
          ? canDecide
            ? and(
                eq(approvalRequests.state, 'pending'),
                ne(approvalRequests.requestedBy, p.userId),
                this.undecidable(p).length
                  ? notInArray(approvalRequests.entityType, this.undecidable(p))
                  : undefined,
              )
            : sql`false`
          : undefined,
      ].filter(Boolean) as SQL[];
      const sort = q.sort ?? '-createdAt';
      if (sort.replace(/^-/, '') !== 'createdAt')
        throw err(422, 'VALIDATION', `Unknown sort field ${sort}`);
      const dir = sort.startsWith('-') ? desc : asc;
      const limit = q.limit ?? 50;
      const offset = decodeCursor(q.cursor);
      const rows = await tx
        .select()
        .from(approvalRequests)
        .where(and(...where))
        .orderBy(dir(approvalRequests.createdAt), dir(approvalRequests.id))
        .limit(limit + 1)
        .offset(offset);
      const out: Record<string, unknown> = {
        items: await this.toDto(tx, rows.slice(0, limit), p),
        nextCursor: rows.length > limit ? encodeCursor(offset + limit) : null,
        serverTime: new Date().toISOString(),
      };
      if (q.includeTotal === 'true') {
        const [t] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(approvalRequests)
          .where(and(...where));
        out.total = t!.n;
      }
      return out;
    });
  }

  decide(p: Principal, id: string, b: z.infer<typeof ApprovalDecision>) {
    const comment = rejectionReason(b.decision, b.comment);
    return this.tenant.run(p, async (tx) => {
      const [req] = await tx
        .select()
        .from(approvalRequests)
        .where(and(eq(approvalRequests.id, id), this.visible(p)))
        .for('update');
      if (!req) throw new NotFoundException('Approval not found');
      if (req.requestedBy === p.userId)
        throw new ForbiddenException('You cannot decide your own request');
      if (req.state !== 'pending') throw err(409, 'CONFLICT', 'Already decided');
      const opt = this.options.get(req.entityType) ?? {};
      if (opt.permission && !p.permissions.includes(opt.permission))
        throw err(403, 'APPROVAL_PERMISSION_REQUIRED', `Missing permission: ${opt.permission}`, {
          permission: opt.permission,
        });
      const steps = await tx
        .select()
        .from(approvalSteps)
        .where(eq(approvalSteps.requestId, id))
        .orderBy(asc(approvalSteps.stepNo));
      const cur = steps.find((s) => s.stepNo === req.currentStep);
      // The current step's approver or anyone above them; never someone who decided an earlier step.
      if (
        opt.route !== 'permission_holders' &&
        cur?.approverUserId &&
        p.teamUserIds &&
        !p.teamUserIds.includes(cur.approverUserId)
      )
        throw err(403, 'APPROVAL_NOT_YOUR_STEP', 'Waiting for a higher approver');
      if (steps.some((s) => s.stepNo < req.currentStep && s.decidedBy === p.userId))
        throw err(403, 'APPROVAL_ALREADY_DECIDED_BY_YOU', 'You approved an earlier step');
      const approved = b.decision === 'approve';
      if (approved) await opt.beforeApprove?.(tx, p, req);
      const levels = typeof opt.levels === 'function' ? await opt.levels(tx, p) : (opt.levels ?? 1);
      if (approved && req.currentStep < levels && cur?.approverUserId) {
        const [up] = await tx
          .select({ managerId: users.managerId })
          .from(users)
          .where(eq(users.id, cur.approverUserId));
        // A decider above the current approver (their manager or higher, e.g. the director) who
        // approves early covers the next level too: finish here instead of queueing a step for
        // someone at or below the decider (no duplicate or stuck step with skipped ranks).
        const deciderCoversNext =
          !!up?.managerId &&
          p.userId !== cur.approverUserId &&
          (p.teamUserIds === null || p.teamUserIds.includes(up.managerId));
        if (up?.managerId && up.managerId !== req.requestedBy && !deciderCoversNext) {
          const next = req.currentStep + 1;
          await tx
            .update(approvalSteps)
            .set({ decision: 'approved', decidedBy: p.userId, decidedAt: new Date(), comment })
            .where(eq(approvalSteps.id, cur.id));
          await tx.insert(approvalSteps).values({
            id: uuidv7(),
            companyId: p.companyId,
            requestId: id,
            stepNo: next,
            approverUserId: up.managerId,
          });
          await tx
            .update(approvalRequests)
            .set({ currentStep: next })
            .where(eq(approvalRequests.id, id));
          await opt.onStep?.(tx, p, req, next, up.managerId);
          await this.audit.record(tx, p, 'approval.step_approved', {
            entityType: req.entityType,
            entityId: req.entityId,
            after: { requestId: id, step: req.currentStep, nextStep: next, comment },
          });
          const [fresh] = await tx
            .select()
            .from(approvalRequests)
            .where(eq(approvalRequests.id, id));
          return (await this.toDto(tx, [fresh!]))[0]!;
        }
      }
      await tx
        .update(approvalSteps)
        .set({
          decision: approved ? 'approved' : 'rejected',
          decidedBy: p.userId,
          decidedAt: new Date(),
          comment,
        })
        .where(and(eq(approvalSteps.requestId, id), eq(approvalSteps.stepNo, req.currentStep)));
      await tx
        .update(approvalRequests)
        .set({ state: approved ? 'approved' : 'rejected' })
        .where(eq(approvalRequests.id, id));
      await this.hooks.get(req.entityType)?.(tx, p, req, approved, comment);
      const [after] = await tx
        .select({ state: approvalRequests.state })
        .from(approvalRequests)
        .where(eq(approvalRequests.id, id));
      // Rejections notify at once; approvals only when the last step approves.
      const notice = approved
        ? after?.state === 'approved'
          ? APPROVE_NOTICE[req.entityType]
          : undefined
        : REJECT_NOTICE[req.entityType];
      if (notice)
        await this.notifications.notify(tx, p, {
          type: notice.type,
          recipientId: req.requestedBy,
          entityType: notice.entityType,
          entityId:
            notice.entityType === 'approval_request'
              ? req.id
              : typeof req.payload?.planId === 'string'
                ? req.payload.planId
                : req.entityId,
          dedupeKey: `${notice.type}:${req.id}`,
          data: {
            ...(req.payload ?? {}),
            approvalId: req.id,
            comment,
            ...(approved ? {} : { reason: comment }),
          },
        });
      await this.audit.record(tx, p, `approval.${b.decision}`, {
        entityType: req.entityType,
        entityId: req.entityId,
        after: { requestId: id, comment },
      });
      const [fresh] = await tx.select().from(approvalRequests).where(eq(approvalRequests.id, id));
      return (await this.toDto(tx, [fresh!]))[0]!;
    });
  }
}
