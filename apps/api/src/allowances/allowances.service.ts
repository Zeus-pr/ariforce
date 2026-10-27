import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AllowancePlace,
  AllowancePlaceInput,
  AllowanceRate,
  AllowanceRateInput,
} from '@ariforce/contracts';
import { allowancePlaces, allowanceRates, roles, territories, type Tx } from '@ariforce/db';
import { and, asc, eq, ilike, isNull, ne, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Principal } from '../auth/principal';
import { AuditService } from '../common/audit.service';
import { TenantService } from '../common/tenant.service';
import { err } from '../field/checkins.service';

type RateRow = typeof allowanceRates.$inferSelect;
type PlaceRow = typeof allowancePlaces.$inferSelect;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** TA/DA rate card and standard fare chart (#39). Writes need settings:write (controller). */
@Injectable()
export class AllowancesService {
  constructor(
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
  ) {}

  /** Reps and managers read with expenses:read; admins with settings:write. */
  private canRead(p: Principal) {
    if (
      !(['expenses:read', 'expenses:pay', 'settings:write'] as const).some((k) =>
        p.permissions.includes(k),
      )
    )
      throw new ForbiddenException(
        'Missing permission: expenses:read, expenses:pay or settings:write',
      );
  }

  private rateDto(r: RateRow, roleKey: string | null): AllowanceRate {
    return {
      id: r.id,
      band: r.band,
      roleKey: roleKey as AllowanceRate['roleKey'],
      effectiveFrom: r.effectiveFrom,
      daAmount: Number(r.daAmount),
      taPerKm: Number(r.taPerKm),
      taFixed: Number(r.taFixed),
      updatedAt: r.updatedAt.toISOString(),
      version: r.version,
    };
  }

  private placeDto(r: PlaceRow, hqName: string): AllowancePlace {
    return {
      id: r.id,
      hqTerritoryId: r.hqTerritoryId,
      hqName,
      name: r.name,
      band: r.band,
      oneWayKm: Number(r.oneWayKm),
      active: r.active,
      updatedAt: r.updatedAt.toISOString(),
      version: r.version,
    };
  }

  // ---- rates ----

  listRates(p: Principal, q: { band?: string; roleKey?: string }) {
    this.canRead(p);
    return this.tenant.run(p, async (tx) => {
      const rows = await tx
        .select({ r: allowanceRates, key: roles.key })
        .from(allowanceRates)
        .leftJoin(roles, eq(roles.id, allowanceRates.roleId))
        .where(
          and(
            isNull(allowanceRates.deletedAt),
            q.band ? eq(allowanceRates.band, q.band as RateRow['band']) : undefined,
            q.roleKey ? eq(roles.key, q.roleKey as never) : undefined,
          ),
        )
        .orderBy(
          asc(allowanceRates.band),
          sql`${roles.key} nulls first`,
          asc(allowanceRates.effectiveFrom),
        );
      return { items: rows.map((x) => this.rateDto(x.r, x.key)) };
    });
  }

  private async roleId(tx: Tx, key: string | null) {
    if (!key) return null;
    const [r] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.key, key as never));
    if (!r) throw err(422, 'VALIDATION', 'Unknown role', { field: 'roleKey' });
    return r.id;
  }

  private async rateClash(tx: Tx, b: AllowanceRateInput, roleId: string | null, except?: string) {
    const [dup] = await tx
      .select({ id: allowanceRates.id })
      .from(allowanceRates)
      .where(
        and(
          isNull(allowanceRates.deletedAt),
          eq(allowanceRates.band, b.band),
          eq(allowanceRates.effectiveFrom, b.effectiveFrom),
          roleId ? eq(allowanceRates.roleId, roleId) : isNull(allowanceRates.roleId),
          except ? ne(allowanceRates.id, except) : undefined,
        ),
      );
    if (dup)
      throw err(409, 'DUPLICATE_RATE', 'A rate for this band, role and date already exists', {
        id: dup.id,
      });
  }

  private rateValues(b: AllowanceRateInput) {
    return {
      band: b.band,
      effectiveFrom: b.effectiveFrom,
      daAmount: b.daAmount.toFixed(2),
      taPerKm: b.taPerKm.toFixed(2),
      taFixed: b.taFixed.toFixed(2),
    };
  }

  createRate(p: Principal, b: AllowanceRateInput) {
    return this.tenant.run(p, async (tx) => {
      const roleId = await this.roleId(tx, b.roleKey);
      await this.rateClash(tx, b, roleId);
      const [r] = await tx
        .insert(allowanceRates)
        .values({ id: uuidv7(), companyId: p.companyId, roleId, ...this.rateValues(b) })
        .returning();
      await this.audit.record(tx, p, 'allowance_rate.create', {
        entityType: 'allowance_rate',
        entityId: r!.id,
        after: { ...b },
      });
      return this.rateDto(r!, b.roleKey);
    });
  }

  private async rateRow(tx: Tx, id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Rate not found');
    const [r] = await tx
      .select()
      .from(allowanceRates)
      .where(and(eq(allowanceRates.id, id), isNull(allowanceRates.deletedAt)))
      .for('update');
    if (!r) throw new NotFoundException('Rate not found');
    return r;
  }

  updateRate(p: Principal, id: string, b: AllowanceRateInput & { version: number }) {
    return this.tenant.run(p, async (tx) => {
      const cur = await this.rateRow(tx, id);
      if (cur.version !== b.version)
        throw err(409, 'VERSION_CONFLICT', 'Rate changed; reload', { version: cur.version });
      const roleId = await this.roleId(tx, b.roleKey);
      await this.rateClash(tx, b, roleId, id);
      const [r] = await tx
        .update(allowanceRates)
        .set({ roleId, ...this.rateValues(b) })
        .where(eq(allowanceRates.id, id))
        .returning();
      await this.audit.record(tx, p, 'allowance_rate.update', {
        entityType: 'allowance_rate',
        entityId: id,
        before: {
          band: cur.band,
          effectiveFrom: cur.effectiveFrom,
          daAmount: Number(cur.daAmount),
          taPerKm: Number(cur.taPerKm),
          taFixed: Number(cur.taFixed),
        },
        after: { ...b },
      });
      return this.rateDto(r!, b.roleKey);
    });
  }

  deleteRate(p: Principal, id: string) {
    return this.tenant.run(p, async (tx) => {
      await this.rateRow(tx, id);
      await tx
        .update(allowanceRates)
        .set({ deletedAt: new Date() })
        .where(eq(allowanceRates.id, id));
      await this.audit.record(tx, p, 'allowance_rate.delete', {
        entityType: 'allowance_rate',
        entityId: id,
      });
    });
  }

  // ---- places ----

  listPlaces(
    p: Principal,
    q: { hqTerritoryId?: string; band?: string; q?: string; includeInactive?: string },
  ) {
    this.canRead(p);
    return this.tenant.run(p, async (tx) => {
      const rows = await tx
        .select({ r: allowancePlaces, hq: territories.name })
        .from(allowancePlaces)
        .innerJoin(territories, eq(territories.id, allowancePlaces.hqTerritoryId))
        .where(
          and(
            isNull(allowancePlaces.deletedAt),
            q.hqTerritoryId ? eq(allowancePlaces.hqTerritoryId, q.hqTerritoryId) : undefined,
            q.band ? eq(allowancePlaces.band, q.band as PlaceRow['band']) : undefined,
            q.q ? ilike(allowancePlaces.name, `%${q.q.replace(/[%_\\]/g, '\\$&')}%`) : undefined,
            q.includeInactive === 'true' ? undefined : eq(allowancePlaces.active, true),
          ),
        )
        .orderBy(asc(territories.name), asc(allowancePlaces.name));
      return { items: rows.map((x) => this.placeDto(x.r, x.hq)) };
    });
  }

  private async hq(tx: Tx, id: string) {
    const [t] = await tx
      .select({ name: territories.name, level: territories.level })
      .from(territories)
      .where(and(eq(territories.id, id), isNull(territories.deletedAt)));
    if (!t || t.level !== 'headquarter')
      throw err(422, 'NOT_HQ_TERRITORY', 'hqTerritoryId must be a headquarter territory', {
        field: 'hqTerritoryId',
      });
    return t.name;
  }

  private async placeClash(tx: Tx, b: AllowancePlaceInput, except?: string) {
    const [dup] = await tx
      .select({ id: allowancePlaces.id })
      .from(allowancePlaces)
      .where(
        and(
          isNull(allowancePlaces.deletedAt),
          eq(allowancePlaces.hqTerritoryId, b.hqTerritoryId),
          sql`lower(${allowancePlaces.name}) = lower(${b.name})`,
          except ? ne(allowancePlaces.id, except) : undefined,
        ),
      );
    if (dup)
      throw err(409, 'DUPLICATE_PLACE', 'This HQ already has a place with that name', {
        id: dup.id,
      });
  }

  private placeValues(b: AllowancePlaceInput) {
    return {
      hqTerritoryId: b.hqTerritoryId,
      name: b.name,
      band: b.band,
      oneWayKm: b.oneWayKm.toFixed(2),
      active: b.active,
    };
  }

  createPlace(p: Principal, b: AllowancePlaceInput) {
    return this.tenant.run(p, async (tx) => {
      const hqName = await this.hq(tx, b.hqTerritoryId);
      await this.placeClash(tx, b);
      const [r] = await tx
        .insert(allowancePlaces)
        .values({ id: uuidv7(), companyId: p.companyId, ...this.placeValues(b) })
        .returning();
      await this.audit.record(tx, p, 'allowance_place.create', {
        entityType: 'allowance_place',
        entityId: r!.id,
        after: { ...b },
      });
      return this.placeDto(r!, hqName);
    });
  }

  private async placeRow(tx: Tx, id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Place not found');
    const [r] = await tx
      .select()
      .from(allowancePlaces)
      .where(and(eq(allowancePlaces.id, id), isNull(allowancePlaces.deletedAt)))
      .for('update');
    if (!r) throw new NotFoundException('Place not found');
    return r;
  }

  updatePlace(p: Principal, id: string, b: AllowancePlaceInput & { version: number }) {
    return this.tenant.run(p, async (tx) => {
      const cur = await this.placeRow(tx, id);
      if (cur.version !== b.version)
        throw err(409, 'VERSION_CONFLICT', 'Place changed; reload', { version: cur.version });
      const hqName = await this.hq(tx, b.hqTerritoryId);
      await this.placeClash(tx, b, id);
      const [r] = await tx
        .update(allowancePlaces)
        .set(this.placeValues(b))
        .where(eq(allowancePlaces.id, id))
        .returning();
      await this.audit.record(tx, p, 'allowance_place.update', {
        entityType: 'allowance_place',
        entityId: id,
        before: {
          name: cur.name,
          band: cur.band,
          oneWayKm: Number(cur.oneWayKm),
          active: cur.active,
        },
        after: { ...b },
      });
      return this.placeDto(r!, hqName);
    });
  }

  deletePlace(p: Principal, id: string) {
    return this.tenant.run(p, async (tx) => {
      await this.placeRow(tx, id);
      await tx
        .update(allowancePlaces)
        .set({ deletedAt: new Date(), active: false })
        .where(eq(allowancePlaces.id, id));
      await this.audit.record(tx, p, 'allowance_place.delete', {
        entityType: 'allowance_place',
        entityId: id,
      });
    });
  }
}
