import { Injectable } from '@nestjs/common';
import {
  ROLE_RANK,
  type RoleKey,
  type SfcEmployee,
  type SfcHq,
  type SfcRoute,
  type SfcSettings,
  type SfcTable,
  type SfcTablePut,
  hierarchyRank,
  sfcAmounts,
} from '@ariforce/contracts';
import { companies, sfcRoutes, type Tx } from '@ariforce/db';
import { and, eq, sql } from 'drizzle-orm';
import type { Principal } from '../auth/principal';
import { AuditService } from '../common/audit.service';
import { TenantService } from '../common/tenant.service';
import { err } from '../field/checkins.service';

type Row = typeof sfcRoutes.$inferSelect;
const num = (v: string | null) => (v === null ? null : Number(v));
const toRoute = (r: Row): SfcRoute => ({
  id: r.id,
  sortOrder: r.sortOrder,
  fromPlace: r.fromPlace,
  toPlace: r.toPlace,
  oneWayKm: Number(r.oneWayKm),
  bothWayKm: Number(r.bothWayKm),
  oneWayAmount: num(r.oneWayAmount),
  bothWayAmount: num(r.bothWayAmount),
  actualFare: r.actualFare,
  travelMode: r.travelMode,
  category: r.category,
  da: num(r.da),
  version: r.version,
  updatedAt: r.updatedAt.toISOString(),
});
const topRole = (keys: RoleKey[]) =>
  [...keys].sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a])[0] ?? null;

/**
 * SFC (Standard Fare Chart), docs/SFC.md. Visibility: director and system_admin company-wide,
 * everyone else their reporting line (teamUserIds, includes self) OR lower-ranked holders of
 * territories inside their own territories (see visible()). Only sales-hierarchy employees
 * (rank >= 1) have an SFC. Edit: sfc:write, and never your own table unless system_admin.
 */
@Injectable()
export class SfcService {
  constructor(
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
  ) {}

  private wide(p: Principal) {
    return p.teamUserIds === null || p.roles.includes('system_admin');
  }

  /**
   * SQL predicate on a users.id expression for "visible to the caller". A non-wide caller covers an
   * employee through EITHER mechanism: the reporting line (users.manager_id, teamUserIds) OR the
   * territory tree (the employee holds a territory inside one of the caller's own territories and
   * ranks strictly below the caller). E.g. an ABM on the HQ-BURDWAN area covers the BMs on its HQs
   * even before their managerId points at the ABM.
   */
  private visible(p: Principal, col: ReturnType<typeof sql.raw>) {
    if (this.wide(p)) return sql`true`;
    const ids = p.teamUserIds ?? [];
    const team = ids.length
      ? sql`${col} = any(${sql`array[${sql.join(
          ids.map((i) => sql`${i}::uuid`),
          sql`, `,
        )}]`})`
      : sql`false`;
    const myRank = hierarchyRank(p.roles);
    if (myRank < 1) return team;
    return sql`(${team} or (
      exists (select 1 from user_territories ut
        join territories t on t.id = ut.territory_id and t.deleted_at is null
        join user_territories mine on mine.user_id = ${p.userId}::uuid
        join territories mt on mt.id = mine.territory_id and mt.deleted_at is null
        where ut.user_id = ${col} and (t.path = mt.path or starts_with(t.path, mt.path || '.')))
      and (select coalesce(max(r.rank), 0) from user_roles ur join roles r on r.id = ur.role_id
        where ur.user_id = ${col} and r.deleted_at is null) < ${myRank}))`;
  }

  /** Only ever called with a user already in the caller's visible set (salesUsers / target). */
  canEdit(p: Principal, userId: string) {
    if (!p.permissions.includes('sfc:write')) return false;
    if (p.roles.includes('system_admin')) return true;
    return userId !== p.userId;
  }

  private async rate(tx: Tx, p: Principal) {
    const [c] = await tx
      .select({ rate: companies.sfcRatePerKm, version: companies.version })
      .from(companies)
      .where(eq(companies.id, p.companyId));
    if (!c) throw new Error('company row not visible');
    return { ratePerKm: Number(c.rate), version: c.version };
  }

  settings(p: Principal): Promise<SfcSettings> {
    return this.tenant.run(p, (tx) => this.rate(tx, p));
  }

  putSettings(p: Principal, b: SfcSettings): Promise<SfcSettings> {
    return this.tenant.run(p, async (tx) => {
      const before = await this.rate(tx, p);
      const [row] = await tx
        .update(companies)
        .set({ sfcRatePerKm: b.ratePerKm.toFixed(2) })
        .where(and(eq(companies.id, p.companyId), eq(companies.version, b.version)))
        .returning({ id: companies.id });
      if (!row) throw err(409, 'VERSION_CONFLICT', 'Stale version', before);
      const after = await this.rate(tx, p);
      await this.audit.record(tx, p, 'sfc.rate_changed', {
        entityType: 'company',
        entityId: p.companyId,
        before,
        after,
      });
      return after;
    });
  }

  /** Sales-hierarchy users visible to the caller, with their top role. */
  private salesUsers = (p: Principal) => sql`
    select u.id, u.name, u.employee_code,
      array_agg(r.key::text) as roles
    from users u
    join user_roles ur on ur.user_id = u.id
    join roles r on r.id = ur.role_id
    where u.deleted_at is null and u.status in ('active', 'invited')
      and ${this.visible(p, sql.raw('u.id'))}
    group by u.id
    having max(r.rank) >= 1`;

  hqs(p: Principal): Promise<{ items: SfcHq[] }> {
    return this.tenant.run(p, async (tx) => {
      const scope = this.tenant.scope(p, sql.raw('t.path') as never) ?? sql`true`;
      const rows = await tx.execute<{
        id: string;
        name: string;
        code: string | null;
        level: SfcHq['level'];
        parent_id: string | null;
        parent_name: string | null;
        employee_count: number;
        route_count: number;
      }>(sql`
        with su as (${this.salesUsers(p)})
        select t.id, t.name, t.code, t.level::text as level, t.parent_id, pt.name as parent_name,
          (select count(distinct ut.user_id)::int from user_territories ut
             join su on su.id = ut.user_id where ut.territory_id = t.id) as employee_count,
          (select count(*)::int from sfc_routes s join su on su.id = s.user_id
             where s.hq_territory_id = t.id and s.deleted_at is null) as route_count
        from territories t
        left join territories pt on pt.id = t.parent_id
        where t.deleted_at is null and t.level = 'headquarter' and ${scope}
        order by t.name, t.id`);
      return {
        items: rows.rows.map((r) => ({
          id: r.id,
          name: r.name,
          code: r.code,
          level: r.level,
          parentId: r.parent_id,
          parentName: r.parent_name,
          employeeCount: r.employee_count,
          routeCount: r.route_count,
        })),
      };
    });
  }

  employees(p: Principal, territoryId?: string): Promise<{ items: SfcEmployee[] }> {
    return this.tenant.run(p, async (tx) => {
      const under = territoryId
        ? sql`and exists (select 1 from user_territories ut2
             join territories t2 on t2.id = ut2.territory_id
             join territories root on root.id = ${territoryId}::uuid
             where ut2.user_id = su.id and (t2.path = root.path or starts_with(t2.path, root.path || '.')))`
        : sql``;
      const rows = await tx.execute<{
        id: string;
        name: string;
        employee_code: string | null;
        roles: RoleKey[];
        hq_ids: string[] | null;
        route_count: number;
      }>(sql`
        with su as (${this.salesUsers(p)})
        select su.id, su.name, su.employee_code, su.roles,
          (select array_agg(t.id::text order by t.name) from user_territories ut
             join territories t on t.id = ut.territory_id
             where ut.user_id = su.id and t.deleted_at is null and t.level = 'headquarter') as hq_ids,
          (select count(*)::int from sfc_routes s where s.user_id = su.id and s.deleted_at is null) as route_count
        from su where true ${under}
        order by su.name, su.id`);
      return {
        items: rows.rows.map((r) => {
          const role = topRole(r.roles);
          return {
            id: r.id,
            name: r.name,
            employeeCode: r.employee_code,
            role,
            rank: role ? ROLE_RANK[role] : 0,
            hqTerritoryIds: r.hq_ids ?? [],
            routeCount: r.route_count,
            hasSfc: r.route_count > 0,
            canEdit: this.canEdit(p, r.id),
          };
        }),
      };
    });
  }

  private async target(tx: Tx, p: Principal, userId: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId))
      throw err(404, 'NOT_FOUND', 'Employee not found or not visible');
    const r = await tx.execute<{ id: string; name: string }>(sql`
      with su as (${this.salesUsers(p)}) select id, name from su where id = ${userId}::uuid`);
    const u = r.rows[0];
    if (!u) throw err(404, 'NOT_FOUND', 'Employee not found or not visible');
    return u;
  }

  private async etag(tx: Tx, userId: string) {
    const r = await tx.execute<{ e: string | null }>(sql`
      select md5(string_agg(id::text || ':' || version, ',' order by id)) as e
      from sfc_routes where user_id = ${userId}::uuid`);
    return r.rows[0]?.e ?? '';
  }

  private async table(tx: Tx, p: Principal, u: { id: string; name: string }): Promise<SfcTable> {
    const rows = await tx
      .select()
      .from(sfcRoutes)
      .where(and(eq(sfcRoutes.userId, u.id), sql`${sfcRoutes.deletedAt} is null`))
      .orderBy(sfcRoutes.sortOrder, sfcRoutes.createdAt);
    let hq = rows[0]?.hqTerritoryId ?? null;
    if (!hq) {
      const h = await tx.execute<{ id: string }>(sql`
        select t.id from user_territories ut join territories t on t.id = ut.territory_id
        where ut.user_id = ${u.id}::uuid and t.deleted_at is null and t.level = 'headquarter'
        order by ut.is_primary desc, t.name limit 1`);
      hq = h.rows[0]?.id ?? null;
    }
    return {
      userId: u.id,
      userName: u.name,
      hqTerritoryId: hq,
      ratePerKm: (await this.rate(tx, p)).ratePerKm,
      etag: await this.etag(tx, u.id),
      canEdit: this.canEdit(p, u.id),
      routes: rows.map(toRoute),
    };
  }

  get(p: Principal, userId: string): Promise<SfcTable> {
    return this.tenant.run(p, async (tx) => this.table(tx, p, await this.target(tx, p, userId)));
  }

  put(p: Principal, userId: string, b: SfcTablePut): Promise<SfcTable> {
    return this.tenant.run(p, async (tx) => {
      const u = await this.target(tx, p, userId);
      if (!this.canEdit(p, u.id))
        throw err(403, 'FORBIDDEN', 'Needs sfc:write over this employee (never your own table)');
      // Serialise writers of one table (covers the empty-table case where no row can be locked).
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('sfc:' || ${u.id}))`);
      const current = await this.etag(tx, u.id);
      if (current !== b.etag)
        throw err(409, 'VERSION_CONFLICT', 'SFC changed since it was loaded', { etag: current });
      const hq = await tx.execute(sql`
        select 1 from user_territories where user_id = ${u.id}::uuid
          and territory_id = ${b.hqTerritoryId}::uuid`);
      if (!hq.rows.length)
        throw err(422, 'SFC_HQ_NOT_ASSIGNED', 'hqTerritoryId is not assigned to this employee');
      const before = await tx
        .select()
        .from(sfcRoutes)
        .where(and(eq(sfcRoutes.userId, u.id), sql`${sfcRoutes.deletedAt} is null`));
      const byId = new Map(before.map((r) => [r.id, r]));
      const seen = new Set<string>();
      for (const r of b.routes) {
        if (!r.id) continue;
        if (!byId.has(r.id) || seen.has(r.id))
          throw err(
            422,
            'SFC_ROUTE_NOT_FOUND',
            `Route ${r.id} is not a live route of this employee`,
          );
        seen.add(r.id);
      }
      const { ratePerKm } = await this.rate(tx, p);
      for (const [i, r] of b.routes.entries()) {
        const a = sfcAmounts(r.oneWayKm, r.actualFare, ratePerKm);
        const vals = {
          hqTerritoryId: b.hqTerritoryId,
          sortOrder: i + 1,
          fromPlace: r.fromPlace,
          toPlace: r.toPlace,
          oneWayKm: r.oneWayKm.toFixed(2),
          bothWayKm: a.bothWayKm.toFixed(2),
          oneWayAmount: a.oneWayAmount === null ? null : a.oneWayAmount.toFixed(2),
          bothWayAmount: a.bothWayAmount === null ? null : a.bothWayAmount.toFixed(2),
          actualFare: r.actualFare,
          travelMode: r.travelMode,
          category: r.category,
          da: r.da === null ? null : r.da.toFixed(2),
        };
        const old = r.id ? byId.get(r.id) : undefined;
        if (old) {
          const same = (Object.keys(vals) as (keyof typeof vals)[]).every(
            (k) => String(old[k] ?? '') === String(vals[k] ?? ''),
          );
          if (!same)
            await tx
              .update(sfcRoutes)
              .set({ ...vals, updatedBy: p.userId })
              .where(eq(sfcRoutes.id, old.id));
        } else {
          await tx.insert(sfcRoutes).values({
            ...vals,
            companyId: p.companyId,
            userId: u.id,
            createdBy: p.userId,
            updatedBy: p.userId,
          });
        }
      }
      for (const old of before)
        if (!seen.has(old.id))
          await tx
            .update(sfcRoutes)
            .set({ deletedAt: new Date(), updatedBy: p.userId })
            .where(eq(sfcRoutes.id, old.id));
      const out = await this.table(tx, p, u);
      await this.audit.record(tx, p, 'sfc.routes_saved', {
        entityType: 'user',
        entityId: u.id,
        before: { hqTerritoryId: before[0]?.hqTerritoryId ?? null, routes: before.map(toRoute) },
        after: { hqTerritoryId: out.hqTerritoryId, routes: out.routes },
      });
      return out;
    });
  }
}
