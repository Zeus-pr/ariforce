import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Approval, ApprovalDecision, Permission } from '@ariforce/contracts';
import type * as z from 'zod';
import { approvalRequests, approvalSteps, tourPlans, users, type Tx } from '@ariforce/db';
import { and, asc, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Principal } from '../auth/principal';
import { AuditService } from '../common/audit.service';
import { TenantService } from '../common/tenant.service';
import { err } from '../field/checkins.service';
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
  /** Approval levels up the reporting line (1 = reporting manager only). */
  levels?: number;
  /** Extra permission the decider needs for this entity type. */
  permission?: Permission;
  onStep?: StepHook;
}

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
  constructor(
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
  ) {
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
                : (r.reason ?? r.entityType),
        comment: st?.comment ?? null,
        createdAt: r.createdAt.toISOString(),
        decidedAt: st?.decidedAt?.toISOString() ?? null,
        decidedBy: st?.decidedBy ?? null,
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
      const comment = b.comment ?? null;
      const levels = opt.levels ?? 1;
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
