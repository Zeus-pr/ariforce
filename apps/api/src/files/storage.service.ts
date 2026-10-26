import { HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { DownloadUrlResponse, UploadUrlRequest, UploadUrlResponse } from '@ariforce/contracts';
import { v7 as uuidv7 } from 'uuid';

const EXT: Record<UploadUrlRequest['contentType'], string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};
export const UPLOAD_TTL_S = 600;
export const DOWNLOAD_TTL_S = 300;

export interface StorageEnv {
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET?: string;
  R2_ENDPOINT?: string;
}

/**
 * Cloudflare R2 via the S3 API. The API never proxies file bytes: clients PUT/GET directly with
 * short-lived presigned URLs. Keys are `<companyId>/<purpose>/<yyyy>/<mm>/<uuidv7>.<ext>`, so the
 * tenant check on download is a prefix match against the caller's company.
 */
@Injectable()
export class StorageService {
  private readonly client: S3Client | null;
  private readonly bucket: string | null;

  constructor(env: StorageEnv = process.env) {
    const endpoint =
      env.R2_ENDPOINT ??
      (env.R2_ACCOUNT_ID ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined);
    const ok = endpoint && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET;
    this.bucket = ok ? env.R2_BUCKET! : null;
    this.client = ok
      ? new S3Client({
          region: 'auto',
          endpoint,
          credentials: {
            accessKeyId: env.R2_ACCESS_KEY_ID!,
            secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
          },
        })
      : null;
  }

  private ready() {
    if (!this.client || !this.bucket)
      throw new HttpException('File storage is not configured', 503);
    return { client: this.client, bucket: this.bucket };
  }

  async uploadUrl(
    companyId: string,
    req: UploadUrlRequest,
    now = new Date(),
  ): Promise<UploadUrlResponse> {
    const { client, bucket } = this.ready();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const fileKey = `${companyId}/${req.purpose}/${now.getUTCFullYear()}/${mm}/${uuidv7()}.${EXT[req.contentType]}`;
    const cmd = new PutObjectCommand({
      Bucket: bucket,
      Key: fileKey,
      ContentType: req.contentType,
      ContentLength: req.sizeBytes,
    });
    const uploadUrl = await getSignedUrl(client, cmd, {
      expiresIn: UPLOAD_TTL_S,
      signableHeaders: new Set(['content-type', 'content-length']),
    });
    return {
      fileKey,
      uploadUrl,
      method: 'PUT',
      headers: { 'content-type': req.contentType, 'content-length': String(req.sizeBytes) },
      expiresAt: new Date(now.getTime() + UPLOAD_TTL_S * 1000).toISOString(),
    };
  }

  async downloadUrl(
    companyId: string,
    fileKey: string,
    now = new Date(),
  ): Promise<DownloadUrlResponse> {
    if (!fileKey.startsWith(`${companyId}/`) || fileKey.includes('..'))
      throw new NotFoundException('File not found');
    const { client, bucket } = this.ready();
    const downloadUrl = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: bucket, Key: fileKey }),
      {
        expiresIn: DOWNLOAD_TTL_S,
      },
    );
    return {
      downloadUrl,
      expiresAt: new Date(now.getTime() + DOWNLOAD_TTL_S * 1000).toISOString(),
    };
  }
}
