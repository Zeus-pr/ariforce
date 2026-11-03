import { NotificationsService } from '../notifications/notifications.service';
import {
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_MAX_FILES_PER_LINE,
  type ExpenseCategory,
  type AllowanceDraftRequest,
  type ExpenseAttachmentCreate,
  type ExpenseClaim,
  type ExpenseDecision,
  type ExpenseLineInput,
  type ExpenseReconciliation,
  type ExpenseStatus,
  type ApprovalSubject,
} from '@ariforce/contracts';
import {
  dcrs,
  allowancePlaces,
  expenseAttachments,
  expenseClaims,
  expenseLines,
  tourPlans,
  users,
  userRoles,
  roles,
  approvalRequests,
  approvalSteps,
  workTypes,
  type Tx,
} from '@ariforce/db';
import { and, asc, eq, gte, inArray, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type * as z from 'zod';
import type { Principal } from '../auth/principal';
import { AuditService } from '../common/audit.service';
import { TenantService } from '../common/tenant.service';
import { err } from '../field/checkins.service';
import { StorageService } from '../files/storage.service';
import { ApprovalsService } from '../plans/approvals.service';
import { deciderId, isDirector } from '../plans/auto-approve';
import { nameRejecters, rejectionFields } from '../common/rejection';
import { keyExt, sniffMatches } from './files.util';
import { computeAllowances } from '../allowances/allowances.engine';
import { isDayReport } from '../dcr/day-report';
import { loadStatements } from './statement.data';
import { decodeCursor, encodeCursor } from '../masters/masters.service';

type ClaimRow = typeof expenseClaims.$inferSelect;
type LineRow = typeof expenseLines.$inferSelect;
type AttRow = typeof expenseAttachments.$inferSelect;
export type Decision = z.infer<typeof ExpenseDecision>;
export type Category = ExpenseCategory;

const EDITABLE = ['draft', 'rejected'];

/** Distinct, sorted dates of live lines flagged dcr_rejected_at (claim.dcrRejectedDates). */
export const rejectedDates = (ls: { date: string; dcrRejectedAt: Date | string | null }[]) =>
  [...new Set(ls.filter((l) => l.dcrRejectedAt).map((l) => l.date))].sort();
const FINANCE_VISIBLE: ExpenseStatus[] = ['approved', 'paid'];
const monthStart = (m: string) => `${m}-01`;
const nextMonth = (m: string) => {
  const [y, mm] = m.split('-').map(Number) as [number, number];
  return mm === 12 ? `${y + 1}-01-01` : `${y}-${String(mm + 1).padStart(2, '0')}-01`;
};
const num = (v: string | number | null) => (v === null ? null : Number(v));
const iso = (d: Date | null) => d?.toISOString() ?? null;
import { dcrApprovalGap, type DcrGap } from './dcr-gate';
import { buildTrail, primaryRole, type TrailUser } from './approval-trail';

type ExpenseTrailFields = Pick<
  ExpenseClaim,
  | 'approvalTrail'
  | 'totalLevels'
  | 'currentApprover'
  | 'canDecide'
  | 'canPay'
  | 'paidBy'
  | 'userRole'
>;

const r2 = (n: number) => Math.round(n * 100) / 100;
export const approvalLevels = () => Math.max(1, Number(process.env.EXPENSE_APPROVAL_LEVELS ?? 2));

/**
 * Expense claims (#52). One claim per user per month; edit while draft or rejected; submission goes
 * through the generic approval engine (entity `expense`) up the reporting line; expenses:pay holders
 * (director, system_admin) read approved/paid claims company-wide and mark them paid.
 */
@Injectable()
export class ExpensesService implements OnModuleInit {
  constructor(
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.approvals.register(
      'expense',
      async (tx, p, req, approved, comment) => {
        await tx
          .update(expenseClaims)
          .set({
            status: approved ? 'approved' : 'rejected',
            decidedAt: new Date(),
            decidedBy: deciderId(p),
            decisionComment: comment,
          })
          .where(and(eq(expenseClaims.id, req.entityId), eq(expenseClaims.status, 'submitted')));
        await this.audit.record(tx, p, approved ? 'expense.approved' : 'expense.rejected', {
          entityType: 'expense_claim',
          entityId: req.entityId,
          after: { comment, step: req.currentStep },
        });
        await this.notifications.notify(tx, p, {
          type: approved ? 'expense.approved' : 'expense.rejected',
          recipientId: req.requestedBy,
          entityType: 'expense_claim',
          entityId: req.entityId,
          dedupeKey: `expense.decided:${req.id}`,
          data: { ...(req.payload ?? {}), comment, ...(approved ? {} : { reason: comment }) },
        });
      },
      {
        levels: approvalLevels(),
        finalDirector: approvalLevels() >= 3,
        permission: 'expenses:approve',
        beforeApprove: (tx, _p, req) => this.assertDcrsApproved(tx, req.entityId),
        onBlocked: (p, req, e) => this.notifyBlocked(p, req.entityId, e),
        onStep: async (tx, p, req, nextStep, nextApproverId) => {
          await this.audit.record(tx, p, 'expense.step_approved', {
            entityType: 'expense_claim',
            entityId: req.entityId,
            after: { step: req.currentStep, nextStep, nextApproverId },
          });
          await this.notifications.notify(tx, p, {
            type: 'expense.submitted',
            recipientId: nextApproverId,
            entityType: 'expense_claim',
            entityId: req.entityId,
            dedupeKey: `expense.submitted:${req.id}:${nextStep}`,
            data: { ...(req.payload ?? {}), step: nextStep },
          });
        },
      },
    );
    this.approvals.registerDetail(
      'expense',
      (tx, p, req) => this.approvalDetail(tx, p, req.entityId),
      {
        readPermissions: ['expenses:approve', 'expenses:pay'],
      },
    );
  }

  /** Approver view (GET /v1/approvals/{id}): the claim, allowance places and receipt read URLs. */
  /** 409 DCR_NOT_APPROVED unless every line date of the claim has an approved DCR of its owner. */
  private async assertDcrsApproved(tx: Tx, claimId: string) {
    const [c] = await tx
      .select({ userId: expenseClaims.userId })
      .from(expenseClaims)
      .where(eq(expenseClaims.id, claimId));
    if (!c) return;
    const lines = await tx
      .select({ date: expenseLines.date })
      .from(expenseLines)
      .where(and(eq(expenseLines.claimId, claimId), isNull(expenseLines.deletedAt)));
    const dates = [...new Set(lines.map((l) => l.date))];
    if (!dates.length) return;
    const rows = await tx
      .select({ id: dcrs.id, date: dcrs.date, status: dcrs.status, updatedAt: dcrs.updatedAt })
      .from(dcrs)
      .where(and(eq(dcrs.userId, c.userId), inArray(dcrs.date, dates), isNull(dcrs.deletedAt)));
    const gap = dcrApprovalGap(dates, rows);
    if (gap)
      throw err(
        409,
        'DCR_NOT_APPROVED',
        'Every expense date needs an approved DCR before the claim can be approved',
        gap,
      );
  }

  private async approvalDetail(tx: Tx, p: Principal, id: string): Promise<ApprovalSubject | null> {
    const [c] = await tx.select().from(expenseClaims).where(eq(expenseClaims.id, id));
    if (!c) return null;
    const claim = await this.toDto(tx, c, p);
    const placeIds = [
      ...new Set(claim.lines.map((l) => l.allowancePlaceId).filter((x): x is string => !!x)),
    ];
    const places = placeIds.length
      ? await tx
          .select({
            id: allowancePlaces.id,
            name: allowancePlaces.name,
            band: allowancePlaces.band,
            oneWayKm: allowancePlaces.oneWayKm,
          })
          .from(allowancePlaces)
          .where(inArray(allowancePlaces.id, placeIds))
      : [];
    const attIds = claim.lines
      .flatMap((l) => l.attachments)
      .filter((a) => a.status === 'confirmed')
      .map((a) => a.id);
    const atts = attIds.length
      ? await tx.select().from(expenseAttachments).where(inArray(expenseAttachments.id, attIds))
      : [];
    const now = new Date();
    const receipts = [];
    for (const a of atts) {
      try {
        const u = await this.storage.downloadUrl(
          p.companyId,
          a.fileKey,
          now,
          `receipt-${a.id}.${a.fileKey.split('.').pop()}`,
        );
        receipts.push({ attachmentId: a.id, lineId: a.lineId, contentType: a.contentType, ...u });
        await this.audit.record(tx, p, 'expense.attachment_downloaded', {
          entityType: 'expense_attachment',
          entityId: a.id,
          after: { claimId: c.id, via: 'approval' },
        });
      } catch {
        // storage not configured or key outside the tenant: the claim still shows, without that receipt
      }
    }
    return {
      type: 'expense',
      claim,
      allowancePlaces: places.map((x) => ({ ...x, oneWayKm: Number(x.oneWayKm) })),
      receipts,
    };
  }

  // ---- visibility ----

  /** SQL filter for claims the caller may read. */
  private readable(p: Principal): SQL {
    const parts: SQL[] = [];
    if (p.permissions.includes('expenses:read')) parts.push(eq(expenseClaims.userId, p.userId));
    if (p.permissions.includes('expenses:approve'))
      parts.push(
        and(
          sql`${expenseClaims.status} <> 'draft'`,
          p.teamUserIds ? inArray(expenseClaims.userId, p.teamUserIds) : undefined,
        )!,
      );
    if (p.permissions.includes('expenses:pay'))
      parts.push(inArray(expenseClaims.status, FINANCE_VISIBLE));
    return parts.length ? or(...parts)! : sql`false`;
  }

  /**
   * GET /v1/expense-claims/{id} only (#128): the Director (company-wide, expenses:approve) may also
   * open any claim of the company, drafts included, i.e. everything the scope=team list shows.
   * Read-only: write/decide/pay paths keep using readable() alone, so nobody else changes.
   */
  private directorReadable(p: Principal): SQL {
    return p.roles.includes('director') &&
      p.teamUserIds === null &&
      p.permissions.includes('expenses:approve')
      ? or(this.readable(p), sql`true`)!
      : this.readable(p);
  }

  private async claimRow(
    tx: Tx,
    p: Principal,
    id: string,
    lock = false,
    directorRead = false,
  ): Promise<ClaimRow> {
    const q = tx
      .select()
      .from(expenseClaims)
      .where(
        and(
          eq(expenseClaims.id, id),
          isNull(expenseClaims.deletedAt),
          directorRead ? this.directorReadable(p) : this.readable(p),
        ),
      );
    const [c] = lock ? await q.for('update') : await q;
    if (!c) throw new NotFoundException('Expense claim not found');
    return c;
  }

  private async ownEditable(tx: Tx, p: Principal, id: string) {
    const c = await this.claimRow(tx, p, id, true);
    if (c.userId !== p.userId) throw new ForbiddenException('Only the owner can edit a claim');
    if (!EDITABLE.includes(c.status))
      throw err(
        409,
        'EXPENSE_NOT_EDITABLE',
        `Claim is ${c.status}; only draft or rejected can change`,
      );
    return c;
  }

  // ---- DTOs ----

  private async toDto(tx: Tx, c: ClaimRow, p: Principal): Promise<ExpenseClaim> {
    const lines = await tx
      .select()
      .from(expenseLines)
      .where(and(eq(expenseLines.claimId, c.id), isNull(expenseLines.deletedAt)))
      .orderBy(asc(expenseLines.date), asc(expenseLines.id));
    const atts = lines.length
      ? await tx
          .select()
          .from(expenseAttachments)
          .where(
            and(
              inArray(
                expenseAttachments.lineId,
                lines.map((l) => l.id),
              ),
              isNull(expenseAttachments.deletedAt),
            ),
          )
          .orderBy(asc(expenseAttachments.createdAt))
      : [];
    const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, c.userId));
    const step = c.approvalRequestId
      ? ((
          await tx.execute<{ s: number }>(
            sql`select current_step as s from approval_requests where id = ${c.approvalRequestId}`,
          )
        ).rows[0]?.s ?? null)
      : null;
    const [dto] = await nameRejecters(tx, [
      {
        ...this.summary(c, u?.name ?? ''),
        ...(await this.trails(tx, p, [c])).get(c.id)!,
        approvalStep: c.status === 'submitted' ? step : null,
        dcrRejectedDates: rejectedDates(lines),
        lines: lines.map((l) => this.lineDto(l, atts)),
      },
    ]);
    return dto!;
  }

  /**
   * approvalTrail / totalLevels / currentApprover / canDecide / canPay / paidBy for claims, batched:
   * one query each for requests, steps, users (+ one per projected manager level) and roles.
   */
  private async trails(tx: Tx, p: Principal, cs: ClaimRow[]) {
    const totalLevels = approvalLevels();
    const directorId = totalLevels >= 3 ? await this.approvals.directorId(tx) : null;
    const reqIds = [
      ...new Set(cs.flatMap((c) => (c.approvalRequestId ? [c.approvalRequestId] : []))),
    ];
    const reqs = reqIds.length
      ? await tx.select().from(approvalRequests).where(inArray(approvalRequests.id, reqIds))
      : [];
    const steps = reqIds.length
      ? await tx
          .select()
          .from(approvalSteps)
          .where(inArray(approvalSteps.requestId, reqIds))
          .orderBy(asc(approvalSteps.stepNo))
      : [];
    const um = new Map<string, TrailUser>();
    const load = async (ids: (string | null)[]) => {
      const want = [...new Set(ids.filter((x): x is string => !!x && !um.has(x)))];
      if (!want.length) return;
      const rows = await tx
        .select({ id: users.id, name: users.name, managerId: users.managerId })
        .from(users)
        .where(inArray(users.id, want));
      for (const r of rows) um.set(r.id, { name: r.name, managerId: r.managerId, role: null });
    };
    await load([
      ...steps.flatMap((s) => [s.approverUserId, s.decidedBy]),
      ...cs.map((c) => c.paidBy),
      ...cs.map((c) => c.userId),
      directorId,
    ]);
    // Project pending requests up the manager chain (one users query per missing level).
    let frontier = reqs
      .filter((r) => r.state === 'pending')
      .map((r) => steps.filter((s) => s.requestId === r.id).at(-1)?.approverUserId ?? null);
    for (let i = 0; i < totalLevels && frontier.some(Boolean); i++) {
      const next = frontier.map((id) => (id ? (um.get(id)?.managerId ?? null) : null));
      await load(next);
      frontier = next;
    }
    if (um.size) {
      const rr = await tx
        .select({ userId: userRoles.userId, key: roles.key })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(inArray(userRoles.userId, [...um.keys()]));
      for (const [id, u] of um)
        u.role = primaryRole(rr.filter((r) => r.userId === id).map((r) => r.key));
    }
    const out = new Map<string, ExpenseTrailFields>();
    for (const c of cs) {
      const req = reqs.find((r) => r.id === c.approvalRequestId) ?? null;
      const st = req ? steps.filter((s) => s.requestId === req.id) : [];
      const t = buildTrail(totalLevels, req, st, um, directorId);
      out.set(c.id, {
        ...t,
        totalLevels,
        canDecide:
          c.status === 'submitted' &&
          !!req &&
          p.permissions.includes('expenses:approve') &&
          this.approvals.canDecide(p, req, st),
        // Mirrors pay(): expenses:pay (route guard), approved, not your own claim.
        canPay:
          c.status === 'approved' &&
          c.userId !== p.userId &&
          p.permissions.includes('expenses:pay'),
        paidBy: c.paidBy ? { id: c.paidBy, name: um.get(c.paidBy)?.name ?? '' } : null,
        userRole: (um.get(c.userId)?.role ?? null) as ExpenseClaim['userRole'],
      });
    }
    return out;
  }

  private summary(c: ClaimRow, userName: string) {
    return {
      id: c.id,
      userId: c.userId,
      userName,
      month: c.month.slice(0, 7),
      status: c.status,
      total: Number(c.total),
      currency: 'INR' as const,
      approvalId: c.approvalRequestId,
      approvalStep: null as number | null,
      submittedAt: iso(c.submittedAt),
      decidedAt: iso(c.decidedAt),
      decidedBy: c.decidedBy,
      decisionComment: c.decisionComment,
      ...rejectionFields(c.status, c.decisionComment, c.decidedBy, iso(c.decidedAt)),
      paidAt: iso(c.paidAt),
      paymentRef: c.paymentRef,
      dcrRejectedDates: [] as string[],
      version: c.version,
    };
  }

  private lineDto(l: LineRow, atts: AttRow[]) {
    return {
      id: l.id,
      claimId: l.claimId,
      date: l.date,
      category: l.category,
      amount: Number(l.amount),
      notes: l.notes,
      mileageKm: num(l.mileageKm),
      dcrId: l.dcrId,
      tourPlanId: l.tourPlanId,
      source: l.source,
      origin: l.origin,
      allowancePlaceId: l.allowancePlaceId,
      autoTrigger: l.source === 'auto' ? (l.autoTrigger ?? null) : null,
      dcrRejectedAt: iso(l.dcrRejectedAt),
      attachments: atts.filter((a) => a.lineId === l.id).map((a) => this.attDto(a)),
      version: l.version,
    };
  }

  private attDto(a: AttRow) {
    return {
      id: a.id,
      lineId: a.lineId,
      contentType: a.contentType as never,
      sizeBytes: a.sizeBytes,
      status: a.status,
      createdAt: a.createdAt.toISOString(),
      confirmedAt: iso(a.confirmedAt),
    };
  }

  private async recomputeTotal(tx: Tx, claimId: string) {
    await tx.execute(sql`update expense_claims set total = coalesce((
      select sum(amount) from expense_lines where claim_id = ${claimId} and deleted_at is null), 0)
      where id = ${claimId}`);
  }

  // ---- claims ----

  /**
   * Without limit/cursor: every readable claim (unchanged). With either: one page of `limit`
   * (default 50, max 200) plus `limit`, `total` and `nextCursor` (opaque offset cursor).
   */
  list(
    p: Principal,
    q: {
      month?: string;
      userId?: string;
      status?: ExpenseStatus;
      scope?: 'team';
      limit?: number;
      cursor?: string;
    },
  ) {
    // scope=team (Director view): every claim of the reporting subtree in any status, drafts too;
    // Director (teamUserIds null) = whole company. Same paging/filters as the default list.
    if (q.scope === 'team' && !p.permissions.includes('expenses:approve'))
      throw new ForbiddenException('scope=team needs expenses:approve');
    const visible =
      q.scope === 'team'
        ? p.teamUserIds
          ? inArray(expenseClaims.userId, p.teamUserIds)
          : sql`true`
        : this.readable(p);
    const paged = q.limit !== undefined || q.cursor !== undefined;
    const limit = q.limit ?? 50;
    const offset = paged ? decodeCursor(q.cursor) : 0;
    return this.tenant.run(p, async (tx) => {
      const where = and(
        visible,
        isNull(expenseClaims.deletedAt),
        q.month ? eq(expenseClaims.month, monthStart(q.month)) : undefined,
        q.userId ? eq(expenseClaims.userId, q.userId) : undefined,
        q.status ? eq(expenseClaims.status, q.status) : undefined,
      );
      const base = tx
        .select({ c: expenseClaims, name: users.name })
        .from(expenseClaims)
        .innerJoin(users, eq(users.id, expenseClaims.userId))
        .where(where);
      // Paged reads add the id tie-break so pages never overlap or skip rows.
      const rows = paged
        ? await base
            .orderBy(sql`${expenseClaims.month} desc`, asc(users.name), asc(expenseClaims.id))
            .limit(limit)
            .offset(offset)
        : await base.orderBy(sql`${expenseClaims.month} desc`, asc(users.name));
      const total = paged
        ? ((
            await tx
              .select({ n: sql<number>`count(*)::int` })
              .from(expenseClaims)
              .innerJoin(users, eq(users.id, expenseClaims.userId))
              .where(where)
          )[0]?.n ?? 0)
        : 0;
      const counts = rows.length
        ? await tx
            .select({ id: expenseLines.claimId, n: sql<number>`count(*)::int` })
            .from(expenseLines)
            .where(
              and(
                inArray(
                  expenseLines.claimId,
                  rows.map((r) => r.c.id),
                ),
                isNull(expenseLines.deletedAt),
              ),
            )
            .groupBy(expenseLines.claimId)
        : [];
      const flagged = rows.length
        ? await tx
            .select({
              claimId: expenseLines.claimId,
              date: expenseLines.date,
              dcrRejectedAt: expenseLines.dcrRejectedAt,
            })
            .from(expenseLines)
            .where(
              and(
                inArray(
                  expenseLines.claimId,
                  rows.map((r) => r.c.id),
                ),
                isNull(expenseLines.deletedAt),
                sql`${expenseLines.dcrRejectedAt} is not null`,
              ),
            )
        : [];
      const trails = await this.trails(
        tx,
        p,
        rows.map((r) => r.c),
      );
      return {
        items: await nameRejecters(
          tx,
          rows.map((r) => ({
            ...this.summary(r.c, r.name),
            ...trails.get(r.c.id)!,
            dcrRejectedDates: rejectedDates(flagged.filter((x) => x.claimId === r.c.id)),
            lineCount: counts.find((x) => x.id === r.c.id)?.n ?? 0,
          })),
        ),
        ...(paged && {
          limit,
          total,
          nextCursor: offset + rows.length < total ? encodeCursor(offset + limit) : null,
        }),
      };
    });
  }

  get(p: Principal, id: string) {
    return this.tenant.run(p, async (tx) =>
      this.toDto(tx, await this.claimRow(tx, p, id, false, true), p),
    );
  }

  /** Creates your claim for the month, or returns the existing one (created = false). */
  create(p: Principal, month: string) {
    return this.tenant.run(p, async (tx) => {
      const today = new Date().toISOString().slice(0, 7);
      if (month > today) throw err(422, 'VALIDATION', 'Cannot claim for a future month');
      const [cur] = await tx
        .select()
        .from(expenseClaims)
        .where(and(eq(expenseClaims.userId, p.userId), eq(expenseClaims.month, monthStart(month))));
      if (cur) return { created: false, claim: await this.toDto(tx, cur, p) };
      const [c] = await tx
        .insert(expenseClaims)
        .values({
          id: uuidv7(),
          companyId: p.companyId,
          userId: p.userId,
          month: monthStart(month),
        })
        .returning();
      await this.audit.record(tx, p, 'expense.created', {
        entityType: 'expense_claim',
        entityId: c!.id,
        after: { month },
      });
      return { created: true, claim: await this.toDto(tx, c!, p) };
    });
  }

  private async checkLine(tx: Tx, p: Principal, c: ClaimRow, l: ExpenseLineInput) {
    const m = c.month.slice(0, 7);
    if (l.date.slice(0, 7) !== m)
      throw err(422, 'VALIDATION', `date must be in ${m}`, { field: 'date' });
    if (l.date > new Date().toISOString().slice(0, 10))
      throw err(422, 'VALIDATION', 'date cannot be in the future', { field: 'date' });
    if (l.dcrId) {
      const [d] = await tx
        .select({ date: dcrs.date })
        .from(dcrs)
        .where(
          and(
            eq(dcrs.id, l.dcrId),
            eq(dcrs.userId, p.userId),
            isNull(dcrs.deletedAt),
            ne(dcrs.status, 'rejected'),
          ),
        );
      if (!d) throw err(422, 'VALIDATION', 'dcrId must be your own DCR', { field: 'dcrId' });
      if (d.date !== l.date)
        throw err(422, 'VALIDATION', 'dcrId must be the DCR for the same date', { field: 'dcrId' });
    }
    if (l.tourPlanId) {
      const [t] = await tx
        .select({ month: tourPlans.month })
        .from(tourPlans)
        .where(and(eq(tourPlans.id, l.tourPlanId), eq(tourPlans.userId, p.userId)));
      if (!t || t.month !== c.month)
        throw err(422, 'VALIDATION', 'tourPlanId must be your tour plan for the month', {
          field: 'tourPlanId',
        });
    }
  }

  private lineValues(l: ExpenseLineInput) {
    return {
      date: l.date,
      category: l.category,
      amount: l.amount.toFixed(2),
      notes: l.notes,
      mileageKm: l.mileageKm === null ? null : l.mileageKm.toFixed(2),
      dcrId: l.dcrId,
      tourPlanId: l.tourPlanId,
    };
  }

  addLine(p: Principal, id: string, l: ExpenseLineInput) {
    return this.tenant.run(p, async (tx) => {
      const c = await this.ownEditable(tx, p, id);
      await this.checkLine(tx, p, c, l);
      const lineId = uuidv7();
      await tx
        .insert(expenseLines)
        .values({ id: lineId, companyId: p.companyId, claimId: c.id, ...this.lineValues(l) });
      await this.recomputeTotal(tx, c.id);
      await this.audit.record(tx, p, 'expense.line_added', {
        entityType: 'expense_claim',
        entityId: c.id,
        after: { lineId, category: l.category, amount: l.amount, date: l.date },
      });
      return this.toDto(tx, (await this.claimRow(tx, p, c.id))!, p);
    });
  }

  private async lineRow(tx: Tx, claimId: string, lineId: string) {
    const [l] = await tx
      .select()
      .from(expenseLines)
      .where(
        and(
          eq(expenseLines.id, lineId),
          eq(expenseLines.claimId, claimId),
          isNull(expenseLines.deletedAt),
        ),
      )
      .for('update');
    if (!l) throw new NotFoundException('Expense line not found');
    return l;
  }

  /** Lines copied from a DCR are edited on the DCR (resubmit replaces them), never here. */
  private notDcrLine(l: LineRow) {
    if (l.origin === 'dcr')
      throw err(
        409,
        'EXPENSE_NOT_EDITABLE',
        'This line comes from your DCR; change the DCR expenses',
        {
          reason: 'DCR_LINE',
          dcrId: l.dcrId,
        },
      );
  }

  updateLine(p: Principal, id: string, lineId: string, l: ExpenseLineInput, version: number) {
    return this.tenant.run(p, async (tx) => {
      const c = await this.ownEditable(tx, p, id);
      const cur = await this.lineRow(tx, c.id, lineId);
      this.notDcrLine(cur);
      if (cur.version !== version)
        throw err(409, 'VERSION_CONFLICT', 'Stale version', this.lineDto(cur, []));
      await this.checkLine(tx, p, c, l);
      await tx
        .update(expenseLines)
        .set({ ...this.lineValues(l), source: 'manual', autoTrigger: null, origin: 'manual' })
        .where(eq(expenseLines.id, lineId));
      await this.recomputeTotal(tx, c.id);
      await this.audit.record(tx, p, 'expense.line_updated', {
        entityType: 'expense_claim',
        entityId: c.id,
        before: { lineId, amount: Number(cur.amount), category: cur.category, date: cur.date },
        after: { lineId, amount: l.amount, category: l.category, date: l.date },
      });
      return this.toDto(tx, await this.claimRow(tx, p, c.id), p);
    });
  }

  deleteLine(p: Principal, id: string, lineId: string) {
    return this.tenant.run(p, async (tx) => {
      const c = await this.ownEditable(tx, p, id);
      this.notDcrLine(await this.lineRow(tx, c.id, lineId));
      const now = new Date();
      await tx.update(expenseLines).set({ deletedAt: now }).where(eq(expenseLines.id, lineId));
      await tx
        .update(expenseAttachments)
        .set({ deletedAt: now })
        .where(and(eq(expenseAttachments.lineId, lineId), isNull(expenseAttachments.deletedAt)));
      await this.recomputeTotal(tx, c.id);
      await this.audit.record(tx, p, 'expense.line_deleted', {
        entityType: 'expense_claim',
        entityId: c.id,
        after: { lineId },
      });
      return this.toDto(tx, await this.claimRow(tx, p, c.id), p);
    });
  }

  /** TA/DA auto-draft (#39): replaces this claim's auto lines from the rep's DCRs. */
  draftAllowances(p: Principal, id: string, req: AllowanceDraftRequest) {
    return this.tenant.run(p, async (tx) => {
      const c = await this.ownEditable(tx, p, id);
      const today = new Date().toISOString().slice(0, 10);
      const r = await computeAllowances(tx, c, req, today);
      if (req.dryRun) return { dryRun: true, days: r.days, totals: r.totals, claim: null };
      const now = new Date();
      await tx
        .update(expenseLines)
        .set({ deletedAt: now })
        .where(
          and(
            eq(expenseLines.claimId, c.id),
            eq(expenseLines.source, 'auto'),
            ne(expenseLines.origin, 'dcr'),
            isNull(expenseLines.deletedAt),
          ),
        );
      if (r.lines.length)
        await tx.insert(expenseLines).values(
          r.lines.map((l) => ({
            id: uuidv7(),
            companyId: p.companyId,
            claimId: c.id,
            date: l.date,
            category: l.category,
            amount: l.amount.toFixed(2),
            notes: l.notes,
            mileageKm: l.mileageKm === null ? null : l.mileageKm.toFixed(2),
            dcrId: l.dcrId,
            source: 'auto' as const,
            autoTrigger: 'allowances_run' as const,
            origin: 'ta_da' as const,
            calc: l.calc,
            allowancePlaceId: l.placeId,
          })),
        );
      await this.recomputeTotal(tx, c.id);
      await this.audit.record(tx, p, 'expense.allowances_drafted', {
        entityType: 'expense_claim',
        entityId: c.id,
        after: { ...r.totals, days: r.days.length },
      });
      return {
        dryRun: false,
        days: r.days,
        totals: r.totals,
        claim: await this.toDto(tx, await this.claimRow(tx, p, c.id), p),
      };
    });
  }

  /**
   * expense.blocked ('DCRs waiting for you') after a DCR_NOT_APPROVED gate failure (approve, or a
   * director's auto-approved submit). The whole action rolled back, so this runs in its own
   * transaction, best effort. To the claimant's dcr:review chain (who can approve the DCRs), not the
   * actor; a director claimant has no chain, so nobody (the director sees the 409 inline).
   */
  async notifyBlocked(p: Principal, claimId: string, e: unknown) {
    const r =
      e instanceof HttpException ? (e.getResponse() as { code?: string; details?: unknown }) : null;
    if (r?.code !== 'DCR_NOT_APPROVED') return;
    const gap = (r.details ?? {}) as Partial<DcrGap>;
    await this.notifications.afterRollback(p, async (tx) => {
      const [c] = await tx
        .select({ userId: expenseClaims.userId, month: expenseClaims.month, name: users.name })
        .from(expenseClaims)
        .innerJoin(users, eq(users.id, expenseClaims.userId))
        .where(eq(expenseClaims.id, claimId));
      if (!c) return;
      const reviewers = await this.notifications.reviewerChain(tx, c.userId, 'dcr:review');
      await this.notifications.notifyMany(
        tx,
        p,
        {
          type: 'expense.blocked',
          entityType: 'expense_claim',
          entityId: claimId,
          dedupeKey: `expense.blocked:${claimId}:${(gap.dates ?? []).join(',')}`,
          data: {
            claimId,
            month: c.month,
            ownerId: c.userId,
            ownerName: c.name,
            dates: gap.dates ?? [],
            dcrIds: gap.dcrIds ?? [],
            dcrStatus: gap.dcrStatus ?? {},
          },
        },
        reviewers,
      );
    });
  }

  async submit(p: Principal, id: string) {
    try {
      return await this.submitTx(p, id);
    } catch (e) {
      if (isDirector(p)) await this.notifyBlocked(p, id, e);
      throw e;
    }
  }

  private submitTx(p: Principal, id: string) {
    return this.tenant.run(p, async (tx) => {
      const c = await this.ownEditable(tx, p, id);
      const dto = await this.toDto(tx, c, p);
      if (!dto.lines.length) throw err(422, 'EXPENSE_EMPTY', 'Add at least one line first');
      const noReceipt = dto.lines.filter(
        (l) => l.category === 'hotel' && !l.attachments.some((a) => a.status === 'confirmed'),
      );
      if (noReceipt.length)
        throw err(422, 'RECEIPT_REQUIRED', 'Hotel lines need a confirmed receipt', {
          lineIds: noReceipt.map((l) => l.id),
        });
      const resubmit = c.status === 'rejected';
      const reqId = await this.approvals.request(tx, p, 'expense', c.id, null, {
        month: dto.month,
        total: dto.total,
      });
      await tx
        .update(expenseClaims)
        .set({
          status: 'submitted',
          submittedAt: new Date(),
          approvalRequestId: reqId,
          decidedAt: null,
          decidedBy: null,
          decisionComment: null,
        })
        .where(eq(expenseClaims.id, c.id));
      await this.audit.record(tx, p, resubmit ? 'expense.resubmitted' : 'expense.submitted', {
        entityType: 'expense_claim',
        entityId: c.id,
        after: { total: dto.total, lines: dto.lines.length, approvalId: reqId },
      });
      // Director: approved now by the system; the DCR gate still applies (409 DCR_NOT_APPROVED
      // rolls the whole submit back: the claim stays draft/rejected).
      await this.approvals.autoApprove(tx, p, reqId);
      await this.notifications.notify(tx, p, {
        type: 'expense.submitted',
        recipientId: await this.approvals.currentApprover(tx, reqId),
        entityType: 'expense_claim',
        entityId: c.id,
        dedupeKey: `expense.submitted:${reqId}:1`,
        data: { month: dto.month, total: dto.total, step: 1 },
      });
      return this.toDto(tx, await this.claimRow(tx, p, c.id), p);
    });
  }

  async decide(p: Principal, id: string, b: Decision) {
    const reqId = await this.tenant.run(p, async (tx) => {
      const c = await this.claimRow(tx, p, id);
      if (c.status !== 'submitted' || !c.approvalRequestId)
        throw err(409, 'CONFLICT', `Claim is ${c.status}`);
      return c.approvalRequestId;
    });
    await this.approvals.decide(p, reqId, b);
    return this.get(p, id);
  }

  pay(p: Principal, id: string, paymentRef: string) {
    return this.tenant.run(p, async (tx) => {
      const c = await this.claimRow(tx, p, id, true);
      if (c.userId === p.userId) throw new ForbiddenException('You cannot pay your own claim');
      if (c.status !== 'approved') throw err(409, 'CONFLICT', `Claim is ${c.status}`);
      await tx
        .update(expenseClaims)
        .set({ status: 'paid', paidAt: new Date(), paidBy: p.userId, paymentRef })
        .where(eq(expenseClaims.id, c.id));
      await this.audit.record(tx, p, 'expense.paid', {
        entityType: 'expense_claim',
        entityId: c.id,
        after: { paymentRef, total: Number(c.total) },
      });
      await this.notifications.notify(tx, p, {
        type: 'expense.paid',
        recipientId: c.userId,
        entityType: 'expense_claim',
        entityId: c.id,
        dedupeKey: `expense.paid:${c.id}`,
        data: { month: String(c.month).slice(0, 7), total: Number(c.total), paymentRef },
      });
      return this.toDto(tx, await this.claimRow(tx, p, c.id), p);
    });
  }

  // ---- attachments ----

  createAttachment(p: Principal, id: string, lineId: string, b: ExpenseAttachmentCreate) {
    return this.tenant.run(p, async (tx) => {
      const c = await this.ownEditable(tx, p, id);
      await this.lineRow(tx, c.id, lineId);
      const [n] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(expenseAttachments)
        .where(and(eq(expenseAttachments.lineId, lineId), isNull(expenseAttachments.deletedAt)));
      if (n!.n >= EXPENSE_MAX_FILES_PER_LINE)
        throw err(422, 'TOO_MANY_FILES', `At most ${EXPENSE_MAX_FILES_PER_LINE} files per line`);
      const up = await this.storage.presignPut(
        p.companyId,
        'expense_receipt',
        b.contentType,
        b.sizeBytes,
        keyExt(b.contentType),
      );
      const [a] = await tx
        .insert(expenseAttachments)
        .values({
          id: uuidv7(),
          companyId: p.companyId,
          lineId,
          fileKey: up.fileKey,
          contentType: b.contentType,
          sizeBytes: b.sizeBytes,
          uploadedBy: p.userId,
        })
        .returning();
      // A receipt on a drafted TA/DA line makes it the rep's own (kept on re-run).
      await tx
        .update(expenseLines)
        .set({ source: 'manual', autoTrigger: null, origin: 'manual' })
        .where(
          and(
            eq(expenseLines.id, lineId),
            eq(expenseLines.source, 'auto'),
            ne(expenseLines.origin, 'dcr'),
          ),
        );
      await this.audit.record(tx, p, 'expense.attachment_requested', {
        entityType: 'expense_attachment',
        entityId: a!.id,
        after: { claimId: c.id, lineId, contentType: b.contentType, sizeBytes: b.sizeBytes },
      });
      return {
        attachment: this.attDto(a!),
        uploadUrl: up.uploadUrl,
        method: up.method,
        headers: up.headers,
        expiresAt: up.expiresAt,
      };
    });
  }

  /** Attachment + its claim, if the caller may read that claim. */
  private async attachment(tx: Tx, p: Principal, attId: string) {
    const [row] = await tx
      .select({ a: expenseAttachments, claimId: expenseLines.claimId })
      .from(expenseAttachments)
      .innerJoin(expenseLines, eq(expenseLines.id, expenseAttachments.lineId))
      .where(
        and(
          eq(expenseAttachments.id, attId),
          isNull(expenseAttachments.deletedAt),
          isNull(expenseLines.deletedAt),
        ),
      );
    if (!row) throw new NotFoundException('Attachment not found');
    const c = await this.claimRow(tx, p, row.claimId).catch(() => {
      throw new NotFoundException('Attachment not found');
    });
    return { a: row.a, c };
  }

  /** Completion step: the object must exist with the declared size/type and matching magic bytes. */
  async confirmAttachment(p: Principal, attId: string) {
    // A rejected upload is removed and audited in a committed transaction, then the 422 is thrown.
    const r = await this.tenant.run(p, async (tx) => {
      const { a, c } = await this.attachment(tx, p, attId);
      if (c.userId !== p.userId) throw new ForbiddenException('Only the owner can confirm');
      if (!EDITABLE.includes(c.status))
        throw err(409, 'EXPENSE_NOT_EDITABLE', `Claim is ${c.status}`);
      if (a.status === 'confirmed') return { ok: this.attDto(a) };
      const head = await this.storage.head(a.fileKey);
      if (!head) throw err(409, 'UPLOAD_MISSING', 'Upload not found; PUT the file first');
      const reject = async (code: string, message: string) => {
        await this.storage.remove(a.fileKey).catch(() => undefined);
        await tx
          .update(expenseAttachments)
          .set({ deletedAt: new Date() })
          .where(eq(expenseAttachments.id, a.id));
        await this.audit.record(tx, p, 'expense.attachment_rejected', {
          entityType: 'expense_attachment',
          entityId: a.id,
          after: { code },
        });
        return { error: err(422, code, message) };
      };
      if (head.sizeBytes !== a.sizeBytes || head.sizeBytes > 10 * 1024 * 1024)
        return await reject('UPLOAD_SIZE_MISMATCH', 'Uploaded size differs from the declared size');
      if (head.contentType && head.contentType.split(';')[0]!.trim() !== a.contentType)
        return await reject('UPLOAD_TYPE_MISMATCH', 'Uploaded content type differs from declared');
      const bytes = await this.storage.firstBytes(a.fileKey, 512);
      if (!sniffMatches(a.contentType as never, bytes))
        return await reject('UPLOAD_FORMAT_INVALID', 'File content does not match its type');
      const [ok] = await tx
        .update(expenseAttachments)
        .set({ status: 'confirmed', confirmedAt: new Date() })
        .where(eq(expenseAttachments.id, a.id))
        .returning();
      await this.audit.record(tx, p, 'expense.attachment_confirmed', {
        entityType: 'expense_attachment',
        entityId: a.id,
        after: { claimId: c.id },
      });
      return { ok: this.attDto(ok!) };
    });
    if ('error' in r) throw r.error;
    return r.ok;
  }

  deleteAttachment(p: Principal, attId: string) {
    return this.tenant.run(p, async (tx) => {
      const { a, c } = await this.attachment(tx, p, attId);
      if (c.userId !== p.userId) throw new ForbiddenException('Only the owner can delete');
      if (!EDITABLE.includes(c.status))
        throw err(409, 'EXPENSE_NOT_EDITABLE', `Claim is ${c.status}`);
      await tx
        .update(expenseAttachments)
        .set({ deletedAt: new Date() })
        .where(eq(expenseAttachments.id, a.id));
      await this.storage.remove(a.fileKey).catch(() => undefined);
      await this.audit.record(tx, p, 'expense.attachment_deleted', {
        entityType: 'expense_attachment',
        entityId: a.id,
        after: { claimId: c.id },
      });
    });
  }

  /** Owner, the approver chain (expenses:approve over the owner) or finance; audited. */
  downloadUrl(p: Principal, attId: string) {
    return this.tenant.run(p, async (tx) => {
      const { a, c } = await this.attachment(tx, p, attId);
      if (a.status !== 'confirmed') throw err(409, 'UPLOAD_NOT_CONFIRMED', 'Not confirmed yet');
      const ext = a.fileKey.split('.').pop();
      const res = await this.storage.downloadUrl(
        p.companyId,
        a.fileKey,
        new Date(),
        `receipt-${a.id}.${ext}`,
      );
      await this.audit.record(tx, p, 'expense.attachment_downloaded', {
        entityType: 'expense_attachment',
        entityId: a.id,
        after: { claimId: c.id },
      });
      return res;
    });
  }

  // ---- reconciliation & reports ----

  private async reconcile(tx: Tx, c: ClaimRow): Promise<ExpenseReconciliation> {
    const lines = await tx
      .select()
      .from(expenseLines)
      .where(and(eq(expenseLines.claimId, c.id), isNull(expenseLines.deletedAt)));
    return reconcileClaim(c, lines, await this.monthDays(tx, [c.userId], c.month));
  }

  /** DCR day reports of these users in the claim month (one query for a whole report). */
  private monthDays(tx: Tx, userIds: string[], month: string) {
    const m = month.slice(0, 7);
    return tx
      .select({
        id: dcrs.id,
        date: dcrs.date,
        status: dcrs.status,
        field: workTypes.countsAsFieldDay,
        userId: dcrs.userId,
      })
      .from(dcrs)
      .innerJoin(workTypes, eq(workTypes.id, dcrs.workTypeId))
      .where(
        and(
          userIds.length === 1 ? eq(dcrs.userId, userIds[0]!) : inArray(dcrs.userId, userIds),
          isNull(dcrs.deletedAt),
          isDayReport(dcrs),
          gte(dcrs.date, month),
          lt(dcrs.date, nextMonth(m)),
        ),
      );
  }

  reconciliation(p: Principal, id: string) {
    return this.tenant.run(p, async (tx) => this.reconcile(tx, await this.claimRow(tx, p, id)));
  }

  private reportScope(p: Principal) {
    if (!p.permissions.includes('expenses:pay') && !p.permissions.includes('expenses:read'))
      throw new ForbiddenException('Missing permission: expenses:read or expenses:pay');
  }

  /** Claims for the month the caller may read, with reconciliation per claim. */
  async reportData(
    p: Principal,
    q: { month: string; userId?: string; teamOf?: string; status?: ExpenseStatus },
  ) {
    this.reportScope(p);
    return this.tenant.run(p, async (tx) => {
      let team: string[] | undefined;
      if (q.teamOf) {
        const r = await tx.execute<{ id: string }>(sql`with recursive t as (
            select id from users where id = ${q.teamOf}
            union select u.id from users u join t on u.manager_id = t.id)
          select id from t`);
        team = r.rows.map((x) => x.id);
      }
      const rows = await tx
        .select({ c: expenseClaims, name: users.name })
        .from(expenseClaims)
        .innerJoin(users, eq(users.id, expenseClaims.userId))
        .where(
          and(
            this.readable(p),
            isNull(expenseClaims.deletedAt),
            eq(expenseClaims.month, monthStart(q.month)),
            q.userId ? eq(expenseClaims.userId, q.userId) : undefined,
            team ? inArray(expenseClaims.userId, team) : undefined,
            q.status ? eq(expenseClaims.status, q.status) : undefined,
          ),
        )
        .orderBy(asc(users.name));
      if (!rows.length) return [];
      // Two queries for the whole report (was 3 per claim): all lines, all DCR days of the month.
      const allLines = await tx
        .select()
        .from(expenseLines)
        .where(
          and(
            inArray(
              expenseLines.claimId,
              rows.map((r) => r.c.id),
            ),
            isNull(expenseLines.deletedAt),
          ),
        )
        .orderBy(asc(expenseLines.date), asc(expenseLines.id));
      const allDays = await this.monthDays(
        tx,
        [...new Set(rows.map((r) => r.c.userId))],
        monthStart(q.month),
      );
      return rows.map((r) => {
        const lines = allLines.filter((l) => l.claimId === r.c.id);
        const days = allDays.filter((d) => d.userId === r.c.userId);
        return {
          rec: reconcileClaim(r.c, lines, days),
          userName: r.name,
          status: r.c.status,
          lines,
        };
      });
    });
  }

  /** Per-employee monthly statements (header, day rows) for the Excel export. */
  statements(
    p: Principal,
    month: string,
    data: Awaited<ReturnType<ExpensesService['reportData']>>,
  ) {
    return this.tenant.run(p, (tx) => loadStatements(tx, p.companyId, month, data));
  }

  async report(p: Principal, q: Parameters<ExpensesService['reportData']>[1]) {
    const data = await this.reportData(p, q);
    const byCategory = Object.fromEntries(EXPENSE_CATEGORIES.map((k) => [k, 0])) as Record<
      Category,
      number
    >;
    for (const d of data)
      for (const k of Object.keys(byCategory) as Category[])
        byCategory[k] = r2(byCategory[k] + d.rec.byCategory[k]);
    return {
      month: q.month,
      rows: data.map(({ rec: { days: _d, ...rec }, userName, status }) => ({
        ...rec,
        userName,
        status,
      })),
      total: r2(data.reduce((s, d) => s + d.rec.total, 0)),
      byCategory,
    };
  }

  auditExport(p: Principal, q: Record<string, unknown>, rows: number) {
    return this.tenant.run(p, (tx) =>
      this.audit.record(tx, p, 'expense.exported', {
        entityType: 'expense_report',
        after: { ...q, rows },
      }),
    );
  }
}

/** Pure reconciliation of one claim against its user's DCR day reports of the claim month. */
function reconcileClaim(
  c: ClaimRow,
  lines: LineRow[],
  days: {
    id: string;
    date: string;
    status: (typeof dcrs.$inferSelect)['status'];
    field: boolean;
  }[],
): ExpenseReconciliation {
  const m = c.month.slice(0, 7);
  const byDate = new Map<string, LineRow[]>();
  for (const l of lines) byDate.set(l.date, [...(byDate.get(l.date) ?? []), l]);
  const byCategory = Object.fromEntries(EXPENSE_CATEGORIES.map((k) => [k, 0])) as Record<
    Category,
    number
  >;
  for (const l of lines) byCategory[l.category] = r2(byCategory[l.category] + Number(l.amount));
  let unmatched = 0;
  const out = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, ls]) => {
      const d = days.find((x) => x.date === date);
      const flags: ExpenseReconciliation['days'][number]['flags'] = [];
      if (!date.startsWith(m)) flags.push('outside_month');
      if (!d) flags.push('no_dcr');
      else {
        if (d.status === 'draft') flags.push('dcr_not_submitted');
        if (!d.field) flags.push('non_field_day');
      }
      if (ls.some((l) => l.dcrId && l.dcrId !== d?.id)) flags.push('dcr_link_mismatch');
      const claimed = r2(ls.reduce((s, l) => s + Number(l.amount), 0));
      if (flags.length) unmatched = r2(unmatched + claimed);
      return {
        date,
        claimed,
        lineCount: ls.length,
        dcrId: d?.id ?? null,
        dcrStatus: d?.status ?? null,
        flags,
      };
    });
  return {
    claimId: c.id,
    userId: c.userId,
    month: m,
    total: r2(lines.reduce((s, l) => s + Number(l.amount), 0)),
    claimedDays: out.length,
    dcrDays: days.filter((d) => d.status === 'submitted' || d.status === 'approved').length,
    matchedDays: out.filter((d) => !d.flags.length).length,
    unmatchedAmount: unmatched,
    byCategory,
    days: out,
  };
}
