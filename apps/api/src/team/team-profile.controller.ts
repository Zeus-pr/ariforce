import { Controller, Get, Param, Query, Res, StreamableFile } from '@nestjs/common';
import {
  TeamMemberActivityQuery,
  TeamOutletQuery,
  TeamPerformanceQuery,
  TeamProfileExportQuery,
} from '@ariforce/contracts';
import type { Response } from 'express';
import type * as z from 'zod';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { ZodPipe } from '../common/zod.pipe';
import { profilePdf, profileXlsx } from './team-profile.export';
import { TeamProfileService } from './team-profile.service';

/**
 * Team member profile (#75). `me:read` only gates "signed in"; the real rule (own profile for any
 * hierarchy role, others for ABM+ with reports:read strictly above) is enforced in the service.
 */
@Controller({ path: 'team/members/:userId', version: '1' })
export class TeamProfileController {
  constructor(private readonly svc: TeamProfileService) {}

  @Get('profile')
  @RequirePermissions('me:read')
  profile(@CurrentPrincipal() p: Principal, @Param('userId') id: string) {
    return this.svc.profile(p, id);
  }

  @Get('activity')
  @RequirePermissions('me:read')
  activity(
    @CurrentPrincipal() p: Principal,
    @Param('userId') id: string,
    @Query(new ZodPipe(TeamMemberActivityQuery)) q: z.output<typeof TeamMemberActivityQuery>,
  ) {
    return this.svc.activity(p, id, q);
  }

  @Get('performance')
  @RequirePermissions('me:read')
  performance(
    @CurrentPrincipal() p: Principal,
    @Param('userId') id: string,
    @Query(new ZodPipe(TeamPerformanceQuery)) q: z.output<typeof TeamPerformanceQuery>,
  ) {
    return this.svc.performance(p, id, q);
  }

  @Get('doctors')
  @RequirePermissions('me:read')
  doctors(
    @CurrentPrincipal() p: Principal,
    @Param('userId') id: string,
    @Query(new ZodPipe(TeamOutletQuery)) q: z.output<typeof TeamOutletQuery>,
  ) {
    return this.svc.doctors(p, id, q);
  }

  @Get('chemists')
  @RequirePermissions('me:read')
  chemists(
    @CurrentPrincipal() p: Principal,
    @Param('userId') id: string,
    @Query(new ZodPipe(TeamOutletQuery)) q: z.output<typeof TeamOutletQuery>,
  ) {
    return this.svc.chemists(p, id, q);
  }

  @Get('export')
  @RequirePermissions('me:read')
  async export(
    @CurrentPrincipal() p: Principal,
    @Param('userId') id: string,
    @Query(new ZodPipe(TeamProfileExportQuery)) q: z.output<typeof TeamProfileExportQuery>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { format, ...range } = q;
    const profile = await this.svc.profile(p, id);
    const perf = await this.svc.performance(p, id, range);
    const buf =
      format === 'xlsx'
        ? await profileXlsx({ profile, perf })
        : await profilePdf({ profile, perf });
    await this.svc.auditExport(p, id, q);
    const code = (profile.member.employeeCode ?? 'member').replace(/[^A-Za-z0-9_-]/g, '');
    res.setHeader(
      'content-type',
      format === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/pdf',
    );
    res.setHeader(
      'content-disposition',
      `attachment; filename="team-profile-${code}-${perf.from}_${perf.to}.${format}"`,
    );
    res.setHeader('cache-control', 'no-store');
    return new StreamableFile(buf);
  }
}
