import * as z from 'zod';
import { Timestamp } from './common';

export const FILE_PURPOSES = [
  'doctor_photo',
  'visit_attachment',
  'expense_receipt',
  'avatar',
  'import_source',
  'product_image',
] as const;
export const FilePurpose = z.enum(FILE_PURPOSES).meta({ id: 'FilePurpose' });
export const ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;
/** Content types allowed for `import_source` (Excel/CSV kept for audit); other purposes may not use them. */
export const IMPORT_CONTENT_TYPES = [
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** `product_image` (product picture, attached via PUT /v1/products/{id}/image). */
export const PRODUCT_IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ProductImageContentType = (typeof PRODUCT_IMAGE_CONTENT_TYPES)[number];
export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export const UploadUrlRequest = z
  .object({
    purpose: FilePurpose,
    contentType: z.enum(ALLOWED_CONTENT_TYPES),
    sizeBytes: z.int().min(1).max(MAX_UPLOAD_BYTES),
    fileName: z.string().min(1).max(200).optional(),
  })
  .refine(
    (r) =>
      (r.purpose === 'import_source') ===
      (IMPORT_CONTENT_TYPES as readonly string[]).includes(r.contentType),
    {
      message:
        'import_source needs text/csv or .xlsx; spreadsheets are only allowed for import_source',
      path: ['contentType'],
    },
  )
  .refine(
    (r) =>
      r.purpose !== 'product_image' ||
      (PRODUCT_IMAGE_CONTENT_TYPES as readonly string[]).includes(r.contentType),
    { message: 'product_image needs image/jpeg, image/png or image/webp', path: ['contentType'] },
  )
  .refine((r) => r.purpose !== 'product_image' || r.sizeBytes <= PRODUCT_IMAGE_MAX_BYTES, {
    message: 'product_image is at most 5 MB',
    path: ['sizeBytes'],
  })
  .meta({ id: 'UploadUrlRequest' });
export type UploadUrlRequest = z.infer<typeof UploadUrlRequest>;

export const UploadUrlResponse = z
  .object({
    fileKey: z.string().meta({ description: 'Store this on the owning record; tenant-prefixed' }),
    uploadUrl: z.url(),
    method: z.literal('PUT'),
    headers: z
      .record(z.string(), z.string())
      .meta({ description: 'Send exactly these headers with the PUT' }),
    expiresAt: Timestamp,
  })
  .meta({ id: 'UploadUrlResponse' });
export type UploadUrlResponse = z.infer<typeof UploadUrlResponse>;

export const DownloadUrlRequest = z
  .object({ fileKey: z.string().min(1).max(300) })
  .meta({ id: 'DownloadUrlRequest' });
export type DownloadUrlRequest = z.infer<typeof DownloadUrlRequest>;

export const DownloadUrlResponse = z
  .object({ downloadUrl: z.url(), expiresAt: Timestamp })
  .meta({ id: 'DownloadUrlResponse' });
export type DownloadUrlResponse = z.infer<typeof DownloadUrlResponse>;
