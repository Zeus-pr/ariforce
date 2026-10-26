import { Controller, Get, NotFoundException } from '@nestjs/common';
import type { Me, Permission, Role } from '@ariforce/contracts';
import { companies, roles, users } from '@ariforce/db';
import { asc, eq, isNull } from 'drizzle-orm';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { TenantService } from '../common/tenant.service';

@Controller({ version: '1' })
export class MeController {
  constructor(private readonly tenant: TenantService) {}

  @Get('me')
  @RequirePermissions('me:read')
  async me(@CurrentPrincipal() p: Principal): Promise<Me> {
    return this.tenant.run(p, async (tx) => {
      const [u] = await tx.select().from(users).where(eq(users.id, p.userId));
      const [c] = await tx.select({ name: companies.name }).from(companies);
      if (!u || !c) throw new NotFoundException();
      return {
        id: u.id,
        companyId: u.companyId,
        companyName: c.name,
        email: u.email,
        name: u.name,
        employeeCode: u.employeeCode,
        roles: p.roles,
        permissions: p.permissions,
        territoryIds: p.territoryIds,
        managerId: u.managerId,
      };
    });
  }

  @Get('roles')
  @RequirePermissions('roles:read')
  async roles(@CurrentPrincipal() p: Principal): Promise<{ items: Role[] }> {
    const rows = await this.tenant.run(p, (tx) =>
      tx.select().from(roles).where(isNull(roles.deletedAt)).orderBy(asc(roles.rank)),
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        rank: r.rank,
        inHierarchy: r.rank > 0,
        permissions: r.permissions.filter((x) => x.includes(':')) as Permission[],
      })),
    };
  }
}
