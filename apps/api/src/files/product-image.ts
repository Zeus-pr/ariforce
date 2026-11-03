import {
  PRODUCT_IMAGE_CONTENT_TYPES,
  PRODUCT_IMAGE_MAX_BYTES,
  type ProductImageContentType,
} from '@ariforce/contracts';

/** Canonical R2 key extension per product_image content type (same as StorageService EXT). */
export const PRODUCT_IMAGE_EXT: Record<ProductImageContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const KEY_TAIL = new RegExp(`^product_image/\\d{4}/\\d{2}/${UUID}\\.(jpg|png|webp)$`);

/** A key minted by POST /v1/files/upload-url (purpose product_image) for this company. */
export function isProductImageKey(companyId: string, key: string): boolean {
  const prefix = `${companyId}/`;
  return key.startsWith(prefix) && KEY_TAIL.test(key.slice(prefix.length));
}

/** `reason` goes to error.details.reason; the error code is always VALIDATION (422). */
export type ImageRejection = { reason: string; message: string };

/** HEAD result checks: exists, 1..5 MB, allowed type matching the key extension. */
export function checkProductImageHead(
  key: string,
  head: { sizeBytes: number; contentType: string | null } | null,
): { contentType: ProductImageContentType } | ImageRejection {
  if (!head) return { reason: 'UPLOAD_MISSING', message: 'Upload not found; PUT the file first' };
  if (head.sizeBytes > PRODUCT_IMAGE_MAX_BYTES)
    return { reason: 'UPLOAD_TOO_LARGE', message: 'Product image is at most 5 MB' };
  if (head.sizeBytes < 1)
    return { reason: 'UPLOAD_FORMAT_INVALID', message: 'Uploaded file is empty' };
  const type = (head.contentType ?? '').split(';')[0]!.trim().toLowerCase();
  const ok = (PRODUCT_IMAGE_CONTENT_TYPES as readonly string[]).includes(type);
  if (!ok || !key.endsWith(`.${PRODUCT_IMAGE_EXT[type as ProductImageContentType]}`))
    return {
      reason: 'UPLOAD_TYPE_INVALID',
      message: 'Product image must be image/jpeg, image/png or image/webp',
    };
  return { contentType: type as ProductImageContentType };
}

const startsWith = (b: Uint8Array, sig: number[], at = 0) =>
  b.length >= at + sig.length && sig.every((x, i) => b[at + i] === x);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** Magic-byte check (same idea as expenses sniffMatches; adds WebP). Not a virus scan. */
export function sniffImage(type: ProductImageContentType, b: Uint8Array): boolean {
  switch (type) {
    case 'image/jpeg':
      return startsWith(b, [0xff, 0xd8, 0xff]);
    case 'image/png':
      return startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/webp':
      return startsWith(b, ascii('RIFF')) && startsWith(b, ascii('WEBP'), 8);
  }
}
