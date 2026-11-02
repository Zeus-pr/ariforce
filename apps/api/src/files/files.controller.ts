import { Body, Controller, ForbiddenException, HttpCode, Post } from '@nestjs/common';
import {
  DownloadUrlRequest,
  UploadUrlRequest,
  type DownloadUrlResponse,
  type UploadUrlResponse,
} from '@ariforce/contracts';
import { CurrentPrincipal } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { AuditService } from '../common/audit.service';
import { TenantService } from '../common/tenant.service';
import { ZodPipe } from '../common/zod.pipe';
import { StorageService } from './storage.service';
import { err } from '../field/checkins.service';

/** Presigned R2 URLs. Any signed-in tenant user; per-record checks happen where fileKey is attached. */
@Controller({ path: 'files', version: '1' })
export class FilesController {
  constructor(
    private readonly storage: StorageService,
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
  ) {}

  @Post('upload-url')
  @HttpCode(200)
  async upload(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(UploadUrlRequest)) body: UploadUrlRequest,
  ): Promise<UploadUrlResponse> {
    if (body.purpose === 'expense_receipt')
      throw err(
        422,
        'VALIDATION',
        'Expense receipts use POST /v1/expense-claims/{id}/lines/{lineId}/attachments',
      );
    if (body.purpose === 'import_source' && !p.permissions.includes('imports:write'))
      throw new ForbiddenException('Missing permission: imports:write');
    if (body.purpose === 'product_image' && !p.permissions.includes('products:prices'))
      throw new ForbiddenException('Missing permission: products:prices');
    const res = await this.storage.uploadUrl(p.companyId, body);
    await this.tenant.run(p, (tx) =>
      this.audit.record(tx, p, 'file.upload_url', {
        entityType: 'file',
        entityId: res.fileKey,
        after: { purpose: body.purpose, contentType: body.contentType, sizeBytes: body.sizeBytes },
      }),
    );
    return res;
  }

  @Post('download-url')
  @HttpCode(200)
  download(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(DownloadUrlRequest)) body: DownloadUrlRequest,
  ): Promise<DownloadUrlResponse> {
    return this.storage.downloadUrl(p.companyId, body.fileKey);
  }
}
