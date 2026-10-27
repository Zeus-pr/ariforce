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
  specialties,
  territories,
  tourPlans,
  users,
  workTypes,
  type Tx,
} from '@ariforce/db';
import { and, asc, desc, eq, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Principal } from '../auth/principal';
import { AuditService } from '../common/audit.service';
import { TenantService } from '../common/tenant.service';
import { err } from '../field/checkins.service';
import { NotificationsService } from '../notifications/notifications.service';
import { rejectionReason } from '../common/rejection';
import { toPlan } from './tour-plan.dto';
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
  /** Extra permission the decider needs for this entity type. */
  permission?: Permission;
  onStep?: StepHook;
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
    this.registerDetail('tour_plan', (tx, _p, req) => this.tourPlanDetail(tx, req.entityId));
    this.registerDetail('doctor', (tx, _p, req) => this.doctorDetail(tx, req), {
      readPermissions: ['masters:read'],
    });
    this.registerDetail('dcr_correction', async (_tx, _p, req) => ({
      type: 'dcr_unlock',
      date: typeof req.payload?.date === 'string' ? req.payload.date : null,
      reason: req.reason,
    }));
    this.register('tour_plan', async (tx, p, req, approved, comment) => {
      await tx
        .update(tourPlans)
        .set({
          status: approved ? 'approved' : 'rejected',
          decidedAt: new Date(),
          decidedBy: p.userId,
          decisionComment: comment,
        })
        .where(eq(tourPlans.id, req.entityId));
    });
  }

  register(entity: EntityType, hook: DecisionHook, options: EntityOptions = {}) {
    this.hooks.set(entity, hook);
    this.options.set(entity, options);
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
      const assigned = steps.some((s) => s.a === p.userId || s.d === p.userId);
      const inLine = !p.teamUserIds || p.teamUserIds.includes(req.requestedBy);
      if (!own && !assigned && !inLine) throw new NotFoundException('Approval not found');
      const det = this.details.get(req.entityType);
      const may =
        own ||
        assigned ||
        (det?.opt.readPermissions ?? []).length === 0 ||
        (det?.opt.readPermissions ?? []).some((x) => p.permissions.includes(x));
      const subject = det && may ? await det.load(tx, p, req) : null;
      return { ...(await this.toDto(tx, [req]))[0]!, subject };
    });
  }

  private async tourPlanDetail(tx: Tx, planId: string): Promise<ApprovalSubject | null> {
    const [row] = await tx.select().from(tourPlans).where(eq(tourPlans.id, planId));
    if (!row) return null;
    const plan = toPlan(row);
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
      plan,
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
    const [me] = await tx
      .select({ managerId: users.managerId })
      .from(users)
      .where(eq(users.id, p.userId));
    const id = uuidv7();
    await tx.insert(approvalRequests).values({
      id,
      companyId: p.companyId,
      entityType,
      entityId,
      requestedBy: p.userId,
      reason,
      payload: payload ?? null,
    });
    await tx.insert(approvalSteps).values({
      id: uuidv7(),
      companyId: p.companyId,
      requestId: id,
      stepNo: 1,
      approverUserId: me?.managerId ?? null,
    });
    return id;
  }

  async byId(tx: Tx, id: string): Promise<Approval> {
    const [r] = await tx.select().from(approvalRequests).where(eq(approvalRequests.id, id));
    return (await this.toDto(tx, [r!]))[0]!;
  }

  private visible(p: Principal): SQL | undefined {
    return p.teamUserIds ? inArray(approvalRequests.requestedBy, p.teamUserIds) : undefined;
  }

  private async toDto(tx: Tx, rows: (typeof approvalRequests.$inferSelect)[]): Promise<Approval[]> {
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
    return rows.map((r) => {
      const st = steps.filter((s) => s.requestId === r.id).at(-1);
      return {
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
        state ? inArray(approvalRequests.state, state as never[]) : undefined,
        q.subjectType
          ? eq(approvalRequests.entityType, ENTITY[q.subjectType] ?? ('none' as never))
          : undefined,
        q.mine === 'requested' ? eq(approvalRequests.requestedBy, p.userId) : undefined,
        q.mine === 'to_decide'
          ? canDecide
            ? and(eq(approvalRequests.state, 'pending'), ne(approvalRequests.requestedBy, p.userId))
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
        items: await this.toDto(tx, rows.slice(0, limit)),
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
        throw new ForbiddenException(`Missing permission: ${opt.permission}`);
      const steps = await tx
        .select()
        .from(approvalSteps)
        .where(eq(approvalSteps.requestId, id))
        .orderBy(asc(approvalSteps.stepNo));
      const cur = steps.find((s) => s.stepNo === req.currentStep);
      // The current step's approver or anyone above them; never someone who decided an earlier step.
      if (cur?.approverUserId && p.teamUserIds && !p.teamUserIds.includes(cur.approverUserId))
        throw err(403, 'APPROVAL_NOT_YOUR_STEP', 'Waiting for a higher approver');
      if (steps.some((s) => s.stepNo < req.currentStep && s.decidedBy === p.userId))
        throw err(403, 'APPROVAL_ALREADY_DECIDED_BY_YOU', 'You approved an earlier step');
      const approved = b.decision === 'approve';
      const levels = typeof opt.levels === 'function' ? await opt.levels(tx, p) : (opt.levels ?? 1);
      if (approved && req.currentStep < levels && cur?.approverUserId) {
        const [up] = await tx
          .select({ managerId: users.managerId })
          .from(users)
          .where(eq(users.id, cur.approverUserId));
        if (up?.managerId && up.managerId !== req.requestedBy) {
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
          entityId: notice.entityType === 'approval_request' ? req.id : req.entityId,
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
