/**
 * Product image (web side): every API call for product pictures lives here, so matching the final
 * contract only touches this file (and ./mock-handler.ts).
 *
 * Flow, same as the other R2 uploads: ask for a presigned URL, PUT the bytes straight to storage,
 * then attach the returned fileKey to the product. The API never proxies file bytes.
 *
 *   1. POST   /v1/files/upload-url        { purpose: 'product_image', contentType, sizeBytes, fileName }
 *                                          -> { fileKey, uploadUrl, method: 'PUT', headers, expiresAt }
 *   2. PUT    <uploadUrl>                  raw file bytes, with exactly `headers`
 *   3. PUT    /v1/products/{id}/image     { fileKey }  -> the product (or at least { imageUrl, version? })
 *   4. DELETE /v1/products/{id}/image     -> 200 with the AdminProduct (imageUrl null, version bumped if an image was removed)
 *   Read: `imageUrl` (string | null) on GET /v1/products and GET /v1/admin/products items.
 *
 * TODO(product-image): match this to the final Architect contract (API branch off deploy/api-dcr):
 * the purpose name ('product-image' vs the existing snake_case style 'product_image'), the set/clear
 * paths, the body key (fileKey vs fileId), the set/clear response shape, whether setting the image
 * bumps the product `version`, and the read field name (`imageUrl`). Then regenerate the openapi
 * types and drop the untyped client below.
 */
import { api, toApiError } from '@/lib/api';

export const PRODUCT_IMAGE_PURPOSE = 'product_image';
/** Client-side size limit. Change here only; the server limit is the real one. */
export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PRODUCT_IMAGE_MAX_MB = PRODUCT_IMAGE_MAX_BYTES / 1024 / 1024;
export const PRODUCT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ProductImageType = (typeof PRODUCT_IMAGE_TYPES)[number];
const EXT_TYPE: Record<string, ProductImageType> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
/** Accept list for <input type="file"> (types and extensions). */
export const PRODUCT_IMAGE_ACCEPT = [
  ...PRODUCT_IMAGE_TYPES,
  ...Object.keys(EXT_TYPE).map((e) => `.${e}`),
].join(',');

export class ProductImageError extends Error {}

/** The content type we will send, or null when the file is not JPEG, PNG or WebP. */
export function imageTypeOf(file: File): ProductImageType | null {
  if ((PRODUCT_IMAGE_TYPES as readonly string[]).includes(file.type))
    return file.type as ProductImageType;
  // Some browsers leave `type` empty; fall back to the extension.
  if (!file.type) return EXT_TYPE[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? null;
  return null;
}

/** A short message for a file we will not upload, or null when it is fine. */
export function checkProductImage(file: File): string | null {
  if (!imageTypeOf(file)) return 'Use a JPEG, PNG or WebP image.';
  if (file.size === 0) return 'This file is empty.';
  if (file.size > PRODUCT_IMAGE_MAX_BYTES)
    return `This image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${PRODUCT_IMAGE_MAX_MB} MB.`;
  return null;
}

/** The image URL on a product from any list (admin or /v1/products), until the types have it. */
export function productImageUrl(p: unknown): string | null {
  const v = (p as { imageUrl?: unknown } | null)?.imageUrl;
  return typeof v === 'string' && v ? v : null;
}

/** What set/clear give back; merge it into the row you hold. */
export type ProductImageResult = { imageUrl: string | null; version?: number };

type Raw = { data?: unknown; error?: unknown; response: Response };
type Init = { params?: { path?: Record<string, string> }; body?: unknown };
/** Untyped view of the client for routes the generated types do not have yet (see TODO above). */
const raw = api as unknown as {
  POST: (path: string, init: Init) => Promise<Raw>;
  PUT: (path: string, init: Init) => Promise<Raw>;
  DELETE: (path: string, init: Init) => Promise<Raw>;
};

function message(r: Raw): string {
  const e = toApiError(r);
  // Route or purpose not deployed yet: Nest answers 404 without our error envelope, zod a 422.
  if (r.response?.status === 404 && e.code !== 'PRODUCT_NOT_FOUND')
    return 'Product images are not switched on on the server yet.';
  if (e.code === 'PRODUCT_NOT_FOUND') return 'This product no longer exists. Reload the page.';
  if (e.code === 'FORBIDDEN')
    return 'Only users who can edit product prices can change product images.';
  if (e.code === 'VALIDATION')
    return e.message
      ? `The server refused this image: ${e.message}`
      : 'The server refused this image.';
  if (e.code === 'NETWORK')
    return 'Could not reach the server. Check your connection and try again.';
  if (r.response?.status === 503)
    return 'File storage is not available right now. Try again later.';
  return e.message || 'Something went wrong. Try again.';
}

function result(data: unknown): ProductImageResult {
  const d = (data ?? {}) as { imageUrl?: unknown; version?: unknown };
  return {
    imageUrl: productImageUrl(d),
    ...(typeof d.version === 'number' ? { version: d.version } : {}),
  };
}

function putXhr(
  url: string,
  headers: Record<string, string>,
  file: File,
  onProgress: (p: number) => void,
  signal?: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () =>
      x.status >= 200 && x.status < 300
        ? resolve()
        : reject(new ProductImageError('Upload failed. Try again.'));
    x.onerror = () => reject(new ProductImageError('Upload failed. Check your connection.'));
    x.onabort = () => reject(new ProductImageError('Upload cancelled.'));
    signal?.addEventListener('abort', () => x.abort());
    x.send(file);
  });
}

/** Upload `file` and make it the product's image. `onProgress` gets 0..1. */
export async function uploadProductImage(
  productId: string,
  file: File,
  onProgress: (p: number) => void,
  opts: { signal?: AbortSignal } = {},
): Promise<ProductImageResult> {
  const problem = checkProductImage(file);
  if (problem) throw new ProductImageError(problem);
  const contentType = imageTypeOf(file)!;
  const u = await raw.POST('/v1/files/upload-url', {
    body: {
      purpose: PRODUCT_IMAGE_PURPOSE,
      contentType,
      sizeBytes: file.size,
      fileName: file.name.slice(0, 200),
    },
  });
  const up = u.data as
    { fileKey?: string; uploadUrl?: string; headers?: Record<string, string> } | undefined;
  if (!up?.fileKey || !up.uploadUrl) throw new ProductImageError(message(u));
  await putXhr(
    up.uploadUrl,
    up.headers ?? { 'content-type': contentType },
    file,
    onProgress,
    opts.signal,
  );
  onProgress(1);
  const s = await raw.PUT('/v1/products/{id}/image', {
    params: { path: { id: productId } },
    body: { fileKey: up.fileKey },
  });
  if (!s.response?.ok) throw new ProductImageError(message(s));
  return result(s.data);
}

/** Clear the product's image. */
export async function removeProductImage(productId: string): Promise<ProductImageResult> {
  const r = await raw.DELETE('/v1/products/{id}/image', { params: { path: { id: productId } } });
  if (!r.response?.ok) throw new ProductImageError(message(r));
  return { ...result(r.data), imageUrl: null };
}
