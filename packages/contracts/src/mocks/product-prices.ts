import { http, HttpResponse } from 'msw';
import type { Me } from '../schemas/auth';
import {
  AdminProductQuery,
  ProductPricesBulkRequest,
  ProductPricesBulkRow,
  ProductPricesUpdate,
  pricesConsistent,
  type AdminProduct,
  type ProductPricesBulkResult,
} from '../schemas/product-prices';
import * as fx from './fixtures';

/**
 * Mock product prices admin. Same shapes, permission (`products:prices`, system_admin only) and
 * error codes as the API; mutates fx.products so the masters product list shows the new prices.
 * Simplifications: in-memory history, offset cursor, versions bumped locally.
 */
type Prices = { mrp: number | null; ptr: number | null; pts: number | null };
type Hist = {
  id: string;
  productId: string;
  old: Prices;
  new: Prices;
  source: 'single' | 'bulk' | 'masters';
  bulkId: string | null;
  changedBy: { id: string; name: string };
  changedAt: string;
};
const KEYS = ['mrp', 'ptr', 'pts'] as const;
const history: Hist[] = [];
let seq = 0;
const uid = () => `00000000-0000-4000-8000-${(0xf00000000000 + ++seq).toString(16)}`;
const e = (status: number, code: string, message: string, details?: unknown) =>
  HttpResponse.json({ error: { code, message, details } }, { status });
const enc = (n: number) => btoa(`o:${n}`);
const dec = (c?: string) => (c ? Number(/^o:(\d+)$/.exec(atob(c))?.[1] ?? 0) : 0);

const dto = (p: (typeof fx.products)[number]): AdminProduct => {
  const h = history.find((x) => x.productId === p.id);
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    brand: p.brand,
    divisionId: p.divisionId,
    active: p.active,
    mrp: p.mrp,
    ptr: p.ptr,
    pts: p.pts,
    updatedAt: p.updatedAt,
    updatedBy: h ? h.changedBy : null,
    pricesUpdatedAt: h ? h.changedAt : null,
    version: p.version,
  };
};

type Fail = { status: number; code: string; message: string };
function apply(
  me: Me,
  key: { productId?: string; code?: string },
  patch: Partial<Prices>,
  version: number | undefined,
  source: 'single' | 'bulk',
  bulkId: string | null,
): Fail | { p: (typeof fx.products)[number]; changed: boolean } {
  const p = fx.products.find((x) =>
    key.productId ? x.id === key.productId : x.code.toUpperCase() === key.code?.toUpperCase(),
  );
  if (!p || p.deletedAt)
    return { status: 404, code: 'PRODUCT_NOT_FOUND', message: 'Product not found' };
  if (version !== undefined && version !== p.version)
    return { status: 409, code: 'VERSION_CONFLICT', message: 'Product changed; reload' };
  const before: Prices = { mrp: p.mrp, ptr: p.ptr, pts: p.pts };
  const after: Prices = { ...before };
  for (const k of KEYS) if (k in patch) after[k] = patch[k] ?? null;
  if (!pricesConsistent(after))
    return { status: 422, code: 'PTR_ABOVE_MRP', message: 'PTR cannot be above MRP' };
  const changed = KEYS.some((k) => before[k] !== after[k]);
  if (changed) {
    Object.assign(p, after, { version: p.version + 1, updatedAt: new Date().toISOString() });
    history.unshift({
      id: uid(),
      productId: p.id,
      old: before,
      new: after,
      source,
      bulkId,
      changedBy: { id: me.id, name: me.name },
      changedAt: new Date().toISOString(),
    });
  }
  return { p, changed };
}

export function productPriceHandlers(baseUrl: string, who: (r: Request) => Me | undefined) {
  const B = `${baseUrl}/v1/admin/products`;
  const auth = (request: Request) => {
    const p = who(request);
    if (!p) return { res: e(401, 'UNAUTHENTICATED', 'Sign in required') };
    if (!(p.permissions as string[]).includes('products:prices'))
      return { res: e(403, 'FORBIDDEN', 'Missing permission: products:prices') };
    return { p };
  };
  const body = async (request: Request) => request.json().catch(() => ({}));
  const invalid = (issues: { path: PropertyKey[]; message: string }[]) =>
    e(422, 'VALIDATION', issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));

  return [
    http.get(B, ({ request }) => {
      const a = auth(request);
      if (a.res) return a.res;
      const q = AdminProductQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
      if (!q.success) return invalid(q.error.issues);
      const { q: text, missingPtr, active, brand, divisionId } = q.data;
      const t = text?.toLowerCase();
      const rows = fx.products
        .filter((p) => !p.deletedAt)
        .filter((p) => !t || p.code.toLowerCase().includes(t) || p.name.toLowerCase().includes(t))
        .filter((p) => !missingPtr || (p.ptr === null) === (missingPtr === 'true'))
        .filter((p) => !active || p.active === (active === 'true'))
        .filter((p) => !brand || p.brand?.toLowerCase() === brand.toLowerCase())
        .filter((p) => !divisionId || p.divisionId === divisionId)
        .sort((x, y) => x.code.localeCompare(y.code));
      const limit = q.data.limit ?? 50;
      const off = dec(q.data.cursor);
      return HttpResponse.json({
        items: rows.slice(off, off + limit).map(dto),
        nextCursor: rows.length > off + limit ? enc(off + limit) : null,
      });
    }),
    http.patch(`${B}/:id/prices`, async ({ request, params }) => {
      const a = auth(request);
      if (a.res) return a.res;
      const b = ProductPricesUpdate.safeParse(await body(request));
      if (!b.success) return invalid(b.error.issues);
      const { version, ...patch } = b.data;
      const r = apply(a.p, { productId: String(params.id) }, patch, version, 'single', null);
      if ('status' in r) return e(r.status, r.code, r.message);
      return HttpResponse.json(dto(r.p));
    }),
    http.post(`${B}/prices/bulk`, async ({ request }) => {
      const a = auth(request);
      if (a.res) return a.res;
      const b = ProductPricesBulkRequest.safeParse(await body(request));
      if (!b.success) return invalid(b.error.issues);
      const bulkId = uid();
      const results: ProductPricesBulkResult[] = b.data.rows.map((raw, index) => {
        const o = (raw ?? {}) as Record<string, unknown>;
        const res: ProductPricesBulkResult = {
          index,
          productId: typeof o.productId === 'string' ? o.productId : null,
          productCode: typeof o.code === 'string' ? o.code : null,
          status: 'failed',
          code: 'VALIDATION',
          message: null,
        };
        const r = ProductPricesBulkRow.safeParse(raw);
        if (!r.success) return { ...res, message: r.error.issues.map((i) => i.message).join('; ') };
        const { productId, code, ...patch } = r.data;
        if (!productId === !code)
          return { ...res, message: 'Send exactly one of productId or code' };
        if (!KEYS.some((k) => k in patch))
          return { ...res, message: 'Send at least one of mrp, ptr, pts' };
        const x = apply(a.p, { productId, code }, patch, undefined, 'bulk', bulkId);
        if ('status' in x) return { ...res, code: x.code, message: x.message };
        return {
          ...res,
          productId: x.p.id,
          productCode: x.p.code,
          status: x.changed ? 'updated' : 'unchanged',
          code: null,
        };
      });
      const n = (s: string) => results.filter((r) => r.status === s).length;
      return HttpResponse.json({
        bulkId,
        summary: {
          total: results.length,
          updated: n('updated'),
          unchanged: n('unchanged'),
          failed: n('failed'),
        },
        results,
      });
    }),
    http.get(`${B}/:id/price-history`, ({ request, params }) => {
      const a = auth(request);
      if (a.res) return a.res;
      if (!fx.products.some((p) => p.id === params.id))
        return e(404, 'PRODUCT_NOT_FOUND', 'Product not found');
      return HttpResponse.json({ items: history.filter((h) => h.productId === params.id) });
    }),
  ];
}
