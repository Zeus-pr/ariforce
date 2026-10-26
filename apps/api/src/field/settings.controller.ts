import { Body, ConflictException, Controller, Get, Put } from '@nestjs/common';
import { GeofenceSettings } from '@ariforce/contracts';
import { companies } from '@ariforce/db';
import { and, eq } from 'drizzle-orm';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { AuditService } from '../common/audit.service';
import { TenantService } from '../common/tenant.service';
import { ZodPipe } from '../common/zod.pipe';
import { companySettings } from './field.util';

const toDto = (s: Awaited<ReturnType<typeof companySettings>>): GeofenceSettings => ({
  radiusM: s.radiusM,
  maxAccuracyM: s.maxAccuracyM,
  blockOutOfFence: s.blockOutOfFence,
  blockMockLocation: s.blockMockLocation,
  version: s.version,
});

/** Company check-in policy (#24). Any signed-in user reads it (the app needs it); settings:write edits. */
@Controller({ path: 'settings/geofence', version: '1' })
export class SettingsController {
  constructor(
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('me:read')
  get(@CurrentPrincipal() p: Principal) {
    return this.tenant.run(p, async (tx) => toDto(await companySettings(tx, p)));
  }

  @Put()
  @RequirePermissions('settings:write')
  put(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(GeofenceSettings)) b: GeofenceSettings) {
    return this.tenant.run(p, async (tx) => {
      const before = toDto(await companySettings(tx, p));
      const [row] = await tx
        .update(companies)
        .set({
          defaultGeofenceM: b.radiusM,
          geofenceMaxAccuracyM: b.maxAccuracyM,
          geofenceBlockOutOfFence: b.blockOutOfFence,
          geofenceBlockMock: b.blockMockLocation,
        })
        .where(and(eq(companies.id, p.companyId), eq(companies.version, b.version)))
        .returning({ id: companies.id });
      if (!row)
        throw new ConflictException({
          code: 'VERSION_CONFLICT',
          message: 'Stale version',
          details: before,
        });
      const after = toDto(await companySettings(tx, p));
      await this.audit.record(tx, p, 'settings.geofence', {
        entityType: 'company',
        entityId: p.companyId,
        before,
        after,
      });
      return after;
    });
  }
}
