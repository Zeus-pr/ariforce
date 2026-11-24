import { Controller, Get, Put, Body, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { PayslipService, type StructureInput } from './payslip.service';

@Controller({ path: 'payslips', version: '1' })
export class PayslipController {
  constructor(private readonly payslips: PayslipService) {}

  @Get()
  @RequirePermissions('me:read')
  slip(
    @CurrentPrincipal() p: Principal,
    @Query('year') year: string,
    @Query('month') month: string,
    @Query('userId') userId?: string,
  ) {
    return this.payslips.slip(p, Number(year), Number(month), userId);
  }

  @Get('file')
  @RequirePermissions('me:read')
  async file(
    @CurrentPrincipal() p: Principal,
    @Query('year') year: string,
    @Query('month') month: string,
    @Query('userId') userId: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { pdf, name } = await this.payslips.file(p, Number(year), Number(month), userId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    return new StreamableFile(pdf);
  }

  @Put('structure')
  @RequirePermissions('users:write')
  save(@CurrentPrincipal() p: Principal, @Body() body: StructureInput) {
    return this.payslips.saveStructure(p, body);
  }
}
