import { ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { duplicateKeys, type DoctorDuplicate } from '@ariforce/contracts';
import { doctors, territories, type Tx } from '@ariforce/db';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import type { Principal } from '../auth/principal';
import { AuditService } from '../common/audit.service';
import { TenantService } from '../common/tenant.service';
import { ApprovalsService } from '../plans/approvals.service';

type Row = Record<string, unknown>;
interface DupInput {
  name?: unknown;
  pincode?: unknown;
  registrationNo?: unknown;
}

/**
 * Field-added doctor approval + duplicate detection (#26, docs/DOCTOR-APPROVAL.md).
 * Rules match the import duplicate rules: registration no. (hard), then name without "Dr." + pincode (soft).
 */
@Injectable()
export class DoctorsService implements OnModuleInit {
  constructor(
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
  ) {}

  onModuleInit() {
    this.approvals.register('doctor', async (tx, p, req, approved, comment) => {
      await tx
        .update(doctors)
        .set({ approvalStatus: approved ? 'approved' : 'rejected' })
        .where(and(eq(doctors.id, req.entityId), eq(doctors.approvalStatus, 'pending')));
      await this.audit.record(tx, p, approved ? 'doctor.approved' : 'doctor.rejected', {
        entityType: 'doctor',
        entityId: req.entityId,
        after: { comment, requestId: req.id },
      });
    });
  }

  /** Existing (non-deleted) doctors company-wide matching the duplicate rules, strong matches first. */
  async duplicates(tx: Tx, b: DupInput, excludeId?: string): Promise<DoctorDuplicate[]> {
    const keys = duplicateKeys('doctors', b as Row);
    if (!keys.length) return [];
    const reg = b.registrationNo ? String(b.registrationNo).toUpperCase() : null;
    const pin = b.pincode ? String(b.pincode) : null;
    const rows = await tx
      .select({
        id: doctors.id,
        name: doctors.name,
        pincode: doctors.pincode,
        registrationNo: doctors.registrationNo,
        territoryId: doctors.territoryId,
        territoryName: territories.name,
        approvalStatus: doctors.approvalStatus,
      })
      .from(doctors)
      .innerJoin(territories, eq(territories.id, doctors.territoryId))
      .where(
        and(
          isNull(doctors.deletedAt),
          or(
            reg ? sql`upper(${doctors.registrationNo}) = ${reg}` : undefined,
            pin ? eq(doctors.pincode, pin) : undefined,
          ),
        ),
      );
    const out: DoctorDuplicate[] = [];
    for (const r of rows) {
      if (r.id === excludeId) continue;
      const theirs = duplicateKeys('doctors', r as Row);
      const hit = keys.find((k) => theirs.some((t) => t.rule === k.rule && t.key === k.key));
      if (!hit) continue;
      out.push({
        id: r.id,
        name: r.name,
        territoryId: r.territoryId,
        territoryName: r.territoryName,
        rule: hit.rule as DoctorDuplicate['rule'],
        approvalStatus:
          r.approvalStatus === 'pending' || r.approvalStatus === 'rejected'
            ? r.approvalStatus
            : 'approved',
      });
    }
    return out.sort((a, b2) =>
      a.rule === b2.rule ? a.name.localeCompare(b2.name) : a.rule === 'registration_no' ? -1 : 1,
    );
  }

  check(p: Principal, b: DupInput) {
    return this.tenant.run(p, async (tx) => ({ matches: await this.duplicates(tx, b) }));
  }

  /** Throws 409 on a duplicate; returns the soft matches the caller chose to accept. */
  async guardCreate(tx: Tx, body: Row): Promise<DoctorDuplicate[]> {
    const matches = await this.duplicates(tx, body);
    if (matches.some((m) => m.rule === 'registration_no'))
      throw new ConflictException({
        code: 'DOCTOR_DUPLICATE',
        message: 'A doctor with this registration number already exists',
        details: { matches },
      });
    if (matches.length && body.allowPossibleDuplicate !== true)
      throw new ConflictException({
        code: 'DOCTOR_POSSIBLE_DUPLICATE',
        message:
          'A doctor with the same name and pincode exists; re-send with allowPossibleDuplicate: true to add anyway',
        details: { matches },
      });
    return matches;
  }

  /** Opens the approval request for a pending doctor. */
  requestApproval(
    tx: Tx,
    p: Principal,
    row: Row,
    possibleDuplicates: DoctorDuplicate[],
    reason: string,
  ) {
    return this.approvals.request(tx, p, 'doctor', String(row.id), reason, {
      name: row.name,
      territoryId: row.territoryId,
      possibleDuplicates: possibleDuplicates.map((d) => d.id),
    });
  }
}
