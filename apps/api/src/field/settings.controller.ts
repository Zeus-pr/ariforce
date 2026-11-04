import { Body, ConflictException, Controller, Get, Put } from '@nestjs/common';
import { GeofenceSettings } from '@ariforce/contracts';
import { companies } from '@ariforce/db';
import { and, eq } from 'drizzle-orm';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { AuditService } from '../common/audit.service';
import { TenantService } from '../common/tenant.service';
import { ZodPipe } from '../common/zod.pipe';
import { companySettings, invalidateCompanySettings } from './field.util';

const toDto = (s: Awaited<ReturnType<typeof companySettings>>): GeofenceSettings => ({
  radiusM: s.radiusM,
  maxAccuracyM: s.maxAccuracyM,
  blockOutOfFence: s.blockOutOfFence,
  blockMockLocation: s.blockMockLocation,
  presentationRadiusM: s.presentationRadiusM,
  lockMaxAccuracyM: s.lockMaxAccuracyM,
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
    return this.tenant.run(p, async (tx) => toDto(await companySettings(tx, p, { fresh: true })));
  }

  @Put()
  @RequirePermissions('settings:write')
  async put(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(GeofenceSettings)) b: GeofenceSettings,
  ) {
    const res = await this.tenant.run(p, async (tx) => {
      const before = toDto(await companySettings(tx, p, { fresh: true }));
      const [row] = await tx
        .update(companies)
        .set({
          defaultGeofenceM: b.radiusM,
          geofenceMaxAccuracyM: b.maxAccuracyM,
          geofenceBlockOutOfFence: b.blockOutOfFence,
          geofenceBlockMock: b.blockMockLocation,
          presentationGeofenceM: b.presentationRadiusM,
          geoLockMaxAccuracyM: b.lockMaxAccuracyM,
        })
        .where(and(eq(companies.id, p.companyId), eq(companies.version, b.version)))
        .returning({ id: companies.id });
      invalidateCompanySettings(p.companyId);
      if (!row)
        throw new ConflictException({
          code: 'VERSION_CONFLICT',
          message: 'Stale version',
          details: before,
        });
      const after = toDto(await companySettings(tx, p, { fresh: true }));
      await this.audit.record(tx, p, 'settings.geofence', {
        entityType: 'company',
        entityId: p.companyId,
        before,
        after,
      });
      return after;
    });
    // Again after commit: a concurrent request may have cached the pre-commit row meanwhile.
    invalidateCompanySettings(p.companyId);
    return res;
  }
}
