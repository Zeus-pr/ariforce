import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ROLE_RANK,
  OutletKind as OutletKindSchema,
  type OutletLocation,
  type OutletLocationCreate,
  type OutletLocationPatch,
} from '@ariforce/contracts';
import type * as z from 'zod';

type OutletKind = z.infer<typeof OutletKindSchema>;
type OutletLocationLabel = OutletLocation['label'];
import {
  chemists,
  consentRecords,
  devices,
  doctors,
  geoCaptures,
  geoLockEvents,
  outletLocations,
  stockists,
  territories,
  users,
  type Tx,
} from '@ariforce/db';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Principal } from '../auth/principal';
import { AuditService } from '../common/audit.service';
import { TenantService } from '../common/tenant.service';
import { err } from './checkins.service';
import { companySettings, doctorLockLimitMessage, metres } from './field.util';

const OUTLETS = { doctor: doctors, chemist: chemists, stockist: stockists } as const;

const LABELS: Record<OutletKind, readonly string[]> = {
  doctor: ['clinic', 'hospital', 'chamber', 'residence', 'nursing_home', 'other'],
  chemist: ['retail_shop', 'distributor_counter', 'other'],
  stockist: ['godown', 'depot', 'office', 'other'],
};

type LocRow = typeof outletLocations.$inferSelect;

/** ABM (rank 2) through director, plus system_admin. */
export function canManageOutletLocations(p: Principal): boolean {
  if (p.roles.includes('system_admin')) return true;
  return p.roles.some((r) => ROLE_RANK[r] >= ROLE_RANK.area_business_manager);
}

function toDto(r: LocRow, lockedByName: string | null = null): OutletLocation {
  const received = r.updatedAt.toISOString();
  return {
    id: r.id,
    companyId: r.companyId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: received,
    deletedAt: r.deletedAt?.toISOString() ?? null,
    version: r.version,
    outletKind: r.outletKind as OutletKind,
    outletId: r.outletId,
    label: r.label as OutletLocationLabel,
    location: { lat: r.location.y, lng: r.location.x },
    accuracyM: r.accuracyM ?? null,
    source: r.source,
    isMock: r.isMock,
    lockedAt: r.lockedAt.toISOString(),
    lockedBy: r.lockedBy,
    lockedByName,
    active: r.active,
  };
}

@Injectable()
export class OutletLocationsService {
  constructor(
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
  ) {}

  /** Active locations for one outlet (batched name lookup). */
  list(p: Principal, outletKind: OutletKind, outletId: string) {
    return this.tenant.run(p, async (tx) => {
      await this.requireOutlet(tx, p, outletKind, outletId);
      const rows = await tx
        .select()
        .from(outletLocations)
        .where(
          and(
            eq(outletLocations.outletKind, outletKind),
            eq(outletLocations.outletId, outletId),
            eq(outletLocations.active, true),
            isNull(outletLocations.deletedAt),
          ),
        )
        .orderBy(asc(outletLocations.lockedAt), asc(outletLocations.id));
      const names = await this.names(
        tx,
        rows.map((r) => r.lockedBy),
      );
      return {
        items: rows.map((r) => toDto(r, names.get(r.lockedBy) ?? null)),
        serverTime: new Date().toISOString(),
      };
    });
  }

  /**
   * First lock / add location. A doctor may have `max_active_locks` active pins (default 1, max 5).
   * Chemist/stockist: one active. Idempotent on clientId. Stricter accuracy than visit check-ins.
   */
  create(p: Principal, outletKind: OutletKind, outletId: string, b: OutletLocationCreate) {
    return this.tenant.run(p, async (tx) => {
      const s = await companySettings(tx, p);
      const [prev] = await tx
        .select()
        .from(outletLocations)
        .where(eq(outletLocations.id, b.clientId));
      if (prev) {
        if (prev.outletId !== outletId || prev.outletKind !== outletKind)
          throw err(409, 'IDEMPOTENCY_CONFLICT', 'clientId already used for a different location');
        return { replay: true, body: toDto(prev) };
      }

      const allowed = LABELS[outletKind];
      if (!allowed.includes(b.label))
        throw err(422, 'VALIDATION', `Invalid label for ${outletKind}`, { label: b.label });

      const outlet = await this.requireOutlet(tx, p, outletKind, outletId);
      await this.assertDeviceConsent(tx, p, b.deviceId);

      if (b.isMock && s.blockMockLocation)
        throw err(422, 'MOCK_LOCATION', 'Mock location is not allowed');
      if (b.accuracyM > s.lockMaxAccuracyM)
        throw err(
          422,
          'LOW_ACCURACY',
          `GPS accuracy ${b.accuracyM} m exceeds lock limit ${s.lockMaxAccuracyM} m`,
          { maxAccuracyM: s.lockMaxAccuracyM },
        );

      if (outletKind !== 'doctor') {
        const [existing] = await tx
          .select({ id: outletLocations.id })
          .from(outletLocations)
          .where(
            and(
              eq(outletLocations.outletKind, outletKind),
              eq(outletLocations.outletId, outletId),
              eq(outletLocations.active, true),
              isNull(outletLocations.deletedAt),
            ),
          )
          .limit(1);
        if (existing)
          throw err(
            409,
            'LOCATION_EXISTS',
            'This outlet already has a locked location; ask a manager to edit it',
            { locationId: existing.id },
          );
      } else {
        await this.assertDoctorLockRoom(tx, outletId);
      }

      const lockedAt = new Date(b.capturedAt);
      const [row] = await tx
        .insert(outletLocations)
        .values({
          id: b.clientId,
          companyId: p.companyId,
          outletKind,
          outletId,
          label: b.label,
          location: { x: b.location.lng, y: b.location.lat },
          accuracyM: b.accuracyM,
          source: 'gps',
          isMock: b.isMock ?? false,
          lockedAt,
          lockedBy: p.userId,
          active: true,
        })
        .returning();

      // Keep denormalised master point in sync (primary / first lock).
      if (!outlet.location) {
        const t = OUTLETS[outletKind];
        await tx
          .update(t)
          .set({ location: { x: b.location.lng, y: b.location.lat } })
          .where(eq(t.id, outletId));
        if (outletKind === 'doctor') {
          await tx
            .update(doctors)
            .set({ geoTaggedAt: lockedAt, geoTaggedBy: p.userId })
            .where(eq(doctors.id, outletId));
        }
      }

      await tx.insert(geoCaptures).values({
        id: uuidv7(),
        companyId: p.companyId,
        userId: p.userId,
        deviceId: (await this.activeDeviceId(tx, p, b.deviceId))!,
        kind: 'geo_tag',
        location: { x: b.location.lng, y: b.location.lat },
        accuracyM: b.accuracyM,
        source: 'gps',
        isMock: b.isMock ?? false,
        entityType: outletKind,
        entityId: outletId,
        distanceM: null,
        territoryId: outlet.territoryId,
        capturedAt: lockedAt,
      });

      await tx.insert(geoLockEvents).values({
        companyId: p.companyId,
        outletKind,
        outletId,
        locationId: row!.id,
        action: 'lock',
        actorId: p.userId,
        before: null,
        after: JSON.stringify({
          label: b.label,
          lat: b.location.lat,
          lng: b.location.lng,
          accuracyM: b.accuracyM,
        }),
      });
      await this.audit.record(tx, p, 'outlet.location.lock', {
        entityType: 'outlet_location',
        entityId: row!.id,
        after: { outletKind, outletId, label: b.label },
      });
      return { replay: false, body: toDto(row!) };
    });
  }

  /** Manager edit / deactivate. Reps get 403. */
  patch(p: Principal, id: string, b: OutletLocationPatch) {
    if (!canManageOutletLocations(p))
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only ABM and above can edit locked locations',
      });
    return this.tenant.run(p, async (tx) => {
      const [row] = await tx
        .select()
        .from(outletLocations)
        .where(and(eq(outletLocations.id, id), isNull(outletLocations.deletedAt)));
      if (!row) throw new NotFoundException('Location not found');
      await this.requireOutlet(tx, p, row.outletKind as OutletKind, row.outletId);

      const kind = row.outletKind as OutletKind;
      if (b.label && !LABELS[kind].includes(b.label))
        throw err(422, 'VALIDATION', `Invalid label for ${row.outletKind}`, { label: b.label });

      if (b.active === true && !row.active && row.outletKind !== 'doctor') {
        const [clash] = await tx
          .select({ id: outletLocations.id })
          .from(outletLocations)
          .where(
            and(
              eq(outletLocations.outletKind, row.outletKind),
              eq(outletLocations.outletId, row.outletId),
              eq(outletLocations.active, true),
              isNull(outletLocations.deletedAt),
              sql`${outletLocations.id} <> ${id}`,
            ),
          )
          .limit(1);
        if (clash)
          throw err(
            409,
            'LOCATION_EXISTS',
            'Another active location already exists for this outlet',
          );
      }
      if (b.active === true && !row.active && row.outletKind === 'doctor') {
        await this.assertDoctorLockRoom(tx, row.outletId);
      }

      const before = {
        label: row.label,
        lat: row.location.y,
        lng: row.location.x,
        active: row.active,
        version: row.version,
      };
      const set: Partial<LocRow> = {};
      if (b.label !== undefined) set.label = b.label;
      if (b.location) set.location = { x: b.location.lng, y: b.location.lat };
      if (b.accuracyM !== undefined) set.accuracyM = b.accuracyM;
      if (b.active !== undefined) set.active = b.active;
      if (b.location) {
        set.lockedAt = new Date();
        set.lockedBy = p.userId;
      }

      const [updated] = await tx
        .update(outletLocations)
        .set(set)
        .where(and(eq(outletLocations.id, id), eq(outletLocations.version, b.version)))
        .returning();
      if (!updated)
        throw new ConflictException({
          code: 'VERSION_CONFLICT',
          message: 'Stale version',
          details: before,
        });

      const action =
        b.active === false && row.active
          ? ('deactivate' as const)
          : b.active === true && !row.active
            ? ('reactivate' as const)
            : ('edit' as const);

      await tx.insert(geoLockEvents).values({
        companyId: p.companyId,
        outletKind: row.outletKind,
        outletId: row.outletId,
        locationId: id,
        action,
        actorId: p.userId,
        before: JSON.stringify(before),
        after: JSON.stringify({
          label: updated.label,
          lat: updated.location.y,
          lng: updated.location.x,
          active: updated.active,
          version: updated.version,
        }),
      });
      await this.audit.record(tx, p, `outlet.location.${action}`, {
        entityType: 'outlet_location',
        entityId: id,
        before,
        after: { label: updated.label, active: updated.active },
      });
      return toDto(updated);
    });
  }

  /** Active locations for many outlets in one query (DCR / presentation). */
  async loadActive(
    tx: Tx,
    pairs: { outletKind: OutletKind; outletId: string }[],
  ): Promise<LocRow[]> {
    if (!pairs.length) return [];
    const kinds = [...new Set(pairs.map((p) => p.outletKind))];
    const ids = [...new Set(pairs.map((p) => p.outletId))];
    const rows = await tx
      .select()
      .from(outletLocations)
      .where(
        and(
          inArray(outletLocations.outletKind, kinds),
          inArray(outletLocations.outletId, ids),
          eq(outletLocations.active, true),
          isNull(outletLocations.deletedAt),
        ),
      );
    const want = new Set(pairs.map((p) => `${p.outletKind}:${p.outletId}`));
    return rows.filter((r) => want.has(`${r.outletKind}:${r.outletId}`));
  }

  /**
   * ABM and above, and system admin. Does not remove pins already saved.
   * A cap below the current active count only blocks the next new pin.
   */
  setLockCap(p: Principal, outletKind: OutletKind, outletId: string, maxActiveLocks: number) {
    if (!canManageOutletLocations(p))
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only ABM and above can set how many places a doctor can lock',
      });
    if (outletKind !== 'doctor') throw err(422, 'VALIDATION', 'Only a doctor has a pin cap');
    return this.tenant.run(p, async (tx) => {
      await this.requireOutlet(tx, p, 'doctor', outletId);
      const [row] = await tx
        .update(doctors)
        .set({ maxActiveLocks })
        .where(and(eq(doctors.id, outletId), isNull(doctors.deletedAt)))
        .returning({ maxActiveLocks: doctors.maxActiveLocks });
      if (!row) throw new NotFoundException('Outlet not found');
      await this.audit.record(tx, p, 'outlet.lock_cap', {
        entityType: 'doctor',
        entityId: outletId,
        after: { maxActiveLocks: row.maxActiveLocks },
      });
      return { maxActiveLocks: row.maxActiveLocks };
    });
  }

  /** Active doctor pins. A deactivated pin does not count. The cap is per doctor (default 1). */
  private async assertDoctorLockRoom(tx: Tx, outletId: string) {
    const limit = await this.doctorLockCap(tx, outletId);
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(outletLocations)
      .where(
        and(
          eq(outletLocations.outletKind, 'doctor'),
          eq(outletLocations.outletId, outletId),
          eq(outletLocations.active, true),
          isNull(outletLocations.deletedAt),
        ),
      );
    if ((row?.n ?? 0) >= limit)
      throw err(409, 'LOCATION_LIMIT', doctorLockLimitMessage(limit), { limit });
  }

  private async doctorLockCap(tx: Tx, outletId: string) {
    const [doc] = await tx
      .select({ maxActiveLocks: doctors.maxActiveLocks })
      .from(doctors)
      .where(eq(doctors.id, outletId));
    const n = doc?.maxActiveLocks ?? 1;
    return n >= 1 && n <= 5 ? n : 1;
  }

  nearest(
    locs: LocRow[],
    point: { lat: number; lng: number },
    locationId?: string,
  ): { loc: LocRow; distanceM: number } | null {
    if (locationId) {
      const loc = locs.find((l) => l.id === locationId);
      if (!loc) return null;
      return {
        loc,
        distanceM: metres(point, { lat: loc.location.y, lng: loc.location.x }),
      };
    }
    let best: { loc: LocRow; distanceM: number } | null = null;
    for (const loc of locs) {
      const distanceM = metres(point, { lat: loc.location.y, lng: loc.location.x });
      if (!best || distanceM < best.distanceM) best = { loc, distanceM };
    }
    return best;
  }

  private async requireOutlet(
    tx: Tx,
    p: Principal,
    outletKind: OutletKind,
    outletId: string,
  ): Promise<{ territoryId: string; location: { x: number; y: number } | null }> {
    const t = OUTLETS[outletKind];
    const scope = this.tenant.scope(p, territories.path);
    const [o] = await tx
      .select({ territoryId: t.territoryId, location: t.location })
      .from(t)
      .innerJoin(territories, eq(territories.id, t.territoryId))
      .where(and(eq(t.id, outletId), sql`${t.deletedAt} is null`, scope));
    if (!o) throw new NotFoundException('Outlet not found');
    return o;
  }

  private async names(tx: Tx, ids: string[]) {
    const uniq = [...new Set(ids.filter(Boolean))];
    if (!uniq.length) return new Map<string, string>();
    const rows = await tx
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, uniq));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private async activeDeviceId(tx: Tx, p: Principal, deviceId?: string) {
    const active = await tx
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.userId, p.userId), eq(devices.status, 'active')));
    const id = deviceId ?? (active.length === 1 ? active[0]!.id : undefined);
    if (!id || !active.some((d) => d.id === id)) return null;
    return id;
  }

  private async assertDeviceConsent(tx: Tx, p: Principal, deviceId?: string) {
    const id = await this.activeDeviceId(tx, p, deviceId);
    if (!id)
      throw err(412, 'DEVICE_NOT_ACTIVE', 'Enrol this device and grant consent before locking');
    const [consent] = await tx
      .select({ granted: consentRecords.granted })
      .from(consentRecords)
      .where(
        and(eq(consentRecords.userId, p.userId), eq(consentRecords.purpose, 'location_checkin')),
      )
      .orderBy(desc(consentRecords.at), desc(consentRecords.id))
      .limit(1);
    if (!consent?.granted)
      throw err(412, 'CONSENT_REQUIRED', 'Location check-in consent not granted');
  }
}
