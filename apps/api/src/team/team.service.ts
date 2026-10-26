import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  EmployeeCreate,
  EmployeeUpdate,
  MIN_MANAGER_RANK,
  ROLE_RANK,
  hierarchyRank,
  isHierarchyRole,
  type RoleKey,
  type TeamNode,
  type TeamTree,
} from '@ariforce/contracts';
import {
  authAccount,
  authUser,
  roles,
  territories,
  userInvites,
  userRoles,
  users,
  userTerritories,
  withTenant,
  type Db,
  type Tx,
} from '@ariforce/db';
import { hashPassword } from 'better-auth/crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type * as z from 'zod';
import type { Principal } from '../auth/principal';
import { AuditService } from '../common/audit.service';
import { TenantService } from '../common/tenant.service';
import { DB } from '../db/db.module';
import { err } from '../field/checkins.service';

const INVITE_DAYS = 7;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
type Person = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  employeeCode: string | null;
  designation: string | null;
  managerId: string | null;
  status: 'invited' | 'active' | 'suspended';
  version: number;
  roles: RoleKey[];
  rank: number;
};

/** Stub mailer: logs only the non-secret invite id; never the token or link. */
@Injectable()
export class InviteMailer {
  private readonly log = new Logger('InviteMailer');
  send(inviteId: string) {
    this.log.log(`invite ${inviteId} queued (stub mailer, nothing sent)`);
  }
}

@Injectable()
export class TeamService {
  constructor(
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
    private readonly mailer: InviteMailer,
    @Inject(DB) private readonly db: Db,
  ) {}

  private async people(tx: Tx): Promise<Map<string, Person>> {
    const rows = await tx
      .select({
        u: users,
        roles: sql<
          RoleKey[]
        >`coalesce(array_agg(${roles.key}::text) filter (where ${roles.key} is not null), '{}')`,
      })
      .from(users)
      .leftJoin(userRoles, eq(userRoles.userId, users.id))
      .leftJoin(roles, eq(roles.id, userRoles.roleId))
      .where(isNull(users.deletedAt))
      .groupBy(users.id);
    return new Map(
      rows.map(({ u, roles: r }) => [
        u.id,
        {
          id: u.id,
          name: u.name,
          email: u.email,
          phone: u.phone,
          employeeCode: u.employeeCode,
          designation: u.designation,
          managerId: u.managerId,
          status: u.status,
          version: u.version,
          roles: r,
          rank: hierarchyRank(r),
        },
      ]),
    );
  }

  private subtree(all: Map<string, Person>, root: string) {
    const ids = new Set([root]);
    for (let grew = true; grew;) {
      grew = false;
      for (const u of all.values())
        if (u.managerId && ids.has(u.managerId) && !ids.has(u.id)) {
          ids.add(u.id);
          grew = true;
        }
    }
    return ids;
  }

  /** Territories in the caller's subtree scope (null = whole company). */
  private async scopedTerritoryIds(tx: Tx, p: Principal, ids?: string[]) {
    const rows = await tx
      .select({ id: territories.id })
      .from(territories)
      .where(
        and(
          isNull(territories.deletedAt),
          ids ? inArray(territories.id, ids) : undefined,
          this.tenant.scope(p, territories.path),
        ),
      );
    return new Set(rows.map((r) => r.id));
  }

  private async nodes(tx: Tx, all: Map<string, Person>, list: [Person, number][]) {
    const ids = list.map(([u]) => u.id);
    const terr = ids.length
      ? await tx
          .select({
            userId: userTerritories.userId,
            id: territories.id,
            name: territories.name,
            code: territories.code,
            level: territories.level,
            city: territories.city,
            state: territories.state,
            centroid: territories.centroid,
          })
          .from(userTerritories)
          .innerJoin(territories, eq(territories.id, userTerritories.territoryId))
          .where(inArray(userTerritories.userId, ids))
      : [];
    const reports = new Map<string, number>();
    for (const u of all.values())
      if (u.managerId && u.status !== 'suspended')
        reports.set(u.managerId, (reports.get(u.managerId) ?? 0) + 1);
    return list.map(([u, depth]): TeamNode => {
      const top = [...u.roles].sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a])[0] ?? null;
      return {
        id: u.id,
        name: u.name,
        role: top,
        roles: u.roles,
        designation: u.designation,
        employeeCode: u.employeeCode,
        phone: u.phone,
        email: u.email,
        status: u.status,
        managerId: u.managerId,
        depth,
        directReportCount: reports.get(u.id) ?? 0,
        version: u.version,
        territories: terr
          .filter((t) => t.userId === u.id)
          .map(({ userId: _u, centroid, ...t }) => ({
            ...t,
            lat: centroid?.y ?? null,
            lng: centroid?.x ?? null,
          })),
      };
    });
  }

  private async unassigned(tx: Tx, p: Principal, all: Map<string, Person>) {
    const myRank = hierarchyRank(p.roles);
    if (myRank < MIN_MANAGER_RANK) return [];
    const cand = [...all.values()].filter(
      (u) =>
        !u.managerId &&
        u.id !== p.userId &&
        u.rank > 0 &&
        u.rank < myRank &&
        u.roles.every(isHierarchyRole),
    );
    if (!cand.length || p.scopePaths === null) return cand;
    const scoped = await this.scopedTerritoryIds(tx, p);
    const ut = await tx
      .select()
      .from(userTerritories)
      .where(
        inArray(
          userTerritories.userId,
          cand.map((c) => c.id),
        ),
      );
    return cand.filter((c) => ut.some((t) => t.userId === c.id && scoped.has(t.territoryId)));
  }

  tree(p: Principal): Promise<TeamTree> {
    return this.tenant.run(p, async (tx) => {
      const all = await this.people(tx);
      const order: [Person, number][] = [];
      const walk = (id: string, d: number) => {
        const u = all.get(id);
        if (!u) return;
        order.push([u, d]);
        for (const c of [...all.values()]
          .filter((x) => x.managerId === id && x.rank > 0)
          .sort((a, b) => a.name.localeCompare(b.name)))
          walk(c.id, d + 1);
      };
      walk(p.userId, 0);
      const un = await this.unassigned(tx, p, all);
      return {
        rootId: p.userId,
        nodes: await this.nodes(tx, all, order),
        unassigned: await this.nodes(
          tx,
          all,
          un.map((u) => [u, -1]),
        ),
      };
    });
  }

  /** Target must be strictly below the caller and in their subtree (or unassigned in their scope). */
  private async assertManageable(tx: Tx, p: Principal, all: Map<string, Person>, id: string) {
    const t = all.get(id);
    if (!t) throw err(404, 'NOT_FOUND', 'Employee not found');
    const myRank = hierarchyRank(p.roles);
    if (id === p.userId) throw err(403, 'FORBIDDEN', 'You cannot change your own record here');
    if (myRank < MIN_MANAGER_RANK || t.rank >= myRank || !t.roles.every(isHierarchyRole))
      throw err(403, 'FORBIDDEN', 'You can only manage people below your level');
    const inTree = p.scopePaths === null || this.subtree(all, p.userId).has(id);
    if (!inTree && !(await this.unassigned(tx, p, all)).some((u) => u.id === id))
      throw err(403, 'FORBIDDEN', 'Employee is outside your team');
    return t;
  }

  private assertRole(p: Principal, role: RoleKey) {
    const r = ROLE_RANK[role];
    if (!(r > 0 && r < hierarchyRank(p.roles)))
      throw err(403, 'FORBIDDEN', 'Role must be a hierarchy role below your own');
  }
  private async assertTerritories(tx: Tx, p: Principal, ids: string[]) {
    const ok = await this.scopedTerritoryIds(tx, p, ids);
    if (ids.some((i) => !ok.has(i))) throw err(403, 'FORBIDDEN', 'Territory is outside your scope');
  }
  /** Manager must be the caller or in their subtree, and rank above `belowRank`. */
  private assertManager(p: Principal, all: Map<string, Person>, mgrId: string, belowRank: number) {
    const m = all.get(mgrId);
    const inTree = p.scopePaths === null || this.subtree(all, p.userId).has(mgrId);
    if (!m || !inTree || m.status === 'suspended' || m.rank <= belowRank)
      throw err(403, 'FORBIDDEN', 'Manager must be you or someone above them in your team');
  }
  private async roleId(tx: Tx, key: RoleKey) {
    const [r] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.key, key));
    if (!r) throw err(422, 'VALIDATION', `Role ${key} is not configured`);
    return r.id;
  }

  private async issueInvite(tx: Tx, p: Principal, userId: string) {
    await tx
      .update(userInvites)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(userInvites.userId, userId),
          isNull(userInvites.usedAt),
          isNull(userInvites.revokedAt),
        ),
      );
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_DAYS * 864e5);
    const [inv] = await tx
      .insert(userInvites)
      .values({
        companyId: p.companyId,
        userId,
        tokenHash: sha256(token),
        expiresAt,
        createdBy: p.userId,
      })
      .returning({ id: userInvites.id });
    await this.audit.record(tx, p, 'employee.invited', {
      entityType: 'user',
      entityId: userId,
      after: { inviteId: inv!.id, expiresAt },
    });
    this.mailer.send(inv!.id);
    const base = process.env.WEB_ORIGIN?.split(',')[0] ?? 'http://localhost:3000';
    return {
      id: inv!.id,
      userId,
      expiresAt: expiresAt.toISOString(),
      inviteUrl:
        process.env.INVITE_RETURN_LINK === 'true'
          ? `${base}/invite?token=${encodeURIComponent(token)}`
          : null,
    };
  }

  create(p: Principal, b: z.infer<typeof EmployeeCreate>) {
    return this.tenant.run(p, async (tx) => {
      if (hierarchyRank(p.roles) < MIN_MANAGER_RANK)
        throw err(403, 'FORBIDDEN', 'Only ABM and above can add employees');
      this.assertRole(p, b.role);
      await this.assertTerritories(tx, p, b.territoryIds);
      const all = await this.people(tx);
      const mgrId = b.managerId ?? p.userId;
      this.assertManager(p, all, mgrId, ROLE_RANK[b.role]);
      const dup = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          sql`lower(${users.email}) = ${b.email.toLowerCase()}${
            b.employeeCode ? sql` or ${users.employeeCode} = ${b.employeeCode}` : sql``
          }`,
        );
      if (dup.length) throw err(409, 'CONFLICT', 'Email or employee code already exists');
      const [u] = await tx
        .insert(users)
        .values({
          companyId: p.companyId,
          email: b.email,
          name: b.name,
          phone: b.phone,
          employeeCode: b.employeeCode,
          designation: b.designation,
          managerId: mgrId,
          status: 'invited',
        })
        .returning();
      await tx
        .insert(userRoles)
        .values({ companyId: p.companyId, userId: u!.id, roleId: await this.roleId(tx, b.role) });
      await tx.insert(userTerritories).values(
        b.territoryIds.map((territoryId, i) => ({
          companyId: p.companyId,
          userId: u!.id,
          territoryId,
          isPrimary: i === 0,
        })),
      );
      await this.audit.record(tx, p, 'employee.created', {
        entityType: 'user',
        entityId: u!.id,
        after: { ...b },
      });
      const invite = await this.issueInvite(tx, p, u!.id);
      const all2 = await this.people(tx);
      const [employee] = await this.nodes(tx, all2, [[all2.get(u!.id)!, 1]]);
      return { employee: employee!, invite };
    });
  }

  update(p: Principal, id: string, b: z.infer<typeof EmployeeUpdate>) {
    return this.tenant.run(p, async (tx) => {
      const all = await this.people(tx);
      const t = await this.assertManageable(tx, p, all, id);
      if (b.version !== t.version) throw err(409, 'VERSION_CONFLICT', 'Record changed; reload');
      if (b.role) this.assertRole(p, b.role);
      if (b.territoryIds) await this.assertTerritories(tx, p, b.territoryIds);
      const newRank = b.role ? ROLE_RANK[b.role] : t.rank;
      if (b.managerId) {
        if (this.subtree(all, id).has(b.managerId)) throw err(409, 'CONFLICT', 'Reporting cycle');
        this.assertManager(p, all, b.managerId, newRank);
      }
      if (b.status === 'active' && t.status === 'invited')
        throw err(422, 'VALIDATION', 'Invited users activate by accepting their invite');
      const patch = {
        name: b.name,
        phone: b.phone,
        designation: b.designation,
        managerId: b.managerId,
        status: b.status,
        updatedAt: new Date(),
      };
      await tx.update(users).set(patch).where(eq(users.id, id));
      if (b.role) {
        await tx.delete(userRoles).where(eq(userRoles.userId, id));
        await tx
          .insert(userRoles)
          .values({ companyId: p.companyId, userId: id, roleId: await this.roleId(tx, b.role) });
      }
      if (b.territoryIds) {
        await tx.delete(userTerritories).where(eq(userTerritories.userId, id));
        await tx.insert(userTerritories).values(
          b.territoryIds.map((territoryId, i) => ({
            companyId: p.companyId,
            userId: id,
            territoryId,
            isPrimary: i === 0,
          })),
        );
      }
      await this.audit.record(
        tx,
        p,
        b.status === 'suspended' ? 'employee.deactivated' : 'employee.updated',
        { entityType: 'user', entityId: id, before: t, after: b },
      );
      const all2 = await this.people(tx);
      const [n] = await this.nodes(tx, all2, [[all2.get(id)!, 1]]);
      return n!;
    });
  }

  assignManager(p: Principal, id: string, managerId: string) {
    return this.tenant.run(p, async (tx) => {
      const all = await this.people(tx);
      const t = await this.assertManageable(tx, p, all, id);
      if (this.subtree(all, id).has(managerId)) throw err(409, 'CONFLICT', 'Reporting cycle');
      this.assertManager(p, all, managerId, t.rank);
      await tx.update(users).set({ managerId, updatedAt: new Date() }).where(eq(users.id, id));
      await this.audit.record(tx, p, 'employee.manager_assigned', {
        entityType: 'user',
        entityId: id,
        before: { managerId: t.managerId },
        after: { managerId },
      });
      const all2 = await this.people(tx);
      const [n] = await this.nodes(tx, all2, [[all2.get(id)!, 1]]);
      return n!;
    });
  }

  reinvite(p: Principal, id: string) {
    return this.tenant.run(p, async (tx) => {
      const all = await this.people(tx);
      const t = await this.assertManageable(tx, p, all, id);
      if (t.status !== 'invited') throw err(409, 'CONFLICT', 'User has already joined');
      return this.issueInvite(tx, p, id);
    });
  }

  /** Public: redeem a single-use invite, create the auth identity, activate the user. */
  async accept(token: string, password: string) {
    const r = await this.db.execute<{ invite_id: string; company_id: string; user_id: string }>(
      sql`select invite_id, company_id, user_id from invite_resolve(${sha256(token)})`,
    );
    const m = r.rows[0];
    if (!m) throw err(404, 'INVITE_INVALID', 'Invite is invalid, used, revoked or expired');
    const hash = await hashPassword(password);
    return withTenant(this.db, { companyId: m.company_id, userId: m.user_id }, async (tx) => {
      const claimed = await tx
        .update(userInvites)
        .set({ usedAt: new Date() })
        .where(and(eq(userInvites.id, m.invite_id), isNull(userInvites.usedAt)))
        .returning({ id: userInvites.id });
      if (!claimed.length) throw err(404, 'INVITE_INVALID', 'Invite already used');
      const [u] = await tx.select().from(users).where(eq(users.id, m.user_id));
      if (!u || u.authUserId) throw err(409, 'CONFLICT', 'Account already exists');
      const taken = await tx
        .select({ id: authUser.id })
        .from(authUser)
        .where(eq(authUser.email, u.email.toLowerCase()));
      if (taken.length) throw err(409, 'CONFLICT', 'Account already exists');
      const authId = randomUUID();
      await tx
        .insert(authUser)
        .values({ id: authId, name: u.name, email: u.email.toLowerCase(), emailVerified: true });
      await tx.insert(authAccount).values({
        id: randomUUID(),
        accountId: authId,
        providerId: 'credential',
        userId: authId,
        password: hash,
      });
      await tx
        .update(users)
        .set({ authUserId: authId, status: 'active', updatedAt: new Date() })
        .where(eq(users.id, u.id));
      await this.audit.record(
        tx,
        {
          companyId: m.company_id,
          userId: u.id,
          requestId: randomUUID(),
          ip: null,
          userAgent: null,
        } as Principal,
        'employee.invite_accepted',
        { entityType: 'user', entityId: u.id, after: { inviteId: m.invite_id } },
      );
      return { userId: u.id, email: u.email };
    });
  }
}
