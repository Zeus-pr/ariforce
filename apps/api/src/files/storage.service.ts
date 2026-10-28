import { HttpException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
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
/** Product pictures: signed for 60 min from the start of a 30-min window, so each URL is valid for
 * at least 30 min and identical within the window (browser/CDN cacheable, cheap for long lists). */
export const IMAGE_URL_TTL_S = 3600;
export const IMAGE_URL_WINDOW_S = 1800;

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
  private imageCache = { window: -1, urls: new Map<string, string>() };

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
    return this.presignPut(
      companyId,
      req.purpose,
      req.contentType,
      req.sizeBytes,
      EXT[req.contentType],
      now,
    );
  }

  /** Presigned PUT for any purpose; key = `<companyId>/<purpose>/<yyyy>/<mm>/<uuidv7>.<ext>` (no names). */
  async presignPut(
    companyId: string,
    purpose: string,
    contentType: string,
    sizeBytes: number,
    ext: string,
    now = new Date(),
  ): Promise<UploadUrlResponse> {
    const req = { contentType, sizeBytes };
    const { client, bucket } = this.ready();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const fileKey = `${companyId}/${purpose}/${now.getUTCFullYear()}/${mm}/${uuidv7()}.${ext}`;
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

  /** Size and content type of an uploaded object, or null when it does not exist. */
  async head(fileKey: string): Promise<{ sizeBytes: number; contentType: string | null } | null> {
    const { client, bucket } = this.ready();
    try {
      const h = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: fileKey }));
      return { sizeBytes: Number(h.ContentLength ?? 0), contentType: h.ContentType ?? null };
    } catch (e) {
      const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return null;
      throw e;
    }
  }

  /** First `n` bytes (ranged GET) for format/magic-byte checks. */
  async firstBytes(fileKey: string, n = 512): Promise<Uint8Array> {
    const { client, bucket } = this.ready();
    const r = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: fileKey, Range: `bytes=0-${n - 1}` }),
    );
    return (await r.Body?.transformToByteArray()) ?? new Uint8Array();
  }

  async remove(fileKey: string): Promise<void> {
    const { client, bucket } = this.ready();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: fileKey }));
  }

  /**
   * Inline presigned GET for a picture of the caller's company (local crypto, no R2 call; memoised per
   * window). Null when storage is not configured or the key is foreign, so lists never fail on it.
   */
  async imageUrl(companyId: string, fileKey: string, now = new Date()): Promise<string | null> {
    if (!this.client || !this.bucket) return null;
    if (!fileKey.startsWith(`${companyId}/`) || fileKey.includes('..')) return null;
    const window = Math.floor(now.getTime() / (IMAGE_URL_WINDOW_S * 1000));
    if (this.imageCache.window !== window) this.imageCache = { window, urls: new Map() };
    const hit = this.imageCache.urls.get(fileKey);
    if (hit) return hit;
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: fileKey }),
      { expiresIn: IMAGE_URL_TTL_S, signingDate: new Date(window * IMAGE_URL_WINDOW_S * 1000) },
    );
    if (this.imageCache.urls.size < 5000) this.imageCache.urls.set(fileKey, url);
    return url;
  }

  async downloadUrl(
    companyId: string,
    fileKey: string,
    now = new Date(),
    downloadName?: string,
  ): Promise<DownloadUrlResponse> {
    if (!fileKey.startsWith(`${companyId}/`) || fileKey.includes('..'))
      throw new NotFoundException('File not found');
    const { client, bucket } = this.ready();
    const downloadUrl = await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: bucket,
        Key: fileKey,
        ...(downloadName
          ? { ResponseContentDisposition: `attachment; filename="${downloadName}"` }
          : {}),
      }),
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
