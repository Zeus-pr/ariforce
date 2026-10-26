import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Approval, ApprovalDecision } from '@ariforce/contracts';
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

  register(entity: EntityType, hook: DecisionHook) {
    this.hooks.set(entity, hook);
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
      const approved = b.decision === 'approve';
      const comment = b.comment ?? null;
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
