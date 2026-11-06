import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  AllowanceDraftRequest,
  ExpenseAttachmentCreate,
  ExpenseClaimCreate,
  ExpenseClaimListQuery,
  ExpenseDecision,
  ExpenseExportQuery,
  ExpenseLineInput,
  ExpenseLineUpdate,
  ExpensePay,
  ExpenseReportQuery,
  Id,
} from '@ariforce/contracts';
import type { Response } from 'express';
import type * as z from 'zod';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { ZodPipe } from '../common/zod.pipe';
import { ExpensesService } from './expenses.service';
import { toPdf, toXlsx } from './export.util';

const id = (v: string, what = 'Expense claim') => {
  if (!Id.safeParse(v).success) throw new NotFoundException(`${what} not found`);
  return v;
};

/** Expense claims (#52). Reads are scoped in the service (own / reporting line / finance). */
@Controller({ path: 'expense-claims', version: '1' })
export class ExpenseClaimsController {
  constructor(private readonly svc: ExpensesService) {}

  @Get()
  @RequirePermissions('me:read')
  list(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(ExpenseClaimListQuery)) q: z.infer<typeof ExpenseClaimListQuery>,
  ) {
    return this.svc.list(p, q);
  }

  @Post()
  @RequirePermissions('expenses:write')
  async create(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(ExpenseClaimCreate)) b: z.infer<typeof ExpenseClaimCreate>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.svc.create(p, b.month);
    res.status(r.created ? 201 : 200);
    return r.claim;
  }

  @Get(':id')
  @RequirePermissions('me:read')
  get(@CurrentPrincipal() p: Principal, @Param('id') i: string) {
    return this.svc.get(p, id(i));
  }

  @Post(':id/lines')
  @HttpCode(201)
  @RequirePermissions('expenses:write')
  addLine(
    @CurrentPrincipal() p: Principal,
    @Param('id') i: string,
    @Body(new ZodPipe(ExpenseLineInput)) b: z.infer<typeof ExpenseLineInput>,
  ) {
    return this.svc.addLine(p, id(i), b);
  }

  @Put(':id/lines/:lineId')
  @RequirePermissions('expenses:write')
  updateLine(
    @CurrentPrincipal() p: Principal,
    @Param('id') i: string,
    @Param('lineId') l: string,
    @Body(new ZodPipe(ExpenseLineUpdate)) b: z.infer<typeof ExpenseLineUpdate>,
  ) {
    return this.svc.updateLine(p, id(i), id(l, 'Expense line'), b.line, b.version);
  }

  @Delete(':id/lines/:lineId')
  @RequirePermissions('expenses:write')
  deleteLine(@CurrentPrincipal() p: Principal, @Param('id') i: string, @Param('lineId') l: string) {
    return this.svc.deleteLine(p, id(i), id(l, 'Expense line'));
  }

  @Post(':id/lines/:lineId/attachments')
  @HttpCode(201)
  @RequirePermissions('expenses:write')
  attach(
    @CurrentPrincipal() p: Principal,
    @Param('id') i: string,
    @Param('lineId') l: string,
    @Body(new ZodPipe(ExpenseAttachmentCreate)) b: z.infer<typeof ExpenseAttachmentCreate>,
  ) {
    return this.svc.createAttachment(p, id(i), id(l, 'Expense line'), b);
  }

  @Post(':id/allowances')
  @HttpCode(200)
  @RequirePermissions('expenses:write')
  draftAllowances(
    @CurrentPrincipal() p: Principal,
    @Param('id') claimId: string,
    @Body(new ZodPipe(AllowanceDraftRequest)) b: z.infer<typeof AllowanceDraftRequest>,
  ) {
    return this.svc.draftAllowances(p, id(claimId), b);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermissions('expenses:write')
  submit(@CurrentPrincipal() p: Principal, @Param('id') i: string) {
    return this.svc.submit(p, id(i));
  }

  @Post(':id/decision')
  @HttpCode(200)
  @RequirePermissions('expenses:approve')
  decide(
    @CurrentPrincipal() p: Principal,
    @Param('id') i: string,
    @Body(new ZodPipe(ExpenseDecision)) b: z.infer<typeof ExpenseDecision>,
  ) {
    return this.svc.decide(p, id(i), b);
  }

  @Post(':id/pay')
  @HttpCode(200)
  @RequirePermissions('expenses:pay')
  pay(
    @CurrentPrincipal() p: Principal,
    @Param('id') i: string,
    @Body(new ZodPipe(ExpensePay)) b: z.infer<typeof ExpensePay>,
  ) {
    return this.svc.pay(p, id(i), b.paymentRef);
  }

  @Get(':id/reconciliation')
  @RequirePermissions('me:read')
  reconciliation(@CurrentPrincipal() p: Principal, @Param('id') i: string) {
    return this.svc.reconciliation(p, id(i));
  }
}

@Controller({ path: 'expense-attachments', version: '1' })
export class ExpenseAttachmentsController {
  constructor(private readonly svc: ExpensesService) {}

  @Post(':id/confirm')
  @HttpCode(200)
  @RequirePermissions('expenses:write')
  confirm(@CurrentPrincipal() p: Principal, @Param('id') i: string) {
    return this.svc.confirmAttachment(p, id(i, 'Attachment'));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('expenses:write')
  remove(@CurrentPrincipal() p: Principal, @Param('id') i: string) {
    return this.svc.deleteAttachment(p, id(i, 'Attachment'));
  }

  @Post(':id/download-url')
  @HttpCode(200)
  @RequirePermissions('me:read')
  download(@CurrentPrincipal() p: Principal, @Param('id') i: string) {
    return this.svc.downloadUrl(p, id(i, 'Attachment'));
  }
}

@Controller({ path: 'expense-reports', version: '1' })
export class ExpenseReportsController {
  constructor(private readonly svc: ExpensesService) {}

  @Get()
  @RequirePermissions('me:read')
  report(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(ExpenseReportQuery)) q: z.infer<typeof ExpenseReportQuery>,
  ) {
    return this.svc.report(p, q);
  }

  @Get('export')
  @RequirePermissions('me:read')
  async export(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(ExpenseExportQuery)) q: z.infer<typeof ExpenseExportQuery>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { format, ...rest } = q;
    const data = await this.svc.reportData(p, rest);
    const statements = await this.svc.statements(p, q.month, data);
    const buf =
      format === 'xlsx'
        ? await toXlsx(q.month, data, statements)
        : await toPdf(q.month, statements);
    await this.svc.auditExport(p, q, data.length);
    res.setHeader(
      'content-type',
      format === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/pdf',
    );
    res.setHeader('content-disposition', `attachment; filename="expenses-${q.month}.${format}"`);
    res.setHeader('cache-control', 'no-store');
    return new StreamableFile(buf);
  }
}
