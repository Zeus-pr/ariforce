import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  dcrDetailsKind,
  istDate,
  type TourPlanItem,
  type TourPlanItemPlan,
  type TourPlanItemUpsert,
} from '@ariforce/contracts';
import {
  approvalRequests,
  sfcRoutes,
  territories,
  tourPlanItems,
  users,
  workTypes,
  type Tx,
} from '@ariforce/db';
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, type SQL } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Principal } from '../auth/principal';
import { AuditService } from '../common/audit.service';
import { TenantService } from '../common/tenant.service';
import { err } from '../field/checkins.service';
import { decodeCursor, encodeCursor } from '../masters/masters.service';
import { ApprovalsService } from './approvals.service';
import { dbStatus, itemsOut, type ItemRow } from './tp-items';

export interface TpItemQuery {
  mine?: 'true' | 'false';
  status?: TourPlanItem['status'];
  limit?: number;
  cursor?: string;
}
type Decision = { decision: 'approve' | 'reject'; comment?: string };

/**
 * Tour plan items (TP feature, 0050). Owner: create/edit while draft or rejected, submit (one
 * approval request, entity_type 'tour_plan_item', routed to the reporting manager), delete while
 * draft or rejected. Deciders: the shared approvals engine (approvals:decide, reporting line,
 * never your own request).
 */
@Injectable()
export class TourPlanItemsService {
  constructor(
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
  ) {
    approvals.register('tour_plan_item', async (tx, p, req, approved, comment) => {
      await tx
        .update(tourPlanItems)
        .set({
          status: approved ? 'approved' : 'rejected',
          decidedAt: new Date(),
          decidedBy: p.userId,
          decisionComment: comment,
        })
        .where(eq(tourPlanItems.id, req.entityId));
    });
  }

  private canSeeTeam(p: Principal) {
    return p.permissions.includes('approvals:decide') || p.permissions.includes('field:read');
  }

  private inTeam(p: Principal, userId: string) {
    return !p.teamUserIds || p.teamUserIds.includes(userId);
  }

  private async row(tx: Tx, p: Principal, id: string, lock = false): Promise<ItemRow> {
    const q = tx
      .select()
      .from(tourPlanItems)
      .where(and(eq(tourPlanItems.id, id), isNull(tourPlanItems.deletedAt)));
    const [r] = lock ? await q.for('update') : await q;
    if (!r || (r.userId !== p.userId && !(this.canSeeTeam(p) && this.inTeam(p, r.userId))))
      throw new NotFoundException('Tour plan not found');
    return r;
  }

  private own(p: Principal, r: ItemRow) {
    if (r.userId !== p.userId)
      throw new ForbiddenException('Only the owner can change a tour plan');
  }

  private editable(r: ItemRow) {
    if (r.status !== 'draft' && r.status !== 'rejected')
      throw err(409, 'TP_LOCKED', 'Only a draft or rejected tour plan can be changed', {
        status: r.status === 'submitted' ? 'pending' : r.status,
      });
  }

  /** Light checks; the DCR submit re-checks everything (bands, SFC per HQ, calls). */
  private async validatePlan(tx: Tx, p: Principal, plan: TourPlanItemPlan) {
    const [wt] = await tx
      .select()
      .from(workTypes)
      .where(and(eq(workTypes.id, plan.workTypeId), isNull(workTypes.deletedAt)));
    if (!wt || !wt.active)
      throw err(422, 'VALIDATION', 'Unknown or inactive work type', { field: 'plan.workTypeId' });
    if (wt.kind === 'leave' || wt.kind === 'holiday')
      throw err(422, 'VALIDATION', 'Plan leave through a leave request, not a tour plan', {
        field: 'plan.workTypeId',
      });
    const want = dcrDetailsKind(wt);
    if (plan.details && plan.details.kind !== want)
      throw err(
        422,
        'VALIDATION',
        want ? `details.kind must be '${want}'` : 'No details for this work type',
        { field: 'plan.details', expected: want },
      );
    const bad: Record<string, string[]> = {};
    const miss = (ids: string[], found: { id: string }[]) =>
      ids.filter((i) => !found.some((f) => f.id === i));
    const tt = [...new Set(plan.territoryIds)];
    if (tt.length) {
      const m = miss(
        tt,
        await tx
          .select({ id: territories.id })
          .from(territories)
          .where(
            and(
              inArray(territories.id, tt),
              isNull(territories.deletedAt),
              this.tenant.scope(p, territories.path),
            ),
          ),
      );
      if (m.length) bad['plan.territoryIds'] = m;
    }
    const ww = [...new Set(plan.workWithUserIds)].filter((u) => u !== p.userId);
    if (ww.length) {
      const m = miss(
        ww,
        await tx
          .select({ id: users.id })
          .from(users)
          .where(and(inArray(users.id, ww), isNull(users.deletedAt))),
      );
      if (m.length) bad['plan.workWithUserIds'] = m;
    }
    const rr = plan.sfcRoutes.map((r) => r.sfcRouteId);
    if (rr.length) {
      const found = await tx
        .select({ id: sfcRoutes.id, hq: sfcRoutes.hqTerritoryId })
        .from(sfcRoutes)
        .where(and(inArray(sfcRoutes.id, rr), isNull(sfcRoutes.deletedAt)));
      const m = plan.sfcRoutes
        .filter((c) => !found.some((f) => f.id === c.sfcRouteId && f.hq === c.hqTerritoryId))
        .map((c) => c.sfcRouteId);
      if (m.length) bad['plan.sfcRoutes'] = m;
    }
    if (Object.keys(bad).length)
      throw err(422, 'VALIDATION', 'Unknown or out-of-scope references', bad);
  }

  /** Own pending/approved items overlapping from..to (other than `exceptId`). */
  private async overlap(tx: Tx, userId: string, from: string, to: string, exceptId?: string) {
    const hits = await tx
      .select({ id: tourPlanItems.id, from: tourPlanItems.fromDate, to: tourPlanItems.toDate })
      .from(tourPlanItems)
      .where(
        and(
          eq(tourPlanItems.userId, userId),
          inArray(tourPlanItems.status, ['submitted', 'approved']),
          lte(tourPlanItems.fromDate, to),
          gte(tourPlanItems.toDate, from),
          isNull(tourPlanItems.deletedAt),
          exceptId ? ne(tourPlanItems.id, exceptId) : undefined,
        ),
      );
    if (hits.length)
      throw err(409, 'TP_OVERLAP', 'Overlaps a pending or approved tour plan', { items: hits });
  }

  list(p: Principal, q: TpItemQuery) {
    return this.tenant.run(p, async (tx) => {
      const mine = q.mine === 'true';
      if (!mine && !this.canSeeTeam(p))
        throw new ForbiddenException('approvals:decide or field:read required for team plans');
      const where = [
        isNull(tourPlanItems.deletedAt),
        mine ? eq(tourPlanItems.userId, p.userId) : ne(tourPlanItems.userId, p.userId),
        !mine && p.teamUserIds ? inArray(tourPlanItems.userId, p.teamUserIds) : undefined,
        q.status ? eq(tourPlanItems.status, dbStatus(q.status)) : undefined,
      ].filter(Boolean) as SQL[];
      const limit = q.limit ?? 50;
      const offset = decodeCursor(q.cursor);
      const rows = await tx
        .select()
        .from(tourPlanItems)
        .where(and(...where))
        .orderBy(
          ...(mine
            ? [desc(tourPlanItems.updatedAt), desc(tourPlanItems.id)]
            : [asc(tourPlanItems.fromDate), asc(tourPlanItems.id)]),
        )
        .limit(limit + 1)
        .offset(offset);
      return {
        items: await itemsOut(tx, rows.slice(0, limit)),
        nextCursor: rows.length > limit ? encodeCursor(offset + limit) : null,
        serverTime: new Date().toISOString(),
      };
    });
  }

  get(p: Principal, id: string) {
    return this.tenant.run(p, async (tx) => (await itemsOut(tx, [await this.row(tx, p, id)]))[0]!);
  }

  upsert(p: Principal, b: TourPlanItemUpsert) {
    return this.tenant.run(p, async (tx) => {
      await this.validatePlan(tx, p, b.plan);
      if (!b.id) {
        const id = uuidv7();
        await tx.insert(tourPlanItems).values({
          id,
          companyId: p.companyId,
          userId: p.userId,
          fromDate: b.from,
          toDate: b.to,
          status: 'draft',
          plan: b.plan,
        });
        await this.audit.record(tx, p, 'tour_plan_item.create', {
          entityType: 'tour_plan_item',
          entityId: id,
          after: { from: b.from, to: b.to },
        });
        return (await itemsOut(tx, [await this.row(tx, p, id)]))[0]!;
      }
      const cur = await this.row(tx, p, b.id, true);
      this.own(p, cur);
      this.editable(cur);
      if (b.version !== undefined && b.version !== cur.version)
        throw err(409, 'VERSION_CONFLICT', 'Tour plan changed since you read it', {
          version: cur.version,
        });
      await tx
        .update(tourPlanItems)
        .set({
          fromDate: b.from,
          toDate: b.to,
          plan: b.plan,
          status: 'draft',
          submittedAt: null,
          decidedAt: null,
          decidedBy: null,
          decisionComment: null,
        })
        .where(eq(tourPlanItems.id, cur.id));
      await this.audit.record(tx, p, 'tour_plan_item.update', {
        entityType: 'tour_plan_item',
        entityId: cur.id,
        after: { from: b.from, to: b.to },
      });
      return (await itemsOut(tx, [await this.row(tx, p, cur.id)]))[0]!;
    });
  }

  submit(p: Principal, id: string) {
    return this.tenant.run(p, async (tx) => {
      const cur = await this.row(tx, p, id, true);
      this.own(p, cur);
      this.editable(cur);
      if (cur.fromDate < istDate())
        throw err(422, 'TP_IN_PAST', 'A tour plan must start today or later', {
          field: 'from',
        });
      await this.validatePlan(tx, p, cur.plan as TourPlanItemPlan);
      await this.overlap(tx, p.userId, cur.fromDate, cur.toDate, cur.id);
      await tx
        .update(tourPlanItems)
        .set({
          status: 'submitted',
          submittedAt: new Date(),
          decidedAt: null,
          decidedBy: null,
          decisionComment: null,
        })
        .where(eq(tourPlanItems.id, cur.id));
      await this.approvals.request(tx, p, 'tour_plan_item', cur.id, null, {
        from: cur.fromDate,
        to: cur.toDate,
      });
      await this.audit.record(tx, p, 'tour_plan_item.submit', {
        entityType: 'tour_plan_item',
        entityId: cur.id,
      });
      return (await itemsOut(tx, [await this.row(tx, p, cur.id)]))[0]!;
    });
  }

  /** Decides the item's pending approval request through the shared engine. */
  async decide(p: Principal, id: string, b: Decision) {
    const reqId = await this.tenant.run(p, async (tx) => {
      const cur = await this.row(tx, p, id);
      if (cur.userId === p.userId)
        throw new ForbiddenException('You cannot decide your own tour plan');
      const [req] = await tx
        .select({ id: approvalRequests.id })
        .from(approvalRequests)
        .where(
          and(
            eq(approvalRequests.entityType, 'tour_plan_item'),
            eq(approvalRequests.entityId, id),
            eq(approvalRequests.state, 'pending'),
          ),
        )
        .orderBy(desc(approvalRequests.createdAt))
        .limit(1);
      if (cur.status !== 'submitted' || !req)
        throw err(409, 'CONFLICT', 'This tour plan is not waiting for approval');
      return req.id;
    });
    await this.approvals.decide(p, reqId, b);
    return this.get(p, id);
  }

  remove(p: Principal, id: string) {
    return this.tenant.run(p, async (tx) => {
      const cur = await this.row(tx, p, id, true);
      this.own(p, cur);
      this.editable(cur);
      await tx
        .update(tourPlanItems)
        .set({ deletedAt: new Date() })
        .where(eq(tourPlanItems.id, cur.id));
      await this.audit.record(tx, p, 'tour_plan_item.delete', {
        entityType: 'tour_plan_item',
        entityId: cur.id,
      });
    });
  }
}
