/**
 * Mock mode only: product images, in the shapes lib/products/product-image.ts assumes (see the TODO
 * there). Registered before the contracts mock:
 *  - POST /v1/files/upload-url with purpose 'product_image' (other purposes fall through),
 *  - PUT  to the fake signed URL (keeps the bytes as a blob: URL in this tab),
 *  - PUT/DELETE /v1/products/:id/image,
 *  - GET /v1/products and /v1/admin/products: answered by the contracts mock, then given `imageUrl`.
 * State lives in the page and is lost on reload, like the other mocks.
 */
import { getResponse, http, HttpResponse, type RequestHandler } from 'msw';
import { fixtures } from '@ariforce/contracts/mocks';
import { SESSION_KEY } from '@/lib/auth-boot';
import { canEditProductPrices } from '@/lib/permissions';
import type { Role } from '@/lib/roles';
import { PRODUCT_IMAGE_MAX_BYTES, PRODUCT_IMAGE_PURPOSE, PRODUCT_IMAGE_TYPES } from './product-image';

const R2 = 'https://mock-r2.invalid/product-image';
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
/** upload id -> blob: URL of the bytes PUT to the fake signed URL. */
const uploaded = new Map<string, string>();
/** productId -> { fileKey, url } */
const images = new Map<string, { fileKey: string; url: string }>();

const e = (status: number, code: string, message: string) => HttpResponse.json({ error: { code, message } }, { status });

function currentRole(): Role | null {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as { role?: Role; previewRole?: Role } | null;
    return s?.previewRole ?? s?.role ?? null;
  } catch {
    return null;
  }
}
const forbidden = () => {
  const role = currentRole();
  return !role || !canEditProductPrices(role) ? e(403, 'FORBIDDEN', 'Missing permission: products:prices') : null;
};
const product = (id: string) => fixtures.products.find((p) => p.id === id && !p.deletedAt);

export function mockProductImages(base: string, contractHandlers: RequestHandler[]) {
  /** Let the contracts mock answer a product list, then add `imageUrl` to each item. */
  const withImages = async ({ request }: { request: Request }) => {
    const res = await getResponse(contractHandlers, request);
    if (!res?.ok) return res;
    const body = (await res.json()) as { items?: { id: string }[] };
    if (!Array.isArray(body.items)) return HttpResponse.json(body, { status: res.status });
    return HttpResponse.json(
      { ...body, items: body.items.map((p) => ({ ...p, imageUrl: images.get(p.id)?.url ?? null })) },
      { status: res.status },
    );
  };

  return [
    http.post(`${base}/v1/files/upload-url`, async ({ request }) => {
      const b = (await request.clone().json().catch(() => ({}))) as { purpose?: string; contentType?: string; sizeBytes?: number };
      if (b.purpose !== PRODUCT_IMAGE_PURPOSE) return undefined;
      const no = forbidden();
      if (no) return no;
      if (!b.contentType || !(PRODUCT_IMAGE_TYPES as readonly string[]).includes(b.contentType))
        return e(422, 'VALIDATION', 'contentType: use image/jpeg, image/png or image/webp');
      if (typeof b.sizeBytes !== 'number' || b.sizeBytes < 1 || b.sizeBytes > PRODUCT_IMAGE_MAX_BYTES)
        return e(422, 'VALIDATION', `sizeBytes: at most ${PRODUCT_IMAGE_MAX_BYTES} bytes`);
      const id = crypto.randomUUID();
      return HttpResponse.json({
        fileKey: `mock/product-image/${new Date().toISOString().slice(0, 7).replace('-', '/')}/${id}.${EXT[b.contentType]}`,
        uploadUrl: `${R2}/${id}`,
        method: 'PUT',
        headers: { 'content-type': b.contentType },
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      });
    }),
    http.put(`${R2}/:id`, async ({ request, params }) => {
      // Keyed by the upload id; the fileKey ends in `<id>.<ext>`, so attach can find it.
      const id = String(params.id);
      const prev = uploaded.get(id);
      if (prev) URL.revokeObjectURL(prev);
      uploaded.set(id, URL.createObjectURL(await request.blob()));
      return new HttpResponse(null, { status: 200 });
    }),
    http.put(`${base}/v1/products/:id/image`, async ({ request, params }) => {
      const no = forbidden();
      if (no) return no;
      const p = product(String(params.id));
      if (!p) return e(404, 'PRODUCT_NOT_FOUND', 'Product not found');
      const { fileKey } = (await request.json().catch(() => ({}))) as { fileKey?: string };
      const uploadId = fileKey?.match(/\/([0-9a-f-]{36})\.\w+$/)?.[1];
      const url = uploadId ? uploaded.get(uploadId) : undefined;
      if (!fileKey || !uploadId || !url) return e(422, 'VALIDATION', 'fileKey: no uploaded file with this key');
      uploaded.delete(uploadId);
      const old = images.get(p.id);
      if (old) URL.revokeObjectURL(old.url);
      images.set(p.id, { fileKey, url });
      return HttpResponse.json({ id: p.id, imageUrl: url });
    }),
    http.delete(`${base}/v1/products/:id/image`, ({ params }) => {
      const no = forbidden();
      if (no) return no;
      const p = product(String(params.id));
      if (!p) return e(404, 'PRODUCT_NOT_FOUND', 'Product not found');
      const old = images.get(p.id);
      if (old) URL.revokeObjectURL(old.url);
      images.delete(p.id);
      return new HttpResponse(null, { status: 204 });
    }),
    http.get(`${base}/v1/admin/products`, withImages),
    http.get(`${base}/v1/products`, withImages),
  ];
}
