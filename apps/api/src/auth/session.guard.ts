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
import { PERMISSIONS, type Permission, type RoleKey } from '@ariforce/contracts';
import { roles, territories, userRoles, userTerritories, withTenant, type Db } from '@ariforce/db';
import { and, eq, isNull } from 'drizzle-orm';
import { DB } from '../db/db.module';
import { AuthService } from './auth.service';
import { IS_PUBLIC, PERMISSIONS_KEY } from './decorators';
import { COMPANY_WIDE_ROLES, type Principal } from './principal';

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
    const m = await this.authService.audit.resolveMembership(s.user.id);
    if (!m) throw new ForbiddenException('No active AriForce user for this identity');

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
      return { rs, ts };
    });
    const roleKeys = p.rs.map((r) => r.key as RoleKey);
    const permissions = [...new Set(p.rs.flatMap((r) => r.permissions))].filter((x) =>
      KNOWN.has(x),
    ) as Permission[];
    const companyWide = roleKeys.some((r) => COMPANY_WIDE_ROLES.includes(r));
    req.principal = {
      authUserId: s.user.id,
      sessionId: s.session.id,
      userId: m.userId,
      companyId: m.companyId,
      roles: roleKeys,
      permissions,
      territoryIds: p.ts.map((t) => t.id),
      scopePaths: companyWide ? null : p.ts.map((t) => t.path),
      requestId: (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    };

    const needed = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, targets) ?? [];
    const missing = needed.filter((n) => !permissions.includes(n));
    if (missing.length) throw new ForbiddenException(`Missing permission: ${missing.join(', ')}`);
    return true;
  }
}
