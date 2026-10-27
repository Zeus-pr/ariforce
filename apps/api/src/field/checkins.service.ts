import { ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import type { CheckIn, CheckInCreate } from '@ariforce/contracts';
import {
  chemists,
  consentRecords,
  devices,
  doctors,
  geoCaptures,
  stockists,
  territories,
  userTerritories,
  type Tx,
} from '@ariforce/db';
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Principal } from '../auth/principal';
import { AuditService } from '../common/audit.service';
import { TenantService } from '../common/tenant.service';
import { decodeCursor, encodeCursor } from '../masters/masters.service';
import { companySettings, localDate, metres } from './field.util';

type Row = typeof geoCaptures.$inferSelect;
const OUTLETS = { doctor: doctors, chemist: chemists, stockist: stockists } as const;
const OUTLET_KINDS = Object.keys(OUTLETS);

export const err = (status: number, code: string, message: string, details?: unknown) =>
  new HttpException({ code, message, details }, status);

export interface CheckInQuery {
  limit?: number;
  cursor?: string;
  sort?: string;
  includeTotal?: 'true' | 'false';
  from?: string;
  to?: string;
  userId?: string;
  territoryId?: string;
  kind?: CheckIn['kind'];
  outletKind?: 'doctor' | 'chemist' | 'stockist';
  outletId?: string;
  unlinked?: 'true' | 'false';
}

/** Local date of a capture as SQL, in the company time zone. */
export const capDate = (tz: string) => sql`(${geoCaptures.capturedAt} at time zone ${tz})::date`;

export function toCheckIn(r: Row, tz: string, inFence?: boolean | null): CheckIn {
  const outlet = r.entityType && OUTLET_KINDS.includes(r.entityType);
  const received = r.receivedAt.toISOString();
  return {
    id: r.id,
    companyId: r.companyId,
    createdAt: received,
    updatedAt: received,
    deletedAt: null,
    version: 1,
    userId: r.userId,
    territoryId: r.territoryId,
    date: localDate(r.capturedAt, tz),
    kind: r.kind as CheckIn['kind'],
    outletKind: outlet ? (r.entityType as CheckIn['outletKind']) : null,
    outletId: outlet ? r.entityId : null,
    location: { lat: r.location.y, lng: r.location.x },
    accuracyM: r.accuracyM ?? 0,
    capturedAt: r.capturedAt.toISOString(),
    isMock: r.isMock,
    receivedAt: received,
    distanceM: r.distanceM,
    inFence: inFence ?? null,
    selfieFileKey: r.selfieFileKey,
  };
}

@Injectable()
export class CheckInsService {
  constructor(
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
  ) {}

  /** Team filter (caller + reporting line) and an optional explicit userId that must be inside it. */
  userFilter(
    p: Principal,
    userId: string | undefined,
    col: AnyPgColumn = geoCaptures.userId,
  ): SQL | undefined {
    if (userId && p.teamUserIds && !p.teamUserIds.includes(userId))
      throw new ForbiddenException('User is outside your team');
    if (userId) return eq(col, userId);
    return p.teamUserIds ? inArray(col, p.teamUserIds) : undefined;
  }

  territorySubtree(tx: Tx, territoryId: string) {
    return tx
      .select({ id: territories.id })
      .from(territories)
      .where(
        sql`${territories.path} = (select path from territories where id = ${territoryId})
          or starts_with(${territories.path}, (select path from territories where id = ${territoryId}) || '.')`,
      );
  }

  list(p: Principal, q: CheckInQuery) {
    return this.tenant.run(p, async (tx) => {
      const s = await companySettings(tx, p);
      const d = capDate(s.timezone);
      const where = [
        this.userFilter(p, q.userId),
        q.from ? sql`${d} >= ${q.from}::date` : undefined,
        q.to ? sql`${d} <= ${q.to}::date` : undefined,
        q.kind
          ? eq(geoCaptures.kind, q.kind)
          : inArray(geoCaptures.kind, ['punch_in', 'visit', 'punch_out']),
        q.outletKind ? eq(geoCaptures.entityType, q.outletKind) : undefined,
        q.outletId ? eq(geoCaptures.entityId, q.outletId) : undefined,
        q.territoryId
          ? inArray(geoCaptures.territoryId, this.territorySubtree(tx, q.territoryId))
          : undefined,
        q.unlinked === 'true'
          ? and(
              eq(geoCaptures.kind, 'visit'),
              sql`not exists (select 1 from dcr_calls c where c.geo_capture_id = ${geoCaptures.id} and c.deleted_at is null)`,
            )
          : undefined,
      ].filter(Boolean) as SQL[];
      const sort = q.sort ?? '-date';
      const dir = sort.startsWith('-') ? desc : asc;
      const field = sort.replace(/^-/, '');
      if (!['date', 'createdAt', 'updatedAt'].includes(field))
        throw err(422, 'VALIDATION', `Unknown sort field ${field}`);
      const col = field === 'date' ? geoCaptures.capturedAt : geoCaptures.receivedAt;
      const limit = q.limit ?? 50;
      const offset = decodeCursor(q.cursor);
      const rows = await tx
        .select()
        .from(geoCaptures)
        .where(and(...where))
        .orderBy(dir(col), dir(geoCaptures.id))
        .limit(limit + 1)
        .offset(offset);
      const more = rows.length > limit;
      const items = rows.slice(0, limit).map((r) => toCheckIn(r, s.timezone, fence(r, s.radiusM)));
      const out: Record<string, unknown> = {
        items,
        nextCursor: more ? encodeCursor(offset + limit) : null,
        serverTime: new Date().toISOString(),
      };
      if (q.includeTotal === 'true') {
        const [t] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(geoCaptures)
          .where(and(...where));
        out.total = t!.n;
      }
      return out;
    });
  }

  /**
   * GPS capture at punch-in, visit or punch-out. clientId is the row id, so offline retries are
   * idempotent (replay returns the stored row with 200). Rules, in order:
   * active device (412) → location consent (412) → mock/accuracy (422) → sequence (409) →
   * outlet in scope (404) → geofence (422 when blocking, else flagged inFence=false).
   */
  create(p: Principal, b: CheckInCreate): Promise<{ replay: boolean; body: CheckIn }> {
    return this.tenant.run(p, async (tx) => {
      const s = await companySettings(tx, p);
      const [prev] = await tx.select().from(geoCaptures).where(eq(geoCaptures.id, b.clientId));
      if (prev) {
        if (prev.userId !== p.userId || prev.kind !== b.kind)
          throw err(409, 'IDEMPOTENCY_CONFLICT', 'clientId already used for a different check-in');
        return { replay: true, body: toCheckIn(prev, s.timezone, fence(prev, s.radiusM)) };
      }

      const active = await tx
        .select({ id: devices.id })
        .from(devices)
        .where(and(eq(devices.userId, p.userId), eq(devices.status, 'active')));
      const deviceId = b.deviceId ?? (active.length === 1 ? active[0]!.id : undefined);
      if (!deviceId || !active.some((d) => d.id === deviceId))
        throw err(
          412,
          'DEVICE_NOT_ACTIVE',
          'Enrol this device and grant consent before checking in',
        );
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

      if (b.isMock && s.blockMockLocation)
        throw err(422, 'MOCK_LOCATION', 'Mock location is not allowed');
      if (b.accuracyM > s.maxAccuracyM)
        throw err(
          422,
          'LOW_ACCURACY',
          `GPS accuracy ${b.accuracyM} m exceeds ${s.maxAccuracyM} m`,
          {
            maxAccuracyM: s.maxAccuracyM,
          },
        );

      const capturedAt = new Date(b.capturedAt);
      const day = localDate(capturedAt, s.timezone);
      const today = await tx
        .select({ kind: geoCaptures.kind })
        .from(geoCaptures)
        .where(and(eq(geoCaptures.userId, p.userId), sql`${capDate(s.timezone)} = ${day}::date`));
      const has = (k: string) => today.some((r) => r.kind === k);
      if (b.kind === 'punch_in' && has('punch_in'))
        throw err(409, 'SEQUENCE', 'Already punched in today');
      if (b.kind !== 'punch_in' && !has('punch_in')) throw err(409, 'SEQUENCE', 'Punch in first');
      if (has('punch_out')) throw err(409, 'SEQUENCE', 'Already punched out today');

      let territoryId: string | null;
      let distanceM: number | null = null;
      let inFence: boolean | null = null;
      if (b.kind === 'visit') {
        const t = OUTLETS[b.outletKind!];
        const scope = this.tenant.scope(p, territories.path);
        const [o] = await tx
          .select({
            territoryId: t.territoryId,
            location: t.location,
            radius: b.outletKind === 'doctor' ? doctors.geofenceRadiusM : sql<null>`null`,
          })
          .from(t)
          .innerJoin(territories, eq(territories.id, t.territoryId))
          .where(and(eq(t.id, b.outletId!), sql`${t.deletedAt} is null`, scope));
        if (!o) throw new NotFoundException('Outlet not found');
        territoryId = o.territoryId;
        if (o.location) {
          distanceM = metres(b.location, { lat: o.location.y, lng: o.location.x });
          inFence = distanceM <= (o.radius ?? s.radiusM);
          if (!inFence && s.blockOutOfFence)
            throw err(422, 'OUT_OF_FENCE', `You are ${distanceM} m from the outlet`, {
              distanceM,
              radiusM: o.radius ?? s.radiusM,
            });
        }
      } else {
        const [ut] = await tx
          .select({ id: userTerritories.territoryId })
          .from(userTerritories)
          .where(eq(userTerritories.userId, p.userId))
          .limit(1);
        territoryId = ut?.id ?? null;
      }

      const [row] = await tx
        .insert(geoCaptures)
        .values({
          id: b.clientId,
          companyId: p.companyId,
          userId: p.userId,
          deviceId,
          kind: b.kind,
          location: { x: b.location.lng, y: b.location.lat },
          accuracyM: b.accuracyM,
          source: 'gps',
          isMock: b.isMock ?? false,
          entityType: b.kind === 'visit' ? b.outletKind! : 'attendance',
          entityId: b.kind === 'visit' ? b.outletId! : null,
          distanceM,
          territoryId,
          selfieFileKey: b.selfieFileKey ?? null,
          capturedAt,
        })
        .returning();
      const body = toCheckIn(row!, s.timezone, inFence);
      await this.audit.record(tx, p, `checkin.${b.kind}`, {
        entityType: 'geo_capture',
        entityId: row!.id,
        after: {
          kind: b.kind,
          outletKind: body.outletKind,
          outletId: body.outletId,
          distanceM,
          inFence,
        },
      });
      return { replay: false, body };
    });
  }
}

/** inFence for stored rows: only meaningful for visits with a computed distance. */
function fence(r: Row, radiusM: number): boolean | null {
  return r.kind === 'visit' && r.distanceM !== null ? r.distanceM <= radiusM : null;
}
