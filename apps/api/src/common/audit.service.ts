import { Inject, Injectable, Logger } from '@nestjs/common';
import { auditLog, withTenant, type Db, type Tx } from '@ariforce/db';
import { sql } from 'drizzle-orm';
import { DB } from '../db/db.module';
import type { Principal } from '../auth/principal';

export interface AuditEntry {
  entityType?: string | null;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

/** Writes to the append-only audit_log (insert-only grant + blocking trigger). */
@Injectable()
export class AuditService {
  private readonly log = new Logger('Audit');
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Inside an existing tenant transaction (mutation + audit commit together). */
  async record(tx: Tx, p: Principal, action: string, e: AuditEntry = {}) {
    await tx.insert(auditLog).values({
      companyId: p.companyId,
      actorUserId: p.userId,
      action,
      entityType: e.entityType ?? null,
      entityId: e.entityId ?? null,
      before: e.before ?? null,
      after: e.after ?? null,
      ip: e.ip ?? p.ip,
      userAgent: e.userAgent ?? p.userAgent,
      requestId: p.requestId,
    });
  }

  /** For auth events (no tenant context yet): resolve membership, then write in that tenant. */
  async recordForAuthUser(authUserId: string, action: string, e: AuditEntry = {}) {
    try {
      const m = await this.resolveMembership(authUserId);
      if (!m) return;
      await withTenant(this.db, { companyId: m.companyId, userId: m.userId }, (tx) =>
        tx.insert(auditLog).values({
          companyId: m.companyId,
          actorUserId: m.userId,
          action,
          entityType: e.entityType ?? null,
          entityId: e.entityId ?? null,
          ip: e.ip ?? null,
          userAgent: e.userAgent ?? null,
        }),
      );
    } catch (err) {
      // Never block sign-in/out on audit failure, but make it loud.
      this.log.error(`audit ${action} failed: ${(err as Error).message}`);
    }
  }

  async resolveMembership(authUserId: string) {
    const r = await this.db.execute<{ user_id: string; company_id: string }>(
      sql`select user_id, company_id from auth_resolve_membership(${authUserId})`,
    );
    const row = r.rows[0];
    return row ? { userId: row.user_id, companyId: row.company_id } : null;
  }
}
