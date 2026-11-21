import { Body, Controller, Delete, Get, Param, Post, Query, StreamableFile } from '@nestjs/common';
import {
  StockStatementFileConfirm,
  StockStatementFileRequest,
  StockStatementListQuery,
  StockStatementOpen,
  StockStatementSave,
  StockStatementSubmit,
} from '@ariforce/contracts';
import type * as z from 'zod';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { ZodPipe } from '../common/zod.pipe';
import { StockStatementsService } from './stock-statements.service';

@Controller({ path: 'stock-statements', version: '1' })
export class StockStatementsController {
  constructor(private readonly svc: StockStatementsService) {}

  @Get('stockists')
  @RequirePermissions('stock_statements:read')
  stockists(@CurrentPrincipal() p: Principal) {
    return this.svc.stockists(p);
  }

  @Get()
  @RequirePermissions('stock_statements:read')
  list(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(StockStatementListQuery)) q: z.infer<typeof StockStatementListQuery>,
  ) {
    return this.svc.list(p, q);
  }

  @Post()
  @RequirePermissions('stock_statements:read')
  open(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(StockStatementOpen)) b: z.infer<typeof StockStatementOpen>,
  ) {
    return this.svc.open(p, b.stockistId, b.month);
  }

  @Get(':id')
  @RequirePermissions('stock_statements:read')
  get(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.svc.get(p, id);
  }

  @Post(':id/lines')
  @RequirePermissions('stock_statements:read')
  save(
    @CurrentPrincipal() p: Principal,
    @Param('id') id: string,
    @Body(new ZodPipe(StockStatementSave)) b: z.infer<typeof StockStatementSave>,
  ) {
    return this.svc.save(p, id, b.version, b.lines);
  }

  @Post(':id/unlock')
  @RequirePermissions('stock_statements:read')
  unlock(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.svc.requestUnlock(p, id);
  }

  @Post(':id/submit')
  @RequirePermissions('stock_statements:read')
  submit(
    @CurrentPrincipal() p: Principal,
    @Param('id') id: string,
    @Body(new ZodPipe(StockStatementSubmit)) b: z.infer<typeof StockStatementSubmit>,
  ) {
    return this.svc.submit(p, id, b.version);
  }

  @Post(':id/files')
  @RequirePermissions('stock_statements:read')
  presign(
    @CurrentPrincipal() p: Principal,
    @Param('id') id: string,
    @Body(new ZodPipe(StockStatementFileRequest)) b: z.infer<typeof StockStatementFileRequest>,
  ) {
    return this.svc.presign(p, id, b);
  }

  @Post(':id/files/confirm')
  @RequirePermissions('stock_statements:read')
  confirm(
    @CurrentPrincipal() p: Principal,
    @Param('id') id: string,
    @Body(new ZodPipe(StockStatementFileConfirm)) b: z.infer<typeof StockStatementFileConfirm>,
  ) {
    return this.svc.confirmFile(p, id, b.kind);
  }

  @Delete(':id/files/:kind')
  @RequirePermissions('stock_statements:read')
  removeFile(
    @CurrentPrincipal() p: Principal,
    @Param('id') id: string,
    @Param('kind') kind: 'aws' | 'ss',
  ) {
    return this.svc.removeFile(p, id, kind === 'ss' ? 'ss' : 'aws');
  }

  @Get(':id/files/:kind')
  @RequirePermissions('stock_statements:read')
  file(
    @CurrentPrincipal() p: Principal,
    @Param('id') id: string,
    @Param('kind') kind: 'aws' | 'ss',
  ) {
    return this.svc.fileUrl(p, id, kind === 'ss' ? 'ss' : 'aws');
  }

  @Get(':id/export')
  @RequirePermissions('stock_statements:read')
  async pdf(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    const buf = await this.svc.pdf(p, id);
    return new StreamableFile(buf, {
      type: 'application/pdf',
      disposition: `attachment; filename="stock-sales-${id}.pdf"`,
    });
  }
}
