import { Injectable } from '@nestjs/common';
import {
  redactAudit,
  type AuditLogEntry,
  type AuditLogQuery,
  type RoleKey,
} from '@ariforce/contracts';
import { auditLog, roles, userRoles, users } from '@ariforce/db';
import { and, desc, eq, inArray, like, sql, type SQL } from 'drizzle-orm';
import type { Principal } from '../auth/principal';
import { TenantService } from '../common/tenant.service';
import { err } from '../field/checkins.service';
import { companySettings } from '../field/field.util';
import { primaryRole } from '../expenses/approval-trail';

/**
 * Keyset cursor over (at desc, id desc): base64url of "<at>|<id>", where <at> is the microsecond
 * epoch (a JS Date would drop the microseconds and skip rows).
 */
const encode = (atUs: string, id: number) => Buffer.from(`${atUs}|${id}`).toString('base64url');
function decode(c: string): { atUs: string; id: number } {
  const [a, i] = Buffer.from(c, 'base64url').toString().split('|');
  const id = Number(i);
  if (!a || !/^\d{1,20}$/.test(a) || !Number.isSafeInteger(id))
    throw err(422, 'VALIDATION', 'Bad cursor', { field: 'cursor' });
  return { atUs: a, id };
}

/**
 * Audit log reader (#128). Tenant RLS (audit_read policy) keeps it to the caller's company; the
 * route needs audit:read. Uses audit_log_company_at_idx (range on at) and audit_log_entity_idx.
 * before/after go through redactAudit (contracts) so tokens/secrets/OTPs never leave the API.
 * Reading is not itself audited.
 */
@Injectable()
export class AuditLogService {
  constructor(private readonly tenant: TenantService) {}

  list(p: Principal, q: AuditLogQuery) {
    if (q.entityId && !q.entityType)
      throw err(422, 'VALIDATION', 'entityId needs entityType', { field: 'entityId' });
    if (q.from && q.to && q.from > q.to)
      throw err(422, 'VALIDATION', 'from must be on or before to', { field: 'from' });
    const cur = q.cursor ? decode(q.cursor) : null;
    return this.tenant.run(p, async (tx) => {
      const tz = (await companySettings(tx, p)).timezone;
      const prefix = q.action?.endsWith('.');
      const esc = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);
      const where = [
        eq(auditLog.companyId, p.companyId),
        q.actorUserId ? eq(auditLog.actorUserId, q.actorUserId) : undefined,
        q.action
          ? prefix
            ? like(auditLog.action, `${esc(q.action)}%`)
            : eq(auditLog.action, q.action)
          : undefined,
        q.entityType ? eq(auditLog.entityType, q.entityType) : undefined,
        q.entityId ? eq(auditLog.entityId, q.entityId) : undefined,
        q.from ? sql`${auditLog.at} >= (${q.from}::date::timestamp at time zone ${tz})` : undefined,
        q.to
          ? sql`${auditLog.at} < ((${q.to}::date + 1)::timestamp at time zone ${tz})`
          : undefined,
        cur
          ? sql`(${auditLog.at}, ${auditLog.id}) < (to_timestamp(${cur.atUs}::numeric / 1e6), ${cur.id})`
          : undefined,
      ].filter(Boolean) as SQL[];
      const limit = q.limit ?? 50;
      const rows = await tx
        .select({
          r: auditLog,
          atUs: sql<string>`(extract(epoch from ${auditLog.at}) * 1e6)::bigint::text`,
        })
        .from(auditLog)
        .where(and(...where))
        .orderBy(desc(auditLog.at), desc(auditLog.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit).map((x) => x.r);
      const actorIds = [...new Set(page.flatMap((r) => (r.actorUserId ? [r.actorUserId] : [])))];
      const names = actorIds.length
        ? await tx
            .select({ id: users.id, name: users.name })
            .from(users)
            .where(inArray(users.id, actorIds))
        : [];
      const rr = actorIds.length
        ? await tx
            .select({ userId: userRoles.userId, key: roles.key })
            .from(userRoles)
            .innerJoin(roles, eq(roles.id, userRoles.roleId))
            .where(inArray(userRoles.userId, actorIds))
        : [];
      const items: AuditLogEntry[] = page.map((r) => ({
        id: String(r.id),
        at: r.at.toISOString(),
        actor: r.actorUserId
          ? {
              id: r.actorUserId,
              name: names.find((n) => n.id === r.actorUserId)?.name ?? '',
              role: primaryRole(
                rr.filter((x) => x.userId === r.actorUserId).map((x) => x.key),
              ) as RoleKey | null,
            }
          : null,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        before: redactAudit(r.before) ?? null,
        after: redactAudit(r.after) ?? null,
        ip: r.ip ?? null,
        userAgent: r.userAgent,
        requestId: r.requestId,
      }));
      const last = rows[limit - 1];
      return {
        items,
        nextCursor: rows.length > limit && last ? encode(last.atUs, last.r.id) : null,
        serverTime: new Date().toISOString(),
      };
    });
  }
}
