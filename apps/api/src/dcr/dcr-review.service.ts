import { Injectable } from '@nestjs/common';
import type { Dcr, DcrDecision } from '@ariforce/contracts';
import { dcrs } from '@ariforce/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type * as z from 'zod';
import type { Principal } from '../auth/principal';
import { AuditService } from '../common/audit.service';
import { TenantService } from '../common/tenant.service';
import { err } from '../field/checkins.service';
import { companySettings } from '../field/field.util';
import { reviewable } from './day-report';
import { DcrService } from './dcr.service';

/**
 * Manager review of submitted DCRs (dcr:review). Scope matches approvals: reports of users in the
 * reviewer's team (the queue is GET /v1/dcrs?status=submitted) (company-wide when teamUserIds is null), never the reviewer's own. Approve keeps
 * the report counting; reject keeps the row as history, drops it from every count and reopens the
 * day for the rep for DCR_UNLOCK_HOURS (see unlockedUntilSql).
 */
@Injectable()
export class DcrReviewService {
  constructor(
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
    private readonly dcr: DcrService,
  ) {}

  /** POST /v1/dcrs/:id/decision. */
  decision(p: Principal, id: string, b: z.infer<typeof DcrDecision>) {
    return this.decide(p, id, b.decision === 'reject' ? b.comment! : null);
  }

  private decide(p: Principal, id: string, reason: string | null): Promise<Dcr> {
    return this.tenant.run(p, async (tx) => {
      const s = await companySettings(tx, p);
      const [cur] = await tx
        .select()
        .from(dcrs)
        .where(
          and(
            eq(dcrs.id, id),
            isNull(dcrs.deletedAt),
            p.teamUserIds ? inArray(dcrs.userId, p.teamUserIds) : undefined,
          ),
        )
        .for('update');
      const ok = reviewable(cur, p.userId);
      if (!ok.ok) throw err(ok.status, ok.code, ok.message, { id, status: cur?.status ?? null });
      const now = new Date();
      const [fresh] = await tx
        .update(dcrs)
        .set(
          reason === null
            ? { status: 'approved', approvedAt: now, approvedBy: p.userId, updatedAt: now }
            : {
                status: 'rejected',
                rejectedAt: now,
                rejectedBy: p.userId,
                rejectionReason: reason,
                updatedAt: now,
              },
        )
        .where(and(eq(dcrs.id, id), eq(dcrs.status, 'submitted')))
        .returning();
      if (!fresh) throw err(409, 'NOT_PENDING_REVIEW', 'DCR is no longer pending review', { id });
      await this.audit.record(tx, p, reason === null ? 'dcr.approve' : 'dcr.reject', {
        entityType: 'dcr',
        entityId: id,
        before: { status: 'submitted' },
        after:
          reason === null
            ? { status: 'approved', userId: cur!.userId, date: cur!.date }
            : { status: 'rejected', userId: cur!.userId, date: cur!.date, reason },
      });
      return (await this.dcr.toDto(tx, s, [fresh]))[0]!;
    });
  }
}
