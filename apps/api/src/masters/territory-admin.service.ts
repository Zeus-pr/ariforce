import { Injectable } from '@nestjs/common';
import {
  TERRITORY_LEVELS,
  territoryCodeFor,
  type Territory,
  type TerritoryCreate,
  type TerritoryHealth,
  type TerritoryLevel,
  type TerritoryMove,
  type TerritoryUpdate,
} from '@ariforce/contracts';
import { territories, type Tx } from '@ariforce/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Principal } from '../auth/principal';
import { AuditService } from '../common/audit.service';
import { TenantService } from '../common/tenant.service';
import { err } from '../field/checkins.service';
import { childPath } from './territory-path';

const isAdmin = (p: Principal) =>
  (p.roles.includes('system_admin') || p.roles.includes('director') || p.roles.includes('hr')) &&
  p.permissions.includes('users:write');

const keyOf = (raw: string) =>
  raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim() || null;

type Row = typeof territories.$inferSelect;

@Injectable()
export class TerritoryAdminService {
  constructor(
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
  ) {}

  private gate(p: Principal) {
    if (!isAdmin(p))
      throw err(403, 'FORBIDDEN', 'Only a director or system admin can change the map');
  }

  private dto(r: Row): Territory {
    return {
      id: r.id,
      companyId: r.companyId,
      parentId: r.parentId,
      level: r.level,
      code: r.code,
      name: r.name,
      path: r.path,
      centroid: null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
      version: r.version,
    };
  }

  private async live(tx: Tx, id: string) {
    const [row] = await tx
      .select()
      .from(territories)
      .where(and(eq(territories.id, id), isNull(territories.deletedAt)));
    if (!row) throw err(404, 'NOT_FOUND', 'That place was not found');
    return row;
  }

  private parentLevel(level: TerritoryLevel): TerritoryLevel | null {
    const i = TERRITORY_LEVELS.indexOf(level);
    return i <= 0 ? null : TERRITORY_LEVELS[i - 1]!;
  }

  private async takenCodes(tx: Tx) {
    const rows = await tx.select({ code: territories.code }).from(territories);
    return new Set(rows.map((r) => r.code.toUpperCase()));
  }

  private async takenPaths(tx: Tx, exceptPrefix?: string) {
    const rows = await tx.select({ path: territories.path }).from(territories);
    return new Set(
      rows
        .map((r) => r.path)
        .filter((p) => !exceptPrefix || (p !== exceptPrefix && !p.startsWith(`${exceptPrefix}.`))),
    );
  }

  private uniqueCode(base: string, taken: Set<string>) {
    const root = base.slice(0, 32) || 'PLACE';
    if (!taken.has(root.toUpperCase())) return root;
    for (let n = 2; n < 1000; n++) {
      const suffix = `-${n}`;
      const code = `${root.slice(0, 32 - suffix.length)}${suffix}`;
      if (!taken.has(code.toUpperCase())) return code;
    }
    throw err(409, 'CODE_TAKEN', 'That code is already used');
  }

  private async assertParent(tx: Tx, level: TerritoryLevel, parentId: string | null) {
    const expect = this.parentLevel(level);
    if (!expect) {
      if (parentId) throw err(422, 'TERRITORY_PARENT_LEVEL', 'The country has no parent');
      const [existing] = await tx
        .select({ id: territories.id })
        .from(territories)
        .where(and(eq(territories.level, 'national'), isNull(territories.deletedAt)))
        .limit(1);
      if (existing) throw err(409, 'NATIONAL_EXISTS', 'The company already has a country');
      return null;
    }
    if (!parentId)
      throw err(422, 'TERRITORY_PARENT_LEVEL', `A ${level.replace('_', ' ')} needs a ${expect}`);
    const parent = await this.live(tx, parentId);
    if (parent.level !== expect)
      throw err(422, 'TERRITORY_PARENT_LEVEL', `Put this under a ${expect}, not a ${parent.level}`);
    return parent;
  }

  private async rewritePaths(tx: Tx, id: string, oldPath: string, newPath: string) {
    if (oldPath === newPath) return;
    await tx.execute(sql`
      update territories
      set path = ${newPath} || substring(path from ${oldPath.length + 1}::int)
      where id <> ${id}::uuid
        and (path = ${oldPath} or starts_with(path, ${oldPath} || '.'))`);
  }

  async create(p: Principal, b: TerritoryCreate): Promise<Territory> {
    this.gate(p);
    return this.tenant.run(p, async (tx) => {
      const parent = await this.assertParent(tx, b.level, b.parentId);
      const taken = await this.takenCodes(tx);
      let code: string;
      let territoryKey: string | null = null;
      if (b.level === 'territory') {
        const key = keyOf(b.name);
        if (!key) throw err(422, 'VALIDATION', 'Enter a name for this territory');
        if (!parent) throw err(422, 'TERRITORY_PARENT_LEVEL', 'A territory sits under a BM HQ');
        territoryKey = key;
        const [clash] = await tx
          .select({ id: territories.id })
          .from(territories)
          .where(
            and(
              eq(territories.parentId, parent.id),
              eq(territories.territoryKey, key),
              isNull(territories.deletedAt),
            ),
          )
          .limit(1);
        if (clash)
          throw err(
            409,
            'TERRITORY_KEY_TAKEN',
            'This BM HQ already has a territory with that name',
          );
        code = this.uniqueCode(territoryCodeFor(parent.code, key), taken);
      } else if (b.code) {
        code = b.code.trim().toUpperCase();
        if (taken.has(code)) throw err(409, 'CODE_TAKEN', 'That code is already used');
      } else {
        code = this.uniqueCode(this.codeFromName(b.name), taken);
      }
      const id = uuidv7();
      const paths = await this.takenPaths(tx);
      const path = childPath(parent?.id, parent?.path, code, id, paths);
      const [row] = await tx
        .insert(territories)
        .values({
          id,
          companyId: p.companyId,
          parentId: parent?.id ?? null,
          level: b.level,
          code,
          name: b.name.trim(),
          path,
          territoryKey,
        })
        .returning();
      const dto = this.dto(row!);
      await this.audit.record(tx, p, 'territory.created', {
        entityType: 'territory',
        entityId: dto.id,
        after: { name: dto.name, code: dto.code, level: dto.level, parentId: dto.parentId },
      });
      return dto;
    });
  }

  private codeFromName(name: string) {
    const code = name
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32);
    return code || 'PLACE';
  }

  async update(p: Principal, id: string, b: TerritoryUpdate): Promise<Territory> {
    this.gate(p);
    return this.tenant.run(p, async (tx) => {
      const before = await this.live(tx, id);
      if (before.version !== b.version)
        throw err(
          409,
          'VERSION_CONFLICT',
          'This place changed. Reload it and try again',
          this.dto(before),
        );
      const name = b.name?.trim() ?? before.name;
      let code = before.code;
      let territoryKey = before.territoryKey;
      let path = before.path;
      if (before.level === 'territory') {
        if (name !== before.name) {
          const key = keyOf(name);
          if (!key) throw err(422, 'VALIDATION', 'Enter a name for this territory');
          const [clash] = await tx
            .select({ id: territories.id })
            .from(territories)
            .where(
              and(
                eq(territories.parentId, before.parentId!),
                eq(territories.territoryKey, key),
                isNull(territories.deletedAt),
              ),
            )
            .limit(1);
          if (clash && clash.id !== id)
            throw err(
              409,
              'TERRITORY_KEY_TAKEN',
              'This BM HQ already has a territory with that name',
            );
          const parent = await this.live(tx, before.parentId!);
          const taken = await this.takenCodes(tx);
          taken.delete(before.code.toUpperCase());
          code = this.uniqueCode(territoryCodeFor(parent.code, key), taken);
          territoryKey = key;
        }
      } else if (b.code && b.code.trim().toUpperCase() !== before.code.toUpperCase()) {
        const next = b.code.trim().toUpperCase();
        const taken = await this.takenCodes(tx);
        if (taken.has(next)) throw err(409, 'CODE_TAKEN', 'That code is already used');
        code = next;
      }
      if (code !== before.code) {
        const parent = before.parentId ? await this.live(tx, before.parentId) : null;
        const paths = await this.takenPaths(tx, before.path);
        path = childPath(parent?.id, parent?.path, code, before.id, paths);
      }
      const [row] = await tx
        .update(territories)
        .set({ name, code, territoryKey, path })
        .where(and(eq(territories.id, id), eq(territories.version, b.version)))
        .returning();
      if (!row) throw err(409, 'VERSION_CONFLICT', 'This place changed. Reload it and try again');
      if (path !== before.path) await this.rewritePaths(tx, id, before.path, path);
      const dto = this.dto(row);
      await this.audit.record(tx, p, 'territory.updated', {
        entityType: 'territory',
        entityId: id,
        before: {
          name: before.name,
          code: before.code,
          level: before.level,
          parentId: before.parentId,
        },
        after: { name: dto.name, code: dto.code, level: dto.level, parentId: dto.parentId },
      });
      return dto;
    });
  }

  async move(p: Principal, id: string, b: TerritoryMove): Promise<Territory> {
    this.gate(p);
    return this.tenant.run(p, async (tx) => {
      const before = await this.live(tx, id);
      if (before.version !== b.version)
        throw err(
          409,
          'VERSION_CONFLICT',
          'This place changed. Reload it and try again',
          this.dto(before),
        );
      const parent = await this.assertParent(tx, before.level, b.parentId);
      if (!parent) throw err(422, 'TERRITORY_PARENT_LEVEL', 'The country cannot be moved');
      if (
        parent.id === id ||
        parent.path === before.path ||
        parent.path.startsWith(`${before.path}.`)
      )
        throw err(422, 'TERRITORY_CYCLE', 'A place cannot be moved under itself');
      const paths = await this.takenPaths(tx, before.path);
      const path = childPath(parent.id, parent.path, before.code, before.id, paths);
      const [row] = await tx
        .update(territories)
        .set({ parentId: parent.id, path })
        .where(and(eq(territories.id, id), eq(territories.version, b.version)))
        .returning();
      if (!row) throw err(409, 'VERSION_CONFLICT', 'This place changed. Reload it and try again');
      await this.rewritePaths(tx, id, before.path, path);
      const kids = await tx.execute<{ n: number }>(sql`
        select count(*)::int n from territories
        where path = ${path} or starts_with(path, ${path} || '.')`);
      await this.audit.record(tx, p, 'territory.moved', {
        entityType: 'territory',
        entityId: id,
        before: { parentId: before.parentId },
        after: { parentId: parent.id, descendants: Math.max(0, Number(kids.rows[0]?.n ?? 1) - 1) },
      });
      return this.dto(row);
    });
  }

  async remove(p: Principal, id: string): Promise<void> {
    this.gate(p);
    await this.tenant.run(p, async (tx) => {
      const row = await this.live(tx, id);
      const counts = await tx.execute<{
        children: number;
        people: number;
        doctors: number;
        chemists: number;
        stockists: number;
        sfc_routes: number;
        allowance_places: number;
        product_hq_mappings: number;
      }>(sql`
        select
          (select count(*)::int from territories c where c.parent_id = ${id}::uuid and c.deleted_at is null) as children,
          (select count(*)::int from user_territories ut join users u on u.id = ut.user_id and u.deleted_at is null where ut.territory_id = ${id}::uuid) as people,
          (select count(*)::int from doctors d where d.deleted_at is null and (d.territory_id = ${id}::uuid or d.local_territory_id = ${id}::uuid)) as doctors,
          (select count(*)::int from chemists d where d.deleted_at is null and (d.territory_id = ${id}::uuid or d.local_territory_id = ${id}::uuid)) as chemists,
          (select count(*)::int from stockists d where d.deleted_at is null and (d.territory_id = ${id}::uuid or d.local_territory_id = ${id}::uuid)) as stockists,
          (select count(*)::int from sfc_routes s where s.deleted_at is null and s.hq_territory_id = ${id}::uuid) as sfc_routes,
          (select count(*)::int from allowance_places a where a.deleted_at is null and a.hq_territory_id = ${id}::uuid) as allowance_places,
          (select count(*)::int from product_hq_mappings m where m.deleted_at is null and m.territory_id = ${id}::uuid) as product_hq_mappings`);
      const c = counts.rows[0]!;
      const details = {
        children: c.children,
        people: c.people,
        doctors: c.doctors,
        chemists: c.chemists,
        stockists: c.stockists,
        sfcRoutes: c.sfc_routes,
        allowancePlaces: c.allowance_places,
        productHqMappings: c.product_hq_mappings,
      };
      if (Object.values(details).some((n) => n > 0))
        throw err(409, 'TERRITORY_IN_USE', 'This place is still in use', details);
      await tx
        .update(territories)
        .set({ deletedAt: sql`now()` })
        .where(eq(territories.id, id));
      await this.audit.record(tx, p, 'territory.deleted', {
        entityType: 'territory',
        entityId: id,
        before: { name: row.name, code: row.code, level: row.level, parentId: row.parentId },
      });
    });
  }

  async health(p: Principal): Promise<TerritoryHealth> {
    this.gate(p);
    return this.tenant.run(p, async (tx) => {
      const r = await tx.execute<{
        code: TerritoryHealth['items'][number]['code'];
        count: number;
        people: { id: string; name: string; territoryId: string | null }[];
        places: { id: string; name: string }[];
      }>(sql`
        with live as (
          select u.id, u.name,
            coalesce(max(r.rank), 0) as rank,
            bool_or(r.key = 'business_manager') as is_bm
          from users u
          join user_roles ur on ur.user_id = u.id
          join roles r on r.id = ur.role_id and r.deleted_at is null
          where u.deleted_at is null and u.status in ('active', 'invited')
          group by u.id
          having coalesce(max(r.rank), 0) >= 1
        ),
        no_place as (
          select id, name from live l
          where not exists (
            select 1 from user_territories ut
            join territories t on t.id = ut.territory_id and t.deleted_at is null
            where ut.user_id = l.id)
        ),
        no_hq as (
          select id, name from live l
          where not exists (
            select 1 from user_territories ut
            join territories t on t.id = ut.territory_id and t.deleted_at is null and t.level = 'headquarter'
            where ut.user_id = l.id)
        ),
        bm_no_hq as (
          select id, name from live l
          where l.rank = 1 and l.is_bm and not exists (
            select 1 from user_territories ut
            join territories t on t.id = ut.territory_id and t.deleted_at is null and t.level = 'headquarter'
            where ut.user_id = l.id)
        ),
        empty_hq as (
          select h.id, h.name from territories h
          where h.deleted_at is null and h.level = 'headquarter' and not exists (
            select 1 from user_territories ut
            join live l on l.id = ut.user_id and l.is_bm and l.rank = 1
            where ut.territory_id = h.id)
        ),
        empty_area as (
          select a.id, a.name from territories a
          where a.deleted_at is null and a.level = 'area' and not exists (
            select 1 from user_territories ut join live l on l.id = ut.user_id
            where ut.territory_id = a.id)
        )
        select 'no_territory' as code,
          (select count(*)::int from no_place) as count,
          coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'territoryId', tid)) from (select id, name, null::uuid as tid from no_place order by name limit 12) s), '[]') as people,
          '[]'::jsonb as places
        union all
        select 'sfc_hq_invisible',
          (select count(*)::int from no_hq),
          coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'territoryId', tid)) from (
            select l.id, l.name, (
              select ut.territory_id from user_territories ut
              join territories t on t.id = ut.territory_id and t.deleted_at is null
              where ut.user_id = l.id limit 1) as tid
            from no_hq l order by l.name limit 12) s), '[]'),
          '[]'::jsonb
        union all
        select 'bm_without_hq',
          (select count(*)::int from bm_no_hq),
          coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'territoryId', tid)) from (
            select l.id, l.name, (
              select ut.territory_id from user_territories ut
              join territories t on t.id = ut.territory_id and t.deleted_at is null
              where ut.user_id = l.id limit 1) as tid
            from bm_no_hq l order by l.name limit 12) s), '[]'),
          '[]'::jsonb
        union all
        select 'hq_without_bm',
          (select count(*)::int from empty_hq),
          '[]'::jsonb,
          coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name)) from (select id, name from empty_hq order by name limit 12) s), '[]')
        union all
        select 'area_without_holder',
          (select count(*)::int from empty_area),
          '[]'::jsonb,
          coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name)) from (select id, name from empty_area order by name limit 12) s), '[]')
        union all
        select 'assignment_to_deleted',
          (select count(*)::int from user_territories ut
            join users u on u.id = ut.user_id and u.deleted_at is null
            join territories t on t.id = ut.territory_id and t.deleted_at is not null),
          '[]'::jsonb,
          '[]'::jsonb`);
      return {
        items: r.rows.map((x) => ({
          code: x.code,
          count: Number(x.count),
          people: Array.isArray(x.people) ? x.people : [],
          places: Array.isArray(x.places) ? x.places : [],
        })),
      };
    });
  }
}
