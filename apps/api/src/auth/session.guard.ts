import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { AUTH_STATE_CODES, PERMISSIONS, type Permission, type RoleKey } from '@ariforce/contracts';
import { err } from '../field/checkins.service';
import {
  authSession,
  roles,
  territories,
  userRoles,
  userTerritories,
  withTenant,
  type Db,
} from '@ariforce/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DB } from '../db/db.module';
import { clientIp } from '../common/client-ip';
import { sessionPastMaxAge } from './auth';
import { AuthService } from './auth.service';
import { IS_PUBLIC, PERMISSIONS_KEY } from './decorators';
import { COMPANY_WIDE_ROLES, MASTERS_WIDE_ROLES, type Principal } from './principal';

const KNOWN = new Set<string>(PERMISSIONS);

/** Global guard: session (cookie or bearer) -> tenant membership -> roles/permissions/scope. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
    @Inject(DB) private readonly db: Db,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest<Request & { principal?: Principal }>();

    const s = await this.authService.auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!s) throw new UnauthorizedException('Sign in required');
    // Absolute cap (auth.ts SESSION_MAX_AGE_S): the sliding window alone would never end.
    if (sessionPastMaxAge(s.session.createdAt)) {
      await this.db.delete(authSession).where(eq(authSession.id, s.session.id));
      throw new UnauthorizedException('Session expired; sign in again');
    }
    const m = await this.authService.audit.resolveMembership(s.user.id);
    if (!m) {
      // Pending/rejected self sign-ups hold a login but no data access (cookie or bearer alike).
      const st = await this.db.execute<{ s: string | null }>(
        sql`select auth_account_status(${s.user.id}) as s`,
      );
      const status = st.rows[0]?.s;
      if (status === 'pending')
        throw err(403, AUTH_STATE_CODES.pending, 'Your account is awaiting approval');
      if (status === 'rejected')
        throw err(403, AUTH_STATE_CODES.rejected, 'Your sign-up request was not approved');
      if (status === 'suspended')
        throw err(403, AUTH_STATE_CODES.suspended, 'Your account is deactivated');
      throw new ForbiddenException('No active AriForce user for this identity');
    }

    const p = await withTenant(this.db, m, async (tx) => {
      const rs = await tx
        .select({ key: roles.key, permissions: roles.permissions })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(and(eq(userRoles.userId, m.userId), isNull(roles.deletedAt)));
      const ts = await tx
        .select({ id: territories.id, path: territories.path })
        .from(userTerritories)
        .innerJoin(territories, eq(territories.id, userTerritories.territoryId))
        .where(and(eq(userTerritories.userId, m.userId), isNull(territories.deletedAt)));
      // Reporting line: the user and everyone below them via users.manager_id (cycle-safe).
      const team = await tx.execute<{ user_id: string; path: string | null }>(sql`
        with recursive team(id, trail) as (
          select u.id, array[u.id] from users u where u.id = ${m.userId}
          union all
          select c.id, t.trail || c.id from users c join team t on c.manager_id = t.id
          where c.deleted_at is null and not c.id = any(t.trail)
        )
        select team.id as user_id, tr.path
        from team
        left join user_territories ut on ut.user_id = team.id
        left join territories tr on tr.id = ut.territory_id and tr.deleted_at is null`);
      return { rs, ts, team: team.rows };
    });
    const roleKeys = p.rs.map((r) => r.key as RoleKey);
    const permissions = [...new Set(p.rs.flatMap((r) => r.permissions))].filter((x) =>
      KNOWN.has(x),
    ) as Permission[];
    const companyWide = roleKeys.some((r) => COMPANY_WIDE_ROLES.includes(r));
    const mastersWide = companyWide || roleKeys.some((r) => MASTERS_WIDE_ROLES.includes(r));
    const teamPaths = [...new Set(p.team.map((t) => t.path).filter((x): x is string => !!x))];
    req.principal = {
      authUserId: s.user.id,
      sessionId: s.session.id,
      userId: m.userId,
      companyId: m.companyId,
      roles: roleKeys,
      permissions,
      territoryIds: p.ts.map((t) => t.id),
      scopePaths: mastersWide ? null : teamPaths,
      teamUserIds: companyWide ? null : [...new Set(p.team.map((t) => t.user_id))],
      requestId: (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
      ip: clientIp(req),
      userAgent: req.headers['user-agent'] ?? null,
    };

    const needed = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, targets) ?? [];
    const missing = needed.filter((n) => !permissions.includes(n));
    if (missing.length) throw new ForbiddenException(`Missing permission: ${missing.join(', ')}`);
    return true;
  }
}
