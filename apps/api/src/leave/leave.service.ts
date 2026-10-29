import { NotificationsService } from '../notifications/notifications.service';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import type {
  ApprovalSubject,
  LeaveApply,
  LeaveRequest,
  LeaveSettingsUpdate,
  LeaveStatus,
  LeaveTypeUpdate,
} from '@ariforce/contracts';
import { LEAVE_DEFAULT_BACKDATE_DAYS } from '@ariforce/contracts';
import {
  approvalRequests,
  leaveGrants,
  leavePolicies,
  leaveRequests,
  leaveSettings,
  users,
  type Tx,
} from '@ariforce/db';
import { and, asc, eq, gte, inArray, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type * as z from 'zod';
import type { Principal } from '../auth/principal';
import { AuditService } from '../common/audit.service';
import { TenantService } from '../common/tenant.service';
import { err } from '../field/checkins.service';
import { companySettings, localDate } from '../field/field.util';
import { ApprovalsService } from '../plans/approvals.service';
import { deciderId } from '../plans/auto-approve';
import { nameRejecters, rejectionFields } from '../common/rejection';
import { addDay, assertNoSubmittedDcr, countedDates } from './leave.util';
import { submittedReportSql } from '../dcr/day-report';

type ReqRow = typeof leaveRequests.$inferSelect;
type PolicyRow = typeof leavePolicies.$inferSelect;
type SettingsRow = typeof leaveSettings.$inferSelect;
type Decision = { decision: 'approve' | 'reject'; comment?: string };

/** Default policy rows (also inserted by migration 0023). Assumptions: docs/LEAVE.md. */
export const DEFAULT_LEAVE_POLICIES = [
  {
    code: 'CL',
    name: 'Casual leave',
    paid: true,
    quota: '12',
    cf: false,
    cap: null,
    grantOnly: false,
  },
  {
    code: 'SL',
    name: 'Sick leave',
    paid: true,
    quota: '12',
    cf: false,
    cap: null,
    grantOnly: false,
  },
  {
    code: 'EL',
    name: 'Earned leave',
    paid: true,
    quota: '15',
    cf: true,
    cap: '30',
    grantOnly: false,
  },
  {
    code: 'LOP',
    name: 'Loss of pay (unpaid)',
    paid: false,
    quota: null,
    cf: false,
    cap: null,
    grantOnly: false,
  },
  {
    code: 'COMP',
    name: 'Compensatory off',
    paid: true,
    quota: '0',
    cf: false,
    cap: null,
    grantOnly: true,
  },
] as const;

const n = (v: string | number | null | undefined) =>
  v === null || v === undefined ? 0 : Number(v);
const nn = (v: string | null) => (v === null ? null : Number(v));
const iso = (d: Date | null) => d?.toISOString() ?? null;
const r1 = (x: number) => Math.round(x * 10) / 10;
const ACTIVE: z.infer<typeof LeaveStatus>[] = ['pending', 'approved'];
const MAX_CALENDAR_DAYS = 92;

/**
 * Leave (#51). Apply = submit to the generic approval engine (entity `leave`) up the reporting line;
 * levels come from leave_settings. Approved leave feeds attendance, KPIs, TP and DCR blocking.
 */
@Injectable()
export class LeaveService implements OnModuleInit {
  constructor(
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.approvals.register(
      'leave',
      async (tx, p, req, approved, comment) => {
        // Final approval only (intermediate steps never reach this hook): refuse while a submitted
        // DCR sits on any leave date. Runs in the decision transaction; rolls the decision back.
        if (approved) {
          const [lr] = await tx
            .select({
              userId: leaveRequests.userId,
              fromDate: leaveRequests.fromDate,
              toDate: leaveRequests.toDate,
            })
            .from(leaveRequests)
            .where(and(eq(leaveRequests.id, req.entityId), eq(leaveRequests.status, 'pending')))
            .for('update');
          if (lr) await assertNoSubmittedDcr(tx, lr.userId, lr.fromDate, lr.toDate);
        }
        await tx
          .update(leaveRequests)
          .set({
            status: approved ? 'approved' : 'rejected',
            decidedAt: new Date(),
            decidedBy: deciderId(p),
            decisionComment: comment,
          })
          .where(and(eq(leaveRequests.id, req.entityId), eq(leaveRequests.status, 'pending')));
        await this.audit.record(tx, p, approved ? 'leave.approved' : 'leave.rejected', {
          entityType: 'leave_request',
          entityId: req.entityId,
          after: { comment, step: req.currentStep },
        });
        await this.notifications.notify(tx, p, {
          type: approved ? 'leave.approved' : 'leave.rejected',
          recipientId: req.requestedBy,
          entityType: 'leave_request',
          entityId: req.entityId,
          dedupeKey: `leave.decided:${req.id}`,
          data: { ...(req.payload ?? {}), comment, ...(approved ? {} : { reason: comment }) },
        });
      },
      {
        levels: async (tx) => (await this.settingsRow(tx)).approvalLevels,
        permission: 'leave:approve',
        onStep: async (tx, p, req, nextStep, nextApproverId) => {
          await this.audit.record(tx, p, 'leave.step_approved', {
            entityType: 'leave_request',
            entityId: req.entityId,
            after: { step: req.currentStep, nextStep, nextApproverId },
          });
          await this.notifications.notify(tx, p, {
            type: 'leave.submitted',
            recipientId: nextApproverId,
            entityType: 'leave_request',
            entityId: req.entityId,
            dedupeKey: `leave.submitted:${req.id}:${nextStep}`,
            data: { ...(req.payload ?? {}), step: nextStep },
          });
        },
      },
    );
    this.approvals.registerDetail('leave', (tx, _p, req) => this.approvalDetail(tx, req.entityId), {
      readPermissions: ['leave:approve'],
    });
  }

  /** Approver view (GET /v1/approvals/{id}): the request, its balance and peers off at the same time. */
  private async approvalDetail(tx: Tx, id: string): Promise<ApprovalSubject | null> {
    const [r] = await tx.select().from(leaveRequests).where(eq(leaveRequests.id, id));
    if (!r) return null;
    const request = (await this.dtos(tx, [r]))[0]!;
    const [pol] = await tx.select().from(leavePolicies).where(eq(leavePolicies.id, r.policyId));
    const item = pol ? (await this.balanceItems(tx, r.userId, r.year, [pol]))[0]! : null;
    // pending/approved days are already held in `available`
    const held = r.status === 'pending' || r.status === 'approved';
    const balance = item
      ? {
          item,
          availableBefore:
            item.available === null
              ? null
              : held
                ? r1(item.available + request.days)
                : item.available,
          availableAfter:
            item.available === null
              ? null
              : held
                ? item.available
                : r1(item.available - request.days),
        }
      : null;
    const [u] = await tx.select({ m: users.managerId }).from(users).where(eq(users.id, r.userId));
    const peers = u?.m
      ? await tx
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(and(eq(users.managerId, u.m), ne(users.id, r.userId), isNull(users.deletedAt)))
      : [];
    const ov = peers.length
      ? await tx
          .select()
          .from(leaveRequests)
          .where(
            and(
              inArray(
                leaveRequests.userId,
                peers.map((x) => x.id),
              ),
              isNull(leaveRequests.deletedAt),
              inArray(leaveRequests.status, ['pending', 'approved']),
              lte(leaveRequests.fromDate, r.toDate),
              gte(leaveRequests.toDate, r.fromDate),
            ),
          )
          .orderBy(asc(leaveRequests.fromDate))
      : [];
    const pols = ov.length
      ? await tx
          .select({ id: leavePolicies.id, code: leavePolicies.code })
          .from(leavePolicies)
          .where(inArray(leavePolicies.id, [...new Set(ov.map((o) => o.policyId))]))
      : [];
    return {
      type: 'leave',
      request,
      balance,
      overlaps: ov.map((o) => ({
        userId: o.userId,
        userName: peers.find((x) => x.id === o.userId)?.name ?? '',
        typeCode: pols.find((x) => x.id === o.policyId)?.code ?? '',
        fromDate: o.fromDate,
        toDate: o.toDate,
        status: o.status as 'pending' | 'approved',
      })),
    };
  }

  // ---- policy (data) ----

  /** Creates the company's default settings and policies if missing (new companies). */
  private async ensureDefaults(tx: Tx, companyId: string) {
    await tx
      .insert(leaveSettings)
      .values({ companyId, backdateDays: LEAVE_DEFAULT_BACKDATE_DAYS })
      .onConflictDoNothing();
    await tx
      .insert(leavePolicies)
      .values(
        DEFAULT_LEAVE_POLICIES.map((d, i) => ({
          companyId,
          code: d.code,
          name: d.name,
          paid: d.paid,
          annualQuota: d.quota,
          carryForward: d.cf,
          carryForwardCap: d.cap,
          grantOnly: d.grantOnly,
          sortOrder: i + 1,
        })),
      )
      .onConflictDoNothing();
  }

  private async settingsRow(tx: Tx, companyId?: string): Promise<SettingsRow> {
    const [s] = await tx.select().from(leaveSettings).where(isNull(leaveSettings.deletedAt));
    if (s) return s;
    const c =
      companyId ??
      (await tx.execute<{ id: string }>(sql`select app_company_id()::text as id`)).rows[0]!.id;
    await this.ensureDefaults(tx, c);
    const [again] = await tx.select().from(leaveSettings);
    return again!;
  }

  private async policyRows(tx: Tx, p: Principal): Promise<PolicyRow[]> {
    await this.settingsRow(tx, p.companyId);
    return tx
      .select()
      .from(leavePolicies)
      .where(isNull(leavePolicies.deletedAt))
      .orderBy(asc(leavePolicies.sortOrder), asc(leavePolicies.code));
  }

  private typeDto(r: PolicyRow) {
    return {
      code: r.code,
      name: r.name,
      paid: r.paid,
      annualQuota: nn(r.annualQuota),
      carryForward: r.carryForward,
      carryForwardCap: nn(r.carryForwardCap),
      halfDayAllowed: r.halfDayAllowed,
      grantOnly: r.grantOnly,
      active: r.active,
      sortOrder: r.sortOrder,
      version: r.version,
    };
  }

  private settingsDto(s: SettingsRow) {
    return {
      approvalLevels: s.approvalLevels,
      backdateDays: s.backdateDays,
      weeklyOffDays: s.weeklyOffDays,
      maxFutureDays: s.maxFutureDays,
      version: s.version,
    };
  }

  types(p: Principal) {
    return this.tenant.run(p, async (tx) => ({
      items: (await this.policyRows(tx, p)).map((r) => this.typeDto(r)),
    }));
  }

  putType(p: Principal, code: string, b: z.infer<typeof LeaveTypeUpdate>) {
    return this.tenant.run(p, async (tx) => {
      const cur = (await this.policyRows(tx, p)).find((r) => r.code === code);
      if (cur && b.version && b.version !== cur.version)
        throw err(409, 'VERSION_CONFLICT', 'Stale version', this.typeDto(cur));
      const v = {
        name: b.name,
        paid: b.paid,
        annualQuota: b.annualQuota === undefined ? undefined : (b.annualQuota?.toFixed(1) ?? null),
        carryForward: b.carryForward,
        carryForwardCap:
          b.carryForwardCap === undefined ? undefined : (b.carryForwardCap?.toFixed(1) ?? null),
        halfDayAllowed: b.halfDayAllowed,
        grantOnly: b.grantOnly,
        active: b.active,
        sortOrder: b.sortOrder,
      };
      let row: PolicyRow;
      if (cur) {
        [row] = (await tx
          .update(leavePolicies)
          .set(v)
          .where(eq(leavePolicies.id, cur.id))
          .returning()) as [PolicyRow];
      } else {
        if (!b.name) throw err(422, 'VALIDATION', 'name is required for a new leave type');
        [row] = (await tx
          .insert(leavePolicies)
          .values({ ...v, name: b.name, companyId: p.companyId, code })
          .returning()) as [PolicyRow];
      }
      await this.audit.record(tx, p, cur ? 'leave.type_updated' : 'leave.type_created', {
        entityType: 'leave_policy',
        entityId: row.id,
        before: cur ? this.typeDto(cur) : undefined,
        after: this.typeDto(row),
      });
      return this.typeDto(row);
    });
  }

  getSettings(p: Principal) {
    return this.tenant.run(p, async (tx) =>
      this.settingsDto(await this.settingsRow(tx, p.companyId)),
    );
  }

  putSettings(p: Principal, b: z.infer<typeof LeaveSettingsUpdate>) {
    return this.tenant.run(p, async (tx) => {
      const cur = await this.settingsRow(tx, p.companyId);
      if (b.version && b.version !== cur.version)
        throw err(409, 'VERSION_CONFLICT', 'Stale version', this.settingsDto(cur));
      const [row] = await tx
        .update(leaveSettings)
        .set({
          approvalLevels: b.approvalLevels,
          backdateDays: b.backdateDays,
          weeklyOffDays: b.weeklyOffDays ? [...new Set(b.weeklyOffDays)].sort() : undefined,
          maxFutureDays: b.maxFutureDays,
        })
        .where(eq(leaveSettings.id, cur.id))
        .returning();
      await this.audit.record(tx, p, 'leave.settings_updated', {
        entityType: 'leave_settings',
        entityId: cur.id,
        before: this.settingsDto(cur),
        after: this.settingsDto(row!),
      });
      return this.settingsDto(row!);
    });
  }

  // ---- visibility ----

  /** Manager over the user (leave:approve and the user in your subtree), never yourself. */
  private managesUser(p: Principal, userId: string) {
    return (
      userId !== p.userId &&
      p.permissions.includes('leave:approve') &&
      (p.teamUserIds === null || p.teamUserIds.includes(userId))
    );
  }

  private readable(p: Principal): SQL {
    const parts: SQL[] = [];
    if (p.permissions.includes('leave:read')) parts.push(eq(leaveRequests.userId, p.userId));
    if (p.permissions.includes('leave:approve'))
      parts.push(p.teamUserIds ? inArray(leaveRequests.userId, p.teamUserIds) : sql`true`);
    return parts.length ? or(...parts)! : sql`false`;
  }

  private async row(tx: Tx, p: Principal, id: string, lock = false): Promise<ReqRow> {
    const q = tx
      .select()
      .from(leaveRequests)
      .where(and(eq(leaveRequests.id, id), isNull(leaveRequests.deletedAt), this.readable(p)));
    const [r] = lock ? await q.for('update') : await q;
    if (!r) throw new NotFoundException('Leave request not found');
    return r;
  }

  private async dtos(tx: Tx, rows: ReqRow[]): Promise<LeaveRequest[]> {
    return nameRejecters(tx, await this.dtosRaw(tx, rows));
  }

  private async dtosRaw(tx: Tx, rows: ReqRow[]): Promise<LeaveRequest[]> {
    if (!rows.length) return [];
    const pol = await tx
      .select()
      .from(leavePolicies)
      .where(inArray(leavePolicies.id, [...new Set(rows.map((r) => r.policyId))]));
    const names = await tx
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, [...new Set(rows.map((r) => r.userId))]));
    const reqIds = rows.map((r) => r.approvalRequestId).filter(Boolean) as string[];
    const steps = reqIds.length
      ? await tx
          .select({ id: approvalRequests.id, step: approvalRequests.currentStep })
          .from(approvalRequests)
          .where(inArray(approvalRequests.id, reqIds))
      : [];
    return rows.map((r) => {
      const t = pol.find((x) => x.id === r.policyId)!;
      return {
        id: r.id,
        userId: r.userId,
        userName: names.find((x) => x.id === r.userId)?.name ?? '',
        typeCode: t.code,
        typeName: t.name,
        paid: t.paid,
        year: r.year,
        fromDate: r.fromDate,
        toDate: r.toDate,
        half: r.half,
        days: Number(r.days),
        reason: r.reason,
        status: r.status,
        approvalId: r.approvalRequestId,
        approvalStep:
          r.status === 'pending'
            ? (steps.find((s) => s.id === r.approvalRequestId)?.step ?? null)
            : null,
        createdAt: r.createdAt.toISOString(),
        decidedAt: iso(r.decidedAt),
        decidedBy: r.decidedBy,
        decisionComment: r.decisionComment,
        ...rejectionFields(r.status, r.decisionComment, r.decidedBy, iso(r.decidedAt)),
        cancelledAt: iso(r.cancelledAt),
        cancelledBy: r.cancelledBy,
        cancelReason: r.cancelReason,
        version: r.version,
      };
    });
  }

  private async one(tx: Tx, p: Principal, id: string) {
    return (await this.dtos(tx, [await this.row(tx, p, id)]))[0]!;
  }

  // ---- requests ----

  list(
    p: Principal,
    q: {
      userId?: string;
      status?: z.infer<typeof LeaveStatus>;
      year?: number;
      from?: string;
      to?: string;
      mine?: 'true' | 'false';
    },
  ) {
    return this.tenant.run(p, async (tx) => {
      const rows = await tx
        .select()
        .from(leaveRequests)
        .where(
          and(
            this.readable(p),
            isNull(leaveRequests.deletedAt),
            q.mine === 'true' ? eq(leaveRequests.userId, p.userId) : undefined,
            q.userId ? eq(leaveRequests.userId, q.userId) : undefined,
            q.status ? eq(leaveRequests.status, q.status) : undefined,
            q.year ? eq(leaveRequests.year, q.year) : undefined,
            q.from ? gte(leaveRequests.toDate, q.from) : undefined,
            q.to ? lte(leaveRequests.fromDate, q.to) : undefined,
          ),
        )
        .orderBy(sql`${leaveRequests.fromDate} desc`, asc(leaveRequests.id))
        .limit(500);
      return { items: await this.dtos(tx, rows) };
    });
  }

  get(p: Principal, id: string) {
    return this.tenant.run(p, (tx) => this.one(tx, p, id));
  }

  apply(p: Principal, b: LeaveApply) {
    return this.tenant.run(p, async (tx) => {
      // One apply at a time per user, so overlap and balance checks cannot race.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('leave:' || ${p.userId}))`);
      const s = await this.settingsRow(tx, p.companyId);
      const pol = (await this.policyRows(tx, p)).find((r) => r.code === b.typeCode && r.active);
      if (!pol)
        throw err(422, 'LEAVE_TYPE_UNKNOWN', `Unknown or inactive leave type ${b.typeCode}`, {
          field: 'typeCode',
        });
      if (b.half && !pol.halfDayAllowed)
        throw err(422, 'LEAVE_HALF_DAY_NOT_ALLOWED', `${pol.code} cannot be taken as a half day`);
      const year = Number(b.fromDate.slice(0, 4));
      if (Number(b.toDate.slice(0, 4)) !== year)
        throw err(422, 'LEAVE_SPANS_YEARS', 'Split leave that crosses 31 Dec into two requests');
      const tz = (await companySettings(tx, p)).timezone;
      const today = localDate(new Date(), tz);
      const earliest = addDay(today, -s.backdateDays);
      if (b.fromDate < earliest)
        throw err(
          422,
          'LEAVE_BACKDATE_WINDOW',
          `Leave may start at most ${s.backdateDays} day(s) back`,
          {
            earliest,
          },
        );
      const latest =
        s.maxFutureDays === null ? `${today.slice(0, 4)}-12-31` : addDay(today, s.maxFutureDays);
      if (b.fromDate > latest)
        throw err(422, 'LEAVE_TOO_FAR_AHEAD', `Leave may start at most on ${latest}`, { latest });
      if (b.toDate > addDay(b.fromDate, 366))
        throw err(422, 'VALIDATION', 'Leave range is too long');
      const dates = countedDates(b.fromDate, b.toDate, s.weeklyOffDays);
      if (!dates.length)
        throw err(422, 'LEAVE_NO_WORKING_DAYS', 'All selected dates are weekly offs');
      const days = b.half ? 0.5 : dates.length;

      const overlap = await tx
        .select({ id: leaveRequests.id, half: leaveRequests.half, from: leaveRequests.fromDate })
        .from(leaveRequests)
        .where(
          and(
            eq(leaveRequests.userId, p.userId),
            isNull(leaveRequests.deletedAt),
            inArray(leaveRequests.status, ACTIVE),
            lte(leaveRequests.fromDate, b.toDate),
            gte(leaveRequests.toDate, b.fromDate),
          ),
        );
      // Two half days on the same date are fine when they are different halves.
      const clash = overlap.filter((o) => !(b.half && o.half && o.half !== b.half));
      if (clash.length)
        throw err(409, 'LEAVE_OVERLAP', 'You already have leave on some of these dates', {
          requestIds: clash.map((c) => c.id),
        });
      if (!b.half) {
        const worked = await tx.execute<{ date: string }>(sql`
          select to_char(d.date, 'YYYY-MM-DD') as date from dcrs d join work_types w on w.id = d.work_type_id
          where d.user_id = ${p.userId} and ${submittedReportSql('d')}
            and w.kind in ('field', 'non_field')
            and d.date between ${b.fromDate}::date and ${b.toDate}::date order by 1`);
        const hit = worked.rows.map((r) => r.date).filter((d) => dates.includes(d));
        if (hit.length)
          throw err(
            409,
            'LEAVE_DCR_EXISTS',
            'A work DCR exists on these dates; delete or correct it first',
            {
              dates: hit,
            },
          );
      }
      const bal = (await this.balanceItems(tx, p.userId, year, [pol]))[0]!;
      if (bal.available !== null && bal.available < days)
        throw err(
          422,
          'LEAVE_INSUFFICIENT_BALANCE',
          `Only ${bal.available} day(s) of ${pol.code} left`,
          {
            available: bal.available,
            requested: days,
          },
        );

      const id = uuidv7();
      await tx.insert(leaveRequests).values({
        id,
        companyId: p.companyId,
        userId: p.userId,
        policyId: pol.id,
        year,
        fromDate: b.fromDate,
        toDate: b.toDate,
        half: b.half,
        days: days.toFixed(1),
        reason: b.reason,
      });
      const reqId = await this.approvals.request(tx, p, 'leave', id, b.reason, {
        typeCode: pol.code,
        fromDate: b.fromDate,
        toDate: b.toDate,
        days,
      });
      await tx
        .update(leaveRequests)
        .set({ approvalRequestId: reqId })
        .where(eq(leaveRequests.id, id));
      await this.audit.record(tx, p, 'leave.applied', {
        entityType: 'leave_request',
        entityId: id,
        after: {
          typeCode: pol.code,
          fromDate: b.fromDate,
          toDate: b.toDate,
          days,
          approvalId: reqId,
        },
      });
      // Director: approved now by the system (no manager).
      await this.approvals.autoApprove(tx, p, reqId);
      await this.notifications.notify(tx, p, {
        type: 'leave.submitted',
        recipientId: await this.approvals.currentApprover(tx, reqId),
        entityType: 'leave_request',
        entityId: id,
        dedupeKey: `leave.submitted:${reqId}:1`,
        data: { typeCode: pol.code, fromDate: b.fromDate, toDate: b.toDate, days, step: 1 },
      });
      return this.one(tx, p, id);
    });
  }

  async decide(p: Principal, id: string, b: Decision) {
    const reqId = await this.tenant.run(p, async (tx) => {
      const r = await this.row(tx, p, id);
      if (r.status !== 'pending' || !r.approvalRequestId)
        throw err(409, 'CONFLICT', `Leave is ${r.status}`);
      return r.approvalRequestId;
    });
    await this.approvals.decide(p, reqId, b);
    return this.get(p, id);
  }

  /**
   * Owner: pending any time, approved only before it starts. Manager over the owner (leave:approve):
   * pending or approved at any time. Days return to the balance (balances are computed).
   */
  cancel(p: Principal, id: string, reason: string | null) {
    return this.tenant.run(p, async (tx) => {
      const r = await this.row(tx, p, id, true);
      if (!ACTIVE.includes(r.status))
        throw err(409, 'LEAVE_NOT_CANCELLABLE', `Leave is ${r.status}`);
      const own = r.userId === p.userId;
      if (own) {
        const today = localDate(new Date(), (await companySettings(tx, p)).timezone);
        if (r.status === 'approved' && r.fromDate <= today)
          throw err(
            409,
            'LEAVE_NOT_CANCELLABLE',
            'Approved leave that has started can only be cancelled by your manager',
          );
      } else if (!this.managesUser(p, r.userId))
        throw new ForbiddenException('Only the owner or a manager above them can cancel');
      await tx
        .update(leaveRequests)
        .set({
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelledBy: p.userId,
          cancelReason: reason,
        })
        .where(eq(leaveRequests.id, r.id));
      if (r.approvalRequestId)
        await tx
          .update(approvalRequests)
          .set({ state: 'cancelled' })
          .where(
            and(
              eq(approvalRequests.id, r.approvalRequestId),
              eq(approvalRequests.state, 'pending'),
            ),
          );
      await this.audit.record(tx, p, 'leave.cancelled', {
        entityType: 'leave_request',
        entityId: r.id,
        before: { status: r.status },
        after: { reason, by: own ? 'owner' : 'manager' },
      });
      // Manager cancels -> owner. Owner cancels while pending -> the approver who had it queued.
      const recipientId = !own
        ? r.userId
        : r.status === 'pending' && r.approvalRequestId
          ? await this.approvals.currentApprover(tx, r.approvalRequestId)
          : null;
      await this.notifications.notify(tx, p, {
        type: 'leave.cancelled',
        recipientId,
        entityType: 'leave_request',
        entityId: r.id,
        dedupeKey: `leave.cancelled:${r.id}`,
        data: { fromDate: r.fromDate, toDate: r.toDate, reason },
      });
      return this.one(tx, p, r.id);
    });
  }

  // ---- balances ----

  private async balanceItems(tx: Tx, userId: string, year: number, pols: PolicyRow[]) {
    const grants = await tx
      .select({
        policyId: leaveGrants.policyId,
        kind: leaveGrants.kind,
        days: sql<string>`sum(${leaveGrants.days})`,
      })
      .from(leaveGrants)
      .where(
        and(
          eq(leaveGrants.userId, userId),
          eq(leaveGrants.year, year),
          isNull(leaveGrants.deletedAt),
        ),
      )
      .groupBy(leaveGrants.policyId, leaveGrants.kind);
    const reqs = await tx
      .select({
        policyId: leaveRequests.policyId,
        status: leaveRequests.status,
        days: sql<string>`sum(${leaveRequests.days})`,
      })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.userId, userId),
          eq(leaveRequests.year, year),
          isNull(leaveRequests.deletedAt),
          inArray(leaveRequests.status, ACTIVE),
        ),
      )
      .groupBy(leaveRequests.policyId, leaveRequests.status);
    const g = (pid: string, k: string) =>
      n(grants.find((x) => x.policyId === pid && x.kind === k)?.days);
    const rq = (pid: string, st: string) =>
      n(reqs.find((x) => x.policyId === pid && x.status === st)?.days);
    return pols.map((pol) => {
      const unlimited = pol.annualQuota === null && !pol.grantOnly;
      const carriedForward = g(pol.id, 'carry_forward');
      const opening = r1(g(pol.id, 'opening') + carriedForward);
      const quota = unlimited ? null : pol.grantOnly ? 0 : Number(pol.annualQuota);
      const granted = r1(g(pol.id, 'grant') + g(pol.id, 'adjustment'));
      const used = rq(pol.id, 'approved');
      const pending = rq(pol.id, 'pending');
      return {
        typeCode: pol.code,
        typeName: pol.name,
        paid: pol.paid,
        unlimited,
        opening,
        carriedForward,
        quota,
        granted,
        used,
        pending,
        available: unlimited ? null : r1(opening + (quota ?? 0) + granted - used - pending),
      };
    });
  }

  private assertCanSee(p: Principal, userId: string) {
    if (userId === p.userId) {
      if (!p.permissions.includes('leave:read'))
        throw new ForbiddenException('Missing permission: leave:read');
      return;
    }
    if (!this.managesUser(p, userId)) throw new NotFoundException('User not found');
  }

  balances(p: Principal, q: { userId?: string; year?: number }) {
    return this.tenant.run(p, async (tx) => {
      const userId = q.userId ?? p.userId;
      this.assertCanSee(p, userId);
      const year =
        q.year ??
        Number(localDate(new Date(), (await companySettings(tx, p)).timezone).slice(0, 4));
      const pols = (await this.policyRows(tx, p)).filter((r) => r.active);
      return { userId, year, items: await this.balanceItems(tx, userId, year, pols) };
    });
  }

  // ---- grants ----

  private grantDto(gr: typeof leaveGrants.$inferSelect, code: string) {
    return {
      id: gr.id,
      userId: gr.userId,
      typeCode: code,
      year: gr.year,
      kind: gr.kind,
      days: Number(gr.days),
      workedDate: gr.workedDate,
      reason: gr.reason,
      grantedBy: gr.grantedBy,
      createdAt: gr.createdAt.toISOString(),
    };
  }

  grant(
    p: Principal,
    b: {
      userId: string;
      typeCode: string;
      year: number;
      kind: 'opening' | 'grant' | 'adjustment';
      days: number;
      workedDate: string | null;
      reason: string;
    },
  ) {
    return this.tenant.run(p, async (tx) => {
      if (b.userId === p.userId)
        throw err(403, 'LEAVE_SELF_GRANT', 'You cannot grant leave to yourself');
      if (!this.managesUser(p, b.userId)) throw new NotFoundException('User not found');
      const pol = (await this.policyRows(tx, p)).find((r) => r.code === b.typeCode);
      if (!pol)
        throw err(422, 'LEAVE_TYPE_UNKNOWN', `Unknown leave type ${b.typeCode}`, {
          field: 'typeCode',
        });
      if (pol.annualQuota === null && !pol.grantOnly)
        throw err(422, 'VALIDATION', `${pol.code} is unlimited; grants do not apply`);
      const [gr] = await tx
        .insert(leaveGrants)
        .values({
          companyId: p.companyId,
          userId: b.userId,
          policyId: pol.id,
          year: b.year,
          kind: b.kind,
          days: b.days.toFixed(1),
          workedDate: b.workedDate,
          reason: b.reason,
          grantedBy: p.userId,
        })
        .returning();
      await this.audit.record(tx, p, 'leave.granted', {
        entityType: 'leave_grant',
        entityId: gr!.id,
        after: { userId: b.userId, typeCode: pol.code, year: b.year, kind: b.kind, days: b.days },
      });
      return this.grantDto(gr!, pol.code);
    });
  }

  grants(p: Principal, q: { userId?: string; year?: number }) {
    return this.tenant.run(p, async (tx) => {
      const userId = q.userId ?? p.userId;
      this.assertCanSee(p, userId);
      const rows = await tx
        .select({ g: leaveGrants, code: leavePolicies.code })
        .from(leaveGrants)
        .innerJoin(leavePolicies, eq(leavePolicies.id, leaveGrants.policyId))
        .where(
          and(
            eq(leaveGrants.userId, userId),
            isNull(leaveGrants.deletedAt),
            q.year ? eq(leaveGrants.year, q.year) : undefined,
          ),
        )
        .orderBy(asc(leaveGrants.year), asc(leaveGrants.createdAt));
      return { items: rows.map((r) => this.grantDto(r.g, r.code)) };
    });
  }

  /** Year-end: carries min(cap, available) of carry-forward types into next year. Re-runnable. */
  carryForward(p: Principal, fromYear: number) {
    return this.tenant.run(p, async (tx) => {
      const pols = (await this.policyRows(tx, p)).filter((r) => r.carryForward && r.active);
      const people = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(isNull(users.deletedAt), ne(users.status, 'rejected')));
      let written = 0;
      let total = 0;
      for (const u of people)
        for (const it of await this.balanceItems(tx, u.id, fromYear, pols)) {
          const pol = pols.find((x) => x.code === it.typeCode)!;
          const cap = pol.carryForwardCap === null ? Infinity : Number(pol.carryForwardCap);
          const days = r1(Math.max(0, Math.min(cap, it.available ?? 0)));
          const [cur] = await tx
            .select()
            .from(leaveGrants)
            .where(
              and(
                eq(leaveGrants.userId, u.id),
                eq(leaveGrants.policyId, pol.id),
                eq(leaveGrants.year, fromYear + 1),
                eq(leaveGrants.kind, 'carry_forward'),
                isNull(leaveGrants.deletedAt),
              ),
            );
          if (cur && Number(cur.days) === days) continue;
          if (cur)
            await tx
              .update(leaveGrants)
              .set(
                days > 0
                  ? { days: days.toFixed(1), grantedBy: p.userId }
                  : { deletedAt: new Date() },
              )
              .where(eq(leaveGrants.id, cur.id));
          else if (days > 0)
            await tx.insert(leaveGrants).values({
              companyId: p.companyId,
              userId: u.id,
              policyId: pol.id,
              year: fromYear + 1,
              kind: 'carry_forward',
              days: days.toFixed(1),
              reason: `Carry forward from ${fromYear}`,
              grantedBy: p.userId,
            });
          else continue;
          written++;
          total = r1(total + days);
        }
      await this.audit.record(tx, p, 'leave.carry_forward', {
        entityType: 'leave_policy',
        after: { fromYear, written, totalDays: total },
      });
      return { fromYear, toYear: fromYear + 1, written, totalDays: total };
    });
  }

  // ---- calendar ----

  calendar(
    p: Principal,
    q: { from: string; to: string; userId?: string; includePending?: 'true' | 'false' },
  ) {
    return this.tenant.run(p, async (tx) => {
      if (q.to < q.from) throw err(422, 'VALIDATION', 'to is before from');
      if (q.to > addDay(q.from, MAX_CALENDAR_DAYS - 1))
        throw err(422, 'VALIDATION', `Range is limited to ${MAX_CALENDAR_DAYS} days`);
      if (q.userId) this.assertCanSee(p, q.userId);
      const s = await this.settingsRow(tx, p.companyId);
      const team = p.permissions.includes('leave:approve') ? p.teamUserIds : [p.userId];
      const rows = await tx
        .select({ r: leaveRequests, code: leavePolicies.code, name: users.name })
        .from(leaveRequests)
        .innerJoin(leavePolicies, eq(leavePolicies.id, leaveRequests.policyId))
        .innerJoin(users, eq(users.id, leaveRequests.userId))
        .where(
          and(
            isNull(leaveRequests.deletedAt),
            inArray(leaveRequests.status, q.includePending === 'true' ? ACTIVE : ['approved']),
            lte(leaveRequests.fromDate, q.to),
            gte(leaveRequests.toDate, q.from),
            q.userId ? eq(leaveRequests.userId, q.userId) : undefined,
            team ? inArray(leaveRequests.userId, team) : undefined,
          ),
        )
        .orderBy(asc(users.name), asc(leaveRequests.fromDate));
      return {
        from: q.from,
        to: q.to,
        items: rows.map(({ r, code, name }) => ({
          requestId: r.id,
          userId: r.userId,
          userName: name,
          typeCode: code,
          status: r.status as 'pending' | 'approved',
          fromDate: r.fromDate,
          toDate: r.toDate,
          half: r.half,
          dates: countedDates(
            r.fromDate > q.from ? r.fromDate : q.from,
            r.toDate < q.to ? r.toDate : q.to,
            s.weeklyOffDays,
          ),
        })),
      };
    });
  }
}
