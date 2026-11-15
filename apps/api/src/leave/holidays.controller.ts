import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { HolidayCopy, HolidayCreate, HolidayQuery, HolidayUpdate, Id } from '@ariforce/contracts';
import type * as z from 'zod';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { ZodPipe } from '../common/zod.pipe';
import { err } from '../field/checkins.service';
import { HolidaysService } from './holidays.service';

const id = (v: string) => {
  if (!Id.safeParse(v).success) throw err(404, 'NOT_FOUND', 'That holiday was not found');
  return v;
};

@Controller({ path: 'holidays', version: '1' })
export class HolidaysController {
  constructor(private readonly svc: HolidaysService) {}

  @Get()
  @RequirePermissions('me:read')
  list(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(HolidayQuery)) q: z.infer<typeof HolidayQuery>,
  ) {
    return this.svc.list(p, q);
  }

  @Post('copy')
  @RequirePermissions('settings:write')
  copy(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(HolidayCopy)) b: z.infer<typeof HolidayCopy>,
  ) {
    return this.svc.copy(p, b);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('settings:write')
  create(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(HolidayCreate)) b: z.infer<typeof HolidayCreate>,
  ) {
    return this.svc.create(p, b);
  }

  @Patch(':id')
  @RequirePermissions('settings:write')
  update(
    @CurrentPrincipal() p: Principal,
    @Param('id') i: string,
    @Body(new ZodPipe(HolidayUpdate)) b: z.infer<typeof HolidayUpdate>,
  ) {
    return this.svc.update(p, id(i), b);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('settings:write')
  remove(@CurrentPrincipal() p: Principal, @Param('id') i: string) {
    return this.svc.remove(p, id(i));
  }
}
