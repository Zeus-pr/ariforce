import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { ConsentGrant, DeviceEnrol, Id, type ConsentState, type Device } from '@ariforce/contracts';
import { consentRecords, devices, type Tx } from '@ariforce/db';
import { and, desc, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { AuditService } from '../common/audit.service';
import { TenantService } from '../common/tenant.service';
import { ZodPipe } from '../common/zod.pipe';
import { NOTICE_VERSION } from './field.util';

type DeviceRow = typeof devices.$inferSelect;
const toDto = (r: DeviceRow): Device => ({
  id: r.id,
  companyId: r.companyId,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  deletedAt: r.deletedAt?.toISOString() ?? null,
  version: r.version,
  userId: r.userId,
  ownership: r.ownership,
  platform: r.platform,
  installId: r.installId,
  model: r.model,
  osVersion: r.osVersion,
  appVersion: r.appVersion,
  assetTag: r.assetTag,
  status: r.status,
  enrolledAt: r.enrolledAt?.toISOString() ?? null,
});

/** Latest consent per purpose for the user (append-only ledger; last row wins). */
export async function latestConsents(tx: Tx, p: Principal) {
  const rows = await tx
    .select()
    .from(consentRecords)
    .where(eq(consentRecords.userId, p.userId))
    .orderBy(desc(consentRecords.at), desc(consentRecords.id));
  const out = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!out.has(r.purpose)) out.set(r.purpose, r);
  return out;
}

/** Device enrolment + DPDP consent (#36). Users manage only their own devices. */
@Controller({ version: '1' })
export class DevicesController {
  constructor(
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
  ) {}

  @Get('devices')
  @RequirePermissions('me:read')
  list(@CurrentPrincipal() p: Principal) {
    return this.tenant.run(p, async (tx) => {
      const rows = await tx.select().from(devices).where(eq(devices.userId, p.userId));
      return { items: rows.map(toDto), nextCursor: null, serverTime: new Date().toISOString() };
    });
  }

  /** Re-enrolling the same installId returns the existing device (idempotent). */
  @Post('devices')
  @HttpCode(201)
  @RequirePermissions('me:read')
  enrol(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(DeviceEnrol)) b: DeviceEnrol) {
    return this.tenant.run(p, async (tx) => {
      const [existing] = await tx
        .select()
        .from(devices)
        .where(and(eq(devices.installId, b.installId), eq(devices.userId, p.userId)));
      if (existing) return toDto(existing);
      const company = b.ownership === 'company';
      const [row] = await tx
        .insert(devices)
        .values({
          ...b,
          id: uuidv7(),
          companyId: p.companyId,
          userId: p.userId,
          status: company ? 'active' : 'pending_consent',
          enrolledAt: company ? new Date() : null,
        })
        .returning();
      await this.audit.record(tx, p, 'device.enrol', {
        entityType: 'device',
        entityId: row!.id,
        after: toDto(row!),
      });
      return toDto(row!);
    });
  }

  @Post('devices/:id/consents')
  @HttpCode(201)
  @RequirePermissions('me:read')
  consent(
    @CurrentPrincipal() p: Principal,
    @Param('id') id: string,
    @Body(new ZodPipe(ConsentGrant)) b: ConsentGrant,
  ) {
    if (!Id.safeParse(id).success) throw new NotFoundException('Device not found');
    return this.tenant.run(p, async (tx) => {
      const [d] = await tx
        .select()
        .from(devices)
        .where(and(eq(devices.id, id), eq(devices.userId, p.userId)));
      if (!d) throw new NotFoundException('Device not found');
      const [rec] = await tx
        .insert(consentRecords)
        .values({
          id: uuidv7(),
          companyId: p.companyId,
          userId: p.userId,
          deviceId: id,
          purpose: b.purpose,
          noticeVersion: b.noticeVersion,
          granted: b.granted,
          ip: p.ip,
          userAgent: p.userAgent,
        })
        .returning();
      // Personal phone: active once both consents are granted; withdrawing enrolment consent revokes.
      if (d.ownership === 'personal') {
        const c = await latestConsents(tx, p);
        const ok =
          c.get('personal_device_enrolment')?.granted && c.get('location_checkin')?.granted;
        if (ok && d.status === 'pending_consent')
          await tx
            .update(devices)
            .set({ status: 'active', enrolledAt: new Date() })
            .where(eq(devices.id, id));
        if (b.purpose === 'personal_device_enrolment' && !b.granted && d.status === 'active')
          await tx
            .update(devices)
            .set({ status: 'revoked', revokedAt: new Date(), revokedReason: 'consent_withdrawn' })
            .where(eq(devices.id, id));
      }
      await this.audit.record(tx, p, b.granted ? 'consent.grant' : 'consent.withdraw', {
        entityType: 'device',
        entityId: id,
        after: { purpose: b.purpose, noticeVersion: b.noticeVersion },
      });
      return {
        id: rec!.id,
        userId: rec!.userId,
        deviceId: rec!.deviceId,
        purpose: rec!.purpose,
        noticeVersion: rec!.noticeVersion,
        granted: rec!.granted,
        at: rec!.at.toISOString(),
      };
    });
  }

  @Get('me/consent')
  @RequirePermissions('me:read')
  state(@CurrentPrincipal() p: Principal): Promise<ConsentState> {
    return this.tenant.run(p, async (tx) => {
      const [d] = await tx
        .select()
        .from(devices)
        .where(and(eq(devices.userId, p.userId), eq(devices.status, 'active')))
        .orderBy(desc(devices.updatedAt))
        .limit(1);
      const c = await latestConsents(tx, p);
      return {
        deviceId: d?.id ?? null,
        ownership: d?.ownership ?? null,
        currentNoticeVersion: NOTICE_VERSION,
        noticeUrl: `/legal/dpdp-notice/${NOTICE_VERSION}`,
        consents: [...c.values()].map((r) => ({
          purpose: r.purpose,
          granted: r.granted,
          noticeVersion: r.noticeVersion,
          at: r.at.toISOString(),
        })),
        canCheckIn: !!d && !!c.get('location_checkin')?.granted,
      };
    });
  }
}
