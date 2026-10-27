import { MailService } from '../mail/mail.service';
import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { revokeUserSessions } from '../auth/revoke';
import {
  EmployeeCreate,
  assignableTerritoryLevels,
  TERRITORY_LEVELS,
  EmployeeUpdate,
  type InviteBulkItemResult,
  SignupApprove,
  MIN_MANAGER_RANK,
  ROLE_RANK,
  hierarchyRank,
  isHierarchyRole,
  isRetiredRole,
  type RoleKey,
  type TeamNode,
  type TeamTree,
} from '@ariforce/contracts';
import {
  authAccount,
  authUser,
  roles,
  signupRequests,
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
import { rejectionReason } from '../common/rejection';
import { TenantService } from '../common/tenant.service';
import { DB } from '../db/db.module';
import { err } from '../field/checkins.service';

const INVITE_DAYS = 7;
/** System admin (with users:write) may create/manage any role, including director and functional roles. */
const isAdmin = (p: Principal) =>
  p.roles.includes('system_admin') && p.permissions.includes('users:write');
const DIRECTOR_RANK = ROLE_RANK.director;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export type Person = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  employeeCode: string | null;
  designation: string | null;
  joinedOn: string | null;
  managerId: string | null;
  status: 'invited' | 'active' | 'suspended';
  hasLogin: boolean;
  version: number;
  roles: RoleKey[];
  rank: number;
};

/**
 * Invite email (item F): sends the set-password link through MailService (Resend, or a log line
 * when RESEND_API_KEY is unset). Logs never contain the token or link. Sent fire-and-forget from
 * inside the transaction: a send failure never blocks the invite (admins can resend / copy link).
 */
@Injectable()
export class InviteMailer {
  constructor(private readonly mail: MailService) {}
  send(to: string, name: string, token: string, expiresAt: Date) {
    const base = process.env.WEB_ORIGIN?.split(',')[0]?.trim() || 'http://localhost:3000';
    void this.mail.invite(to, name, `${base}/invite?token=${encodeURIComponent(token)}`, expiresAt);
  }
}

@Injectable()
export class TeamService {
  private readonly log = new Logger('TeamService');
  constructor(
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
    private readonly mailer: InviteMailer,
    @Inject(DB) private readonly db: Db,
  ) {}

  /** Read-only helpers for the team member profile (#75); call inside TenantService.run. */
  peopleFor(tx: Tx) {
    return this.people(tx);
  }
  subtreeOf(all: Map<string, Person>, root: string) {
    return this.subtree(all, root);
  }
  async nodeFor(tx: Tx, all: Map<string, Person>, id: string) {
    const u = all.get(id);
    return u ? (await this.nodes(tx, all, [[u, 0]]))[0]! : null;
  }

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
      .where(
        and(isNull(users.deletedAt), sql`${users.status}::text not in ('pending', 'rejected')`),
      )
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
          joinedOn: u.joinedOn,
          managerId: u.managerId,
          status: u.status as Person['status'], // pending/rejected filtered out above
          hasLogin: !!u.authUserId,
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
        joinedOn: u.joinedOn,
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
    if (isAdmin(p)) return t;
    if (myRank < MIN_MANAGER_RANK || t.rank >= myRank || !t.roles.every(isHierarchyRole))
      throw err(403, 'FORBIDDEN', 'You can only manage people below your level');
    const inTree = p.scopePaths === null || this.subtree(all, p.userId).has(id);
    if (!inTree && !(await this.unassigned(tx, p, all)).some((u) => u.id === id))
      throw err(403, 'FORBIDDEN', 'Employee is outside your team');
    return t;
  }

  private assertRole(p: Principal, role: RoleKey) {
    if (isRetiredRole(role))
      throw err(422, 'ROLE_RETIRED', `The ${role} role is retired and can no longer be assigned`, {
        role,
      });
    const r = ROLE_RANK[role];
    if (isAdmin(p)) return;
    if (!(r > 0 && r < hierarchyRank(p.roles)))
      throw err(403, 'FORBIDDEN', 'Role must be a hierarchy role below your own');
  }
  /**
   * Part 3: a role may only hold territories at its allowed levels (business_manager: headquarter
   * only). Checked on writes only (create, invite-bulk, PATCH with role or territories, signup
   * approve); a PATCH of unrelated fields never trips over legacy data.
   */
  private async assertTerritoryLevels(tx: Tx, roleKeys: RoleKey[], ids: string[]) {
    if (!ids.length) return;
    for (const role of roleKeys) {
      const allowed = assignableTerritoryLevels(role);
      if (allowed.length === TERRITORY_LEVELS.length) continue;
      const rows = await tx
        .select({ id: territories.id, level: territories.level })
        .from(territories)
        .where(inArray(territories.id, ids));
      const bad = rows.filter((r) => !allowed.includes(r.level)).map((r) => r.id);
      if (bad.length)
        throw err(
          422,
          'TERRITORY_LEVEL_INVALID',
          `A ${role} may only hold ${allowed.join(' or ')}-level territories`,
          { territoryIds: bad, expectedLevel: allowed[0], role },
        );
    }
  }
  private async assertTerritories(tx: Tx, p: Principal, ids: string[]) {
    const ok = await this.scopedTerritoryIds(tx, p, ids);
    if (ids.some((i) => !ok.has(i))) throw err(403, 'FORBIDDEN', 'Territory is outside your scope');
  }
  /** Manager must be the caller or in their subtree, and rank above `belowRank`. */
  private assertManager(p: Principal, all: Map<string, Person>, mgrId: string, belowRank: number) {
    const m = all.get(mgrId);
    if (belowRank >= DIRECTOR_RANK) throw err(422, 'VALIDATION', 'A director has no manager');
    if (belowRank === 0) throw err(422, 'VALIDATION', 'Functional roles have no manager');
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
    const [who] = await tx
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, userId));
    if (who?.email) this.mailer.send(who.email, who.name, token, expiresAt);
    const base = process.env.WEB_ORIGIN?.split(',')[0] ?? 'http://localhost:3000';
    return {
      id: inv!.id,
      userId,
      expiresAt: expiresAt.toISOString(),
      inviteUrl:
        process.env.INVITE_RETURN_LINK === 'true' && process.env.NODE_ENV !== 'production'
          ? `${base}/invite?token=${encodeURIComponent(token)}`
          : null,
    };
  }

  create(p: Principal, b: z.infer<typeof EmployeeCreate>) {
    return this.tenant.run(p, async (tx) => {
      const admin = isAdmin(p);
      if (!admin && hierarchyRank(p.roles) < MIN_MANAGER_RANK)
        throw err(403, 'FORBIDDEN', 'Only ABM and above can add employees');
      this.assertRole(p, b.role);
      if (isHierarchyRole(b.role) && !b.territoryIds.length)
        throw err(422, 'VALIDATION', 'Hierarchy roles need at least one territory');
      await this.assertTerritories(tx, p, b.territoryIds);
      await this.assertTerritoryLevels(tx, [b.role], b.territoryIds);
      const all = await this.people(tx);
      // System admin is outside the reporting line: no default manager; a director never has one.
      const mgrId = admin ? b.managerId : (b.managerId ?? p.userId);
      if (mgrId) this.assertManager(p, all, mgrId, ROLE_RANK[b.role]);
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
          joinedOn: b.joinedOn,
          managerId: mgrId,
          status: 'invited',
        })
        .returning();
      await tx
        .insert(userRoles)
        .values({ companyId: p.companyId, userId: u!.id, roleId: await this.roleId(tx, b.role) });
      if (b.territoryIds.length)
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

  /**
   * Bulk create + invite (#26). Every row runs the single create() (same role/scope rules, own
   * transaction, employee.created + employee.invited audit), so one bad row never blocks the rest.
   * The batch itself is audited once as employee.invite_bulk with per-row status (no emails).
   */
  async inviteBulk(p: Principal, rows: unknown[]) {
    if (!isAdmin(p) && hierarchyRank(p.roles) < MIN_MANAGER_RANK)
      throw err(403, 'FORBIDDEN', 'Only ABM and above can add employees');
    type Row = z.infer<typeof InviteBulkItemResult>;
    const results: Row[] = [];
    const seen = new Set<string>();
    for (const [index, raw] of rows.entries()) {
      const rawEmail = (raw as { email?: unknown } | null)?.email;
      const base: Row = {
        index,
        email: typeof rawEmail === 'string' ? rawEmail : null,
        status: 'failed',
        code: null,
        message: null,
        employeeId: null,
        inviteId: null,
        inviteUrl: null,
      };
      const parsed = EmployeeCreate.safeParse(raw);
      if (!parsed.success) {
        const i = parsed.error.issues[0];
        results.push({
          ...base,
          code: 'VALIDATION',
          message: i ? `${i.path.join('.') || 'row'}: ${i.message}` : 'Invalid',
        });
        continue;
      }
      const keys = [`e:${parsed.data.email.toLowerCase()}`];
      if (parsed.data.employeeCode) keys.push(`c:${parsed.data.employeeCode}`);
      if (keys.some((k) => seen.has(k))) {
        results.push({
          ...base,
          status: 'skipped',
          code: 'DUPLICATE_IN_BATCH',
          message: 'Email or employee code repeated earlier in this batch',
        });
        continue;
      }
      keys.forEach((k) => seen.add(k));
      try {
        const r = await this.create(p, parsed.data);
        results.push({
          ...base,
          status: 'invited',
          employeeId: r.employee.id,
          inviteId: r.invite.id,
          inviteUrl: r.invite.inviteUrl,
        });
      } catch (e) {
        if (!(e instanceof HttpException)) {
          this.log.error(`invite-bulk row ${index} failed: ${(e as Error).name}`);
          results.push({ ...base, code: 'INTERNAL', message: 'Unexpected error' });
          continue;
        }
        const body = e.getResponse() as { code?: string; message?: string };
        const conflict = e.getStatus() === 409;
        results.push({
          ...base,
          status: conflict ? 'skipped' : 'failed',
          code: body.code ?? (conflict ? 'CONFLICT' : 'ERROR'),
          message: body.message ?? e.message,
        });
      }
    }
    const count = (s: Row['status']) => results.filter((r) => r.status === s).length;
    const summary = {
      invited: count('invited'),
      skipped: count('skipped'),
      failed: count('failed'),
    };
    await this.tenant.run(p, (tx) =>
      this.audit.record(tx, p, 'employee.invite_bulk', {
        entityType: 'user',
        entityId: p.userId,
        after: {
          summary,
          rows: results.map(({ index, status, code, employeeId }) => ({
            index,
            status,
            code,
            employeeId,
          })),
        },
      }),
    );
    return { results, summary };
  }

  update(p: Principal, id: string, b: z.infer<typeof EmployeeUpdate>) {
    return this.tenant.run(p, async (tx) => {
      const admin = isAdmin(p);
      const all = await this.people(tx);
      const t = await this.assertManageable(tx, p, all, id);
      if (b.version !== t.version) throw err(409, 'VERSION_CONFLICT', 'Record changed; reload');
      if (!admin && (b.email !== undefined || b.employeeCode !== undefined))
        throw err(403, 'FORBIDDEN', 'Only a system admin can change email or employee code');
      if (!admin && b.managerId === null)
        throw err(422, 'VALIDATION', 'managerId cannot be cleared');
      // Re-sending a retired role the person already holds (unchanged form) is not an assignment.
      if (b.role && !(isRetiredRole(b.role) && t.roles.includes(b.role)))
        this.assertRole(p, b.role);
      if (b.territoryIds) await this.assertTerritories(tx, p, b.territoryIds);
      const beforeTerr = (
        await tx
          .select({ id: userTerritories.territoryId })
          .from(userTerritories)
          .where(eq(userTerritories.userId, id))
      ).map((r) => r.id);
      const newRoles: RoleKey[] = b.role ? [b.role] : t.roles;
      const newRank = b.role ? ROLE_RANK[b.role] : t.rank;
      const noManager = newRank === 0 || newRank >= DIRECTOR_RANK;
      const terrAfter = b.territoryIds ?? beforeTerr;
      if (newRank > 0 && !terrAfter.length)
        throw err(422, 'VALIDATION', 'Hierarchy roles need at least one territory');
      if (b.managerId) {
        if (this.subtree(all, id).has(b.managerId)) throw err(409, 'CONFLICT', 'Reporting cycle');
        this.assertManager(p, all, b.managerId, newRank);
      }
      // Functional roles and directors have no manager; moving to one clears it.
      const mgrAfter = b.managerId !== undefined ? b.managerId : noManager ? null : t.managerId;
      if (admin) {
        // Keep the reporting line valid: the (kept) manager must outrank the new role...
        if (b.role && mgrAfter && b.managerId === undefined) {
          const m = all.get(mgrAfter);
          if (!m || m.rank <= newRank)
            throw err(
              422,
              'MANAGER_RANK',
              'Current manager does not outrank the new role; set managerId',
            );
        }
        // ...and the person must still outrank their direct reports.
        if (b.role && newRank < t.rank) {
          const bad = [...all.values()].filter((u) => u.managerId === id && u.rank >= newRank);
          if (bad.length)
            throw err(
              422,
              'REPORTS_OUTRANK',
              `${bad.length} direct report(s) would outrank this role; reassign them first`,
              { userIds: bad.map((u) => u.id) },
            );
        }
      }
      if (b.role || b.territoryIds) await this.assertTerritoryLevels(tx, newRoles, terrAfter);
      if (b.status === 'active' && t.status === 'invited')
        throw err(422, 'VALIDATION', 'Invited users activate by accepting their invite');
      const statusAfter = b.status ?? t.status;
      // Never leave the company without an active system admin.
      if (
        t.roles.includes('system_admin') &&
        t.status === 'active' &&
        (!newRoles.includes('system_admin') || statusAfter !== 'active') &&
        ![...all.values()].some(
          (u) => u.id !== id && u.status === 'active' && u.roles.includes('system_admin'),
        )
      )
        throw err(422, 'LAST_SYSTEM_ADMIN', 'The company needs at least one active system admin');
      const emailChanged = b.email !== undefined && b.email !== t.email;
      if (emailChanged) {
        if (t.hasLogin)
          throw err(
            409,
            'EMAIL_LOCKED_HAS_LOGIN',
            'Email cannot change after the person has a login',
          );
        const [dup] = await tx
          .select({ id: users.id })
          .from(users)
          .where(sql`lower(${users.email}) = ${b.email!.toLowerCase()} and ${users.id} <> ${id}`);
        if (dup) throw err(409, 'EMAIL_TAKEN', 'Email already exists');
      }
      if (b.employeeCode && b.employeeCode !== t.employeeCode) {
        const [dup] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.employeeCode, b.employeeCode), sql`${users.id} <> ${id}`));
        if (dup) throw err(409, 'EMPLOYEE_CODE_TAKEN', 'Employee code already exists');
      }
      const patch = {
        name: b.name,
        email: emailChanged ? b.email : undefined,
        employeeCode: b.employeeCode,
        phone: b.phone,
        designation: b.designation,
        joinedOn: b.joinedOn,
        managerId: mgrAfter === t.managerId ? undefined : mgrAfter,
        status: b.status,
        updatedAt: new Date(),
      };
      const done = await tx
        .update(users)
        .set(patch)
        .where(and(eq(users.id, id), eq(users.version, b.version)))
        .returning({ id: users.id });
      if (!done.length) throw err(409, 'VERSION_CONFLICT', 'Record changed; reload');
      if (b.role) {
        await tx.delete(userRoles).where(eq(userRoles.userId, id));
        await tx
          .insert(userRoles)
          .values({ companyId: p.companyId, userId: id, roleId: await this.roleId(tx, b.role) });
      }
      if (b.territoryIds) {
        await tx.delete(userTerritories).where(eq(userTerritories.userId, id));
        if (b.territoryIds.length)
          await tx.insert(userTerritories).values(
            b.territoryIds.map((territoryId, i) => ({
              companyId: p.companyId,
              userId: id,
              territoryId,
              isPrimary: i === 0,
            })),
          );
      }
      const { hasLogin: _h, rank: _r, ...before } = t;
      await this.audit.record(
        tx,
        p,
        b.status === 'suspended' ? 'employee.deactivated' : 'employee.updated',
        {
          entityType: 'user',
          entityId: id,
          before: { ...before, territoryIds: beforeTerr },
          after: {
            ...before,
            ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
            managerId: mgrAfter,
            roles: newRoles,
            territoryIds: terrAfter,
            updatedAt: undefined,
          },
        },
      );
      // A pending invite follows the new email (old link revoked, new one sent).
      if (emailChanged && t.status === 'invited') await this.issueInvite(tx, p, id);
      await this.repointApprovals(tx, p, t, mgrAfter, newRank, statusAfter);
      // #79: deactivation or a role change signs the user out everywhere.
      const statusOff = b.status !== undefined && b.status !== t.status && b.status !== 'active';
      const roleChanged = b.role !== undefined && !(t.roles.length === 1 && t.roles[0] === b.role);
      if (statusOff || roleChanged) {
        const n = await revokeUserSessions(tx, id);
        await this.audit.record(tx, p, 'auth.sessions_revoked', {
          entityType: 'user',
          entityId: id,
          after: { reason: statusOff ? `status:${b.status}` : 'role_change', sessions: n },
        });
      }
      const all2 = await this.people(tx);
      const [n] = await this.nodes(tx, all2, [[all2.get(id)!, 1]]);
      return n!;
    });
  }

  /**
   * Keeps pending approvals decidable after a people change:
   * - the person's own pending first-step approvals move from the old manager to the new one;
   * - steps waiting on the person move to their manager when they are deactivated or drop below
   *   ABM (they can no longer decide). Without a manager the step stays; directors can still decide.
   */
  private async repointApprovals(
    tx: Tx,
    p: Principal,
    t: Person,
    mgrAfter: string | null,
    newRank: number,
    statusAfter: string,
  ) {
    let moved = 0;
    if (mgrAfter !== t.managerId && t.managerId && mgrAfter) {
      const r = await tx.execute(sql`
        update approval_steps s set approver_user_id = ${mgrAfter}
        from approval_requests r
        where r.id = s.request_id and r.requested_by = ${t.id} and r.state = 'pending'
          and s.step_no = r.current_step and s.step_no = 1 and s.decision = 'pending'
          and s.approver_user_id = ${t.managerId}`);
      moved += r.rowCount ?? 0;
    }
    const lost =
      (statusAfter === 'suspended' && t.status !== 'suspended') ||
      (newRank < MIN_MANAGER_RANK && t.rank >= MIN_MANAGER_RANK);
    const up = mgrAfter ?? t.managerId;
    if (lost && up) {
      const r = await tx.execute(sql`
        update approval_steps s set approver_user_id = ${up}
        from approval_requests r
        where r.id = s.request_id and r.state = 'pending' and s.step_no = r.current_step
          and s.decision = 'pending' and s.approver_user_id = ${t.id}
          and r.requested_by <> ${up}`);
      moved += r.rowCount ?? 0;
    }
    if (moved)
      await this.audit.record(tx, p, 'approval.steps_reassigned', {
        entityType: 'user',
        entityId: t.id,
        after: { steps: moved },
      });
  }

  assignManager(p: Principal, id: string, managerId: string) {
    return this.tenant.run(p, async (tx) => {
      const all = await this.people(tx);
      const t = await this.assertManageable(tx, p, all, id);
      if (this.subtree(all, id).has(managerId)) throw err(409, 'CONFLICT', 'Reporting cycle');
      this.assertManager(p, all, managerId, t.rank);
      await tx.update(users).set({ managerId, updatedAt: new Date() }).where(eq(users.id, id));
      await this.repointApprovals(tx, p, t, managerId, t.rank, t.status);
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
      if (t.hasLogin || t.status === 'suspended')
        throw err(409, 'CONFLICT', 'User has already joined');
      if (t.roles.length && t.roles.every(isRetiredRole))
        throw err(
          422,
          'ROLE_RETIRED',
          'This person holds a retired role; change their role before inviting them',
          { roles: t.roles },
        );
      // Existing employee rows without a login (e.g. imported) become 'invited' so they can accept.
      if (t.status === 'active')
        await tx
          .update(users)
          .set({ status: 'invited', updatedAt: new Date() })
          .where(eq(users.id, id));
      return this.issueInvite(tx, p, id);
    });
  }

  /** Why a token is unusable (#26): unknown/revoked → INVALID, redeemed → USED, expired → EXPIRED. */
  private async inviteFailure(tokenHash: string) {
    const r = await this.db.execute<{ s: string | null }>(
      sql`select invite_status(${tokenHash}) as s`,
    );
    const s = r.rows[0]?.s;
    if (s === 'used') return err(409, 'INVITE_USED', 'This invite has already been used');
    if (s === 'expired')
      return err(410, 'INVITE_EXPIRED', 'This invite has expired; ask for a new one');
    return err(404, 'INVITE_INVALID', 'This invite link is not valid');
  }

  /** Public: redeem a single-use invite, create the auth identity, activate the user. */
  async accept(token: string, password: string) {
    const r = await this.db.execute<{ invite_id: string; company_id: string; user_id: string }>(
      sql`select invite_id, company_id, user_id from invite_resolve(${sha256(token)})`,
    );
    const m = r.rows[0];
    if (!m) throw await this.inviteFailure(sha256(token));
    const hash = await hashPassword(password);
    return withTenant(this.db, { companyId: m.company_id, userId: m.user_id }, async (tx) => {
      const claimed = await tx
        .update(userInvites)
        .set({ usedAt: new Date() })
        .where(and(eq(userInvites.id, m.invite_id), isNull(userInvites.usedAt)))
        .returning({ id: userInvites.id });
      if (!claimed.length) throw err(409, 'INVITE_USED', 'This invite has already been used');
      const [u] = await tx.select().from(users).where(eq(users.id, m.user_id));
      if (!u || u.authUserId) throw err(409, 'INVITE_USED', 'This invite has already been used');
      const held = await tx
        .select({ key: roles.key })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(eq(userRoles.userId, u.id));
      if (held.length && held.every((x) => isRetiredRole(x.key)))
        throw err(
          422,
          'ROLE_RETIRED',
          'Your role is no longer in use; ask your administrator to update your account',
        );
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

  // ---- Sign-up requests (docs/RBAC.md "Sign-up requests") ----

  /**
   * Visibility = approval authority (one rule for both):
   * - system admin: every request;
   * - ABM+ with rank strictly above the requested hierarchy role, and either
   *   - the request names no manager (unassigned: visible to every such approver until reporting
   *     lines exist), or
   *   - the requested manager is the approver or in their subtree, or the requested territory is in
   *     their territory scope.
   * Own requests are never decidable (checked by callers).
   */
  private async canDecide(
    tx: Tx,
    p: Principal,
    all: Map<string, Person>,
    r: typeof signupRequests.$inferSelect,
  ) {
    if (isAdmin(p)) return true;
    const myRank = hierarchyRank(p.roles);
    if (myRank < MIN_MANAGER_RANK) return false;
    const rr = ROLE_RANK[r.requestedRole];
    if (!(rr > 0 && rr < myRank && isHierarchyRole(r.requestedRole))) return false;
    if (!r.requestedManagerId) return true;
    if (r.requestedManagerId === p.userId || this.subtree(all, p.userId).has(r.requestedManagerId))
      return true;
    if (r.requestedTerritoryId)
      return (await this.scopedTerritoryIds(tx, p, [r.requestedTerritoryId])).has(
        r.requestedTerritoryId,
      );
    return false;
  }

  private signupView(r: typeof signupRequests.$inferSelect, u: typeof users.$inferSelect) {
    return {
      id: r.id,
      userId: r.userId,
      name: u.name,
      email: u.email,
      phone: u.phone,
      requestedRole: r.requestedRole,
      requestedTerritoryId: r.requestedTerritoryId,
      requestedManagerId: r.requestedManagerId,
      status: r.status,
      approvedRole: r.approvedRole,
      decidedBy: r.decidedBy,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
    };
  }

  private assertCanApproveAtAll(p: Principal) {
    if (!isAdmin(p) && hierarchyRank(p.roles) < MIN_MANAGER_RANK)
      throw err(403, 'FORBIDDEN', 'Only system admins and ABM and above review sign-ups');
  }

  listSignups(p: Principal, status: 'pending' | 'approved' | 'rejected') {
    return this.tenant.run(p, async (tx) => {
      this.assertCanApproveAtAll(p);
      const rows = await tx
        .select({ r: signupRequests, u: users })
        .from(signupRequests)
        .innerJoin(users, eq(users.id, signupRequests.userId))
        .where(and(eq(signupRequests.status, status), isNull(signupRequests.deletedAt)))
        .orderBy(signupRequests.createdAt);
      const all = await this.people(tx);
      const items = [];
      for (const { r, u } of rows)
        if (r.userId !== p.userId && (await this.canDecide(tx, p, all, r)))
          items.push(this.signupView(r, u));
      return { items };
    });
  }

  private async pendingSignup(tx: Tx, p: Principal, id: string) {
    this.assertCanApproveAtAll(p);
    const [row] = await tx
      .select({ r: signupRequests, u: users })
      .from(signupRequests)
      .innerJoin(users, eq(users.id, signupRequests.userId))
      .where(and(eq(signupRequests.id, id), isNull(signupRequests.deletedAt)));
    if (!row) throw err(404, 'NOT_FOUND', 'Sign-up request not found');
    if (row.r.userId === p.userId)
      throw err(403, 'FORBIDDEN', 'You cannot decide your own sign-up request');
    const all = await this.people(tx);
    if (!(await this.canDecide(tx, p, all, row.r)))
      throw err(404, 'NOT_FOUND', 'Sign-up request not found');
    if (row.r.status !== 'pending') throw err(409, 'CONFLICT', 'Request was already decided');
    return { ...row, all };
  }

  approveSignup(p: Principal, id: string, b: z.infer<typeof SignupApprove>) {
    return this.tenant.run(p, async (tx) => {
      const { r, u, all } = await this.pendingSignup(tx, p, id);
      const admin = isAdmin(p);
      const role = b.role;
      if (isRetiredRole(role))
        throw err(
          422,
          'ROLE_RETIRED',
          `The ${role} role is retired and can no longer be assigned`,
          {
            role,
          },
        );
      const hierarchy = isHierarchyRole(role);
      if (!hierarchy && !admin)
        throw err(403, 'FORBIDDEN', 'Only a system admin can grant this role');
      if (hierarchy) this.assertRole(p, role);
      const tids = b.territoryIds ?? (r.requestedTerritoryId ? [r.requestedTerritoryId] : []);
      if (hierarchy && !tids.length)
        throw err(422, 'VALIDATION', 'At least one territory is required for this role');
      if (tids.length) await this.assertTerritories(tx, p, tids);
      await this.assertTerritoryLevels(tx, [role], tids);
      let mgrId: string | null;
      if (!hierarchy || role === 'director') {
        if (b.managerId) throw err(422, 'VALIDATION', 'This role has no manager');
        mgrId = null;
      } else {
        mgrId =
          b.managerId !== undefined
            ? b.managerId
            : (r.requestedManagerId ?? (admin ? null : p.userId));
        if (!mgrId && !admin) mgrId = p.userId;
        if (mgrId) {
          if (mgrId === u.id) throw err(422, 'VALIDATION', 'Reporting cycle');
          this.assertManager(p, all, mgrId, ROLE_RANK[role]);
        }
      }
      await tx
        .update(users)
        .set({ status: 'active', managerId: mgrId, updatedAt: new Date() })
        .where(eq(users.id, u.id));
      await tx.delete(userRoles).where(eq(userRoles.userId, u.id));
      await tx
        .insert(userRoles)
        .values({ companyId: p.companyId, userId: u.id, roleId: await this.roleId(tx, role) });
      await tx.delete(userTerritories).where(eq(userTerritories.userId, u.id));
      if (tids.length)
        await tx.insert(userTerritories).values(
          tids.map((territoryId, i) => ({
            companyId: p.companyId,
            userId: u.id,
            territoryId,
            isPrimary: i === 0,
          })),
        );
      const [done] = await tx
        .update(signupRequests)
        .set({ status: 'approved', approvedRole: role, decidedBy: p.userId, decidedAt: new Date() })
        .where(eq(signupRequests.id, r.id))
        .returning();
      await this.audit.record(tx, p, 'signup.approved', {
        entityType: 'signup_request',
        entityId: r.id,
        before: { requestedRole: r.requestedRole },
        after: { userId: u.id, role, territoryIds: tids, managerId: mgrId },
      });
      return this.signupView(done!, { ...u, status: 'active' });
    });
  }

  rejectSignup(p: Principal, id: string, why: string | null) {
    const reason = rejectionReason('reject', why);
    return this.tenant.run(p, async (tx) => {
      const { r, u } = await this.pendingSignup(tx, p, id);
      await tx
        .update(users)
        .set({ status: 'rejected', updatedAt: new Date() })
        .where(eq(users.id, u.id));
      const [done] = await tx
        .update(signupRequests)
        .set({ status: 'rejected', reason, decidedBy: p.userId, decidedAt: new Date() })
        .where(eq(signupRequests.id, r.id))
        .returning();
      await this.audit.record(tx, p, 'signup.rejected', {
        entityType: 'signup_request',
        entityId: r.id,
        after: { userId: u.id, reason },
      });
      return this.signupView(done!, u);
    });
  }
}
