import { Injectable } from '@nestjs/common';
import type {
  DcrExpenseItem,
  DcrExpenseLink,
  ExpenseAutoDraft,
  ExpenseStatus,
} from '@ariforce/contracts';
import { companies, expenseClaims, expenseLines, type Tx } from '@ariforce/db';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Principal } from '../auth/principal';
import { AuditService } from '../common/audit.service';
import { computeAllowances } from '../allowances/allowances.engine';
import {
  autoDraftError,
  autoDraftPlan,
  claimEditable,
  claimMonth,
  rejectionPlan,
} from './auto-draft';

export interface DcrRef {
  id: string;
  userId: string;
  date: string;
}

/**
 * Server TA/DA on the DCR lifecycle (Phase B, migration 0052). System actions inside the caller's
 * tenant transaction, audited with after.actor = 'system':
 *  - submit (companies.auto_expense_on_dcr_submit on): ensure the month claim, replace the day's
 *    auto lines through the TA/DA engine (savepoint: an engine failure never fails the submit).
 *  - reject (always): remove the day's auto lines from a draft/rejected claim, flag the rest
 *    (dcr_rejected_at) so a submitted/approved/paid claim shows the rejected day to approvers.
 */
@Injectable()
export class ExpenseAutoDraftService {
  constructor(private readonly audit: AuditService) {}

  async enabled(tx: Tx, p: Principal): Promise<boolean> {
    const [c] = await tx
      .select({ on: companies.autoExpenseOnDcrSubmit })
      .from(companies)
      .where(eq(companies.id, p.companyId));
    return !!c?.on;
  }

  /** Call after the DCR is submitted (same transaction). null when the setting is off. */
  async onDcrSubmit(tx: Tx, p: Principal, d: DcrRef): Promise<ExpenseAutoDraft | null> {
    if (!(await this.enabled(tx, p))) return null;
    let base = {
      date: d.date,
      dcrId: d.id,
      claimId: null as string | null,
      claimStatus: null as ExpenseStatus | null,
      claimCreated: false,
    };
    let result: ExpenseAutoDraft;
    try {
      result = await tx.transaction(async (sp) => {
        const month = claimMonth(d.date);
        let [c] = await sp
          .select()
          .from(expenseClaims)
          .where(and(eq(expenseClaims.userId, d.userId), eq(expenseClaims.month, month)))
          .for('update');
        if (!c) {
          [c] = await sp
            .insert(expenseClaims)
            .values({ id: uuidv7(), companyId: p.companyId, userId: d.userId, month })
            .returning();
          base = { ...base, claimCreated: true };
          await this.audit.record(sp, p, 'expense.created', {
            entityType: 'expense_claim',
            entityId: c!.id,
            after: {
              month: month.slice(0, 7),
              actor: 'system',
              trigger: 'dcr_submit',
              dcrId: d.id,
            },
          });
        }
        base = { ...base, claimId: c!.id, claimStatus: c!.status };
        // A soft-deleted claim keeps the (user, month) slot; treat it as locked.
        const status = c!.deletedAt ? 'paid' : c!.status;
        const r = claimEditable(status)
          ? await computeAllowances(sp, c!, { dryRun: false, places: {} }, d.date, {
              dates: [d.date],
            })
          : { days: [], lines: [] };
        const plan = autoDraftPlan(
          base,
          status,
          r.days.find((x) => x.date === d.date),
          r.lines.map((l) => ({ amount: l.amount, category: l.category, mileageKm: l.mileageKm })),
        );
        if (plan.write) {
          const now = new Date();
          await sp
            .update(expenseLines)
            .set({ deletedAt: now })
            .where(
              and(
                eq(expenseLines.claimId, c!.id),
                eq(expenseLines.date, d.date),
                eq(expenseLines.source, 'auto'),
                ne(expenseLines.origin, 'dcr'),
                isNull(expenseLines.deletedAt),
              ),
            );
          await sp.insert(expenseLines).values(
            r.lines.map((l) => ({
              id: uuidv7(),
              companyId: p.companyId,
              claimId: c!.id,
              date: l.date,
              category: l.category,
              amount: l.amount.toFixed(2),
              notes: l.notes,
              mileageKm: l.mileageKm === null ? null : l.mileageKm.toFixed(2),
              dcrId: l.dcrId,
              source: 'auto' as const,
              autoTrigger: 'dcr_submit' as const,
              origin: 'ta_da' as const,
              calc: l.calc,
              allowancePlaceId: l.placeId,
            })),
          );
          // A new report for the day supersedes the rejected-day flag on this editable claim.
          await sp
            .update(expenseLines)
            .set({ dcrRejectedAt: null })
            .where(
              and(
                eq(expenseLines.claimId, c!.id),
                eq(expenseLines.date, d.date),
                isNull(expenseLines.deletedAt),
              ),
            );
          await recomputeTotal(sp, c!.id);
        }
        await this.audit.record(sp, p, 'expense.auto_drafted', {
          entityType: 'expense_claim',
          entityId: c!.id,
          after: { actor: 'system', trigger: 'dcr_submit', ...plan.result },
        });
        return plan.result;
      });
    } catch (e) {
      result = autoDraftError(base, e);
      await this.audit.record(tx, p, 'expense.auto_drafted', {
        entityType: base.claimId ? 'expense_claim' : 'dcr',
        entityId: base.claimId ?? d.id,
        after: { actor: 'system', trigger: 'dcr_submit', ...result },
      });
    }
    return result;
  }

  /**
   * DCR expenses -> month claim (contract #121), at every submit, independent of the TA/DA
   * setting. Same claim rules as TA/DA: create the month claim if missing; write only a draft or
   * rejected claim; a submitted/approved/paid or soft-deleted claim is not touched (skipped,
   * claim_locked). Idempotent: all live origin = 'dcr' lines of this DCR are replaced (none when
   * the DCR has no items); expense_lines_dcr_item_uq makes a duplicate impossible. Savepoint: a
   * failure never fails the submit (status error).
   */
  async linkDcrExpenses(
    tx: Tx,
    p: Principal,
    d: DcrRef,
    items: DcrExpenseItem[],
  ): Promise<DcrExpenseLink> {
    let out: DcrExpenseLink = {
      status: 'skipped',
      reason: null,
      claimId: null,
      claimStatus: null,
      claimCreated: false,
      lines: 0,
      total: 0,
    };
    try {
      return await tx.transaction(async (sp) => {
        const month = claimMonth(d.date);
        let [c] = await sp
          .select()
          .from(expenseClaims)
          .where(and(eq(expenseClaims.userId, d.userId), eq(expenseClaims.month, month)))
          .for('update');
        if (!c && !items.length) return { ...out, reason: 'no_expenses' as const };
        if (!c) {
          [c] = await sp
            .insert(expenseClaims)
            .values({ id: uuidv7(), companyId: p.companyId, userId: d.userId, month })
            .returning();
          out = { ...out, claimCreated: true };
          await this.audit.record(sp, p, 'expense.created', {
            entityType: 'expense_claim',
            entityId: c!.id,
            after: {
              month: month.slice(0, 7),
              actor: 'system',
              trigger: 'dcr_expenses',
              dcrId: d.id,
            },
          });
        }
        out = { ...out, claimId: c!.id, claimStatus: c!.status };
        if (c!.deletedAt || !claimEditable(c!.status))
          return { ...out, reason: 'claim_locked' as const };
        const now = new Date();
        const old = await sp
          .update(expenseLines)
          .set({ deletedAt: now })
          .where(
            and(
              eq(expenseLines.claimId, c!.id),
              eq(expenseLines.dcrId, d.id),
              eq(expenseLines.origin, 'dcr'),
              isNull(expenseLines.deletedAt),
            ),
          )
          .returning({ id: expenseLines.id });
        if (items.length)
          await sp.insert(expenseLines).values(
            items.map((it, i) => ({
              id: uuidv7(),
              companyId: p.companyId,
              claimId: c!.id,
              date: d.date,
              category: it.category,
              amount: it.amount.toFixed(2),
              notes: it.note?.trim() || null,
              dcrId: d.id,
              source: 'auto' as const,
              autoTrigger: 'dcr_submit' as const,
              origin: 'dcr' as const,
              dcrItemIndex: i,
            })),
          );
        await recomputeTotal(sp, c!.id);
        const total = Math.round(items.reduce((t, it) => t + it.amount, 0) * 100) / 100;
        const res: DcrExpenseLink = {
          ...out,
          status: items.length ? 'linked' : 'skipped',
          reason: items.length ? null : 'no_expenses',
          lines: items.length,
          total,
        };
        await this.audit.record(sp, p, 'expense.dcr_linked', {
          entityType: 'expense_claim',
          entityId: c!.id,
          after: { actor: 'system', dcrId: d.id, date: d.date, replaced: old.length, ...res },
        });
        return res;
      });
    } catch (e) {
      const res = { ...out, status: 'error' as const, reason: null };
      await this.audit.record(tx, p, 'expense.dcr_linked', {
        entityType: 'dcr',
        entityId: d.id,
        after: { actor: 'system', ...res, error: String((e as Error)?.message ?? e).slice(0, 200) },
      });
      return res;
    }
  }

  /** Call after the DCR is rejected (same transaction); independent of the company setting. */
  async onDcrRejected(tx: Tx, p: Principal, d: DcrRef) {
    const [c] = await tx
      .select()
      .from(expenseClaims)
      .where(
        and(
          eq(expenseClaims.userId, d.userId),
          eq(expenseClaims.month, claimMonth(d.date)),
          isNull(expenseClaims.deletedAt),
        ),
      )
      .for('update');
    if (!c) return null;
    const rows = await tx
      .select({ id: expenseLines.id, source: expenseLines.source, at: expenseLines.dcrRejectedAt })
      .from(expenseLines)
      .where(
        and(
          eq(expenseLines.claimId, c.id),
          eq(expenseLines.date, d.date),
          isNull(expenseLines.deletedAt),
        ),
      );
    const plan = rejectionPlan(
      c.status,
      rows.map((r) => ({ id: r.id, source: r.source, flagged: !!r.at })),
    );
    if (!plan.remove.length && !plan.flag.length) return null;
    const now = new Date();
    if (plan.remove.length) {
      await tx
        .update(expenseLines)
        .set({ deletedAt: now })
        .where(inArray(expenseLines.id, plan.remove));
      await recomputeTotal(tx, c.id);
    }
    if (plan.flag.length)
      await tx
        .update(expenseLines)
        .set({ dcrRejectedAt: now })
        .where(inArray(expenseLines.id, plan.flag));
    const out = {
      claimId: c.id,
      claimStatus: c.status,
      removed: plan.remove.length,
      flagged: plan.flag.length,
    };
    await this.audit.record(tx, p, 'expense.dcr_rejected_cleanup', {
      entityType: 'expense_claim',
      entityId: c.id,
      after: { actor: 'system', trigger: 'dcr_reject', dcrId: d.id, date: d.date, ...out },
    });
    return out;
  }
}

export async function recomputeTotal(tx: Tx, claimId: string) {
  await tx.execute(sql`update expense_claims set total = coalesce((
    select sum(amount) from expense_lines where claim_id = ${claimId} and deleted_at is null), 0)
    where id = ${claimId}`);
}
