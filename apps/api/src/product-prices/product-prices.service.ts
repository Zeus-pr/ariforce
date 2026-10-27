import { Injectable } from '@nestjs/common';
import {
  ProductPricesBulkRow,
  pricesConsistent,
  type AdminProduct,
  type AdminProductQuery,
  type ProductPricesBulkResponse,
  type ProductPricesBulkResult,
  type ProductPricesUpdate,
} from '@ariforce/contracts';
import { productPriceHistory, products, type Tx } from '@ariforce/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Principal } from '../auth/principal';
import { AuditService } from '../common/audit.service';
import { TenantService } from '../common/tenant.service';
import { err } from '../field/checkins.service';
import { decodeCursor, encodeCursor } from '../masters/masters.service';

type Prices = { mrp: number | null; ptr: number | null; pts: number | null };
type Patch = Partial<Prices>;
export const PRICE_KEYS = ['mrp', 'ptr', 'pts'] as const;
const n = (v: string | null) => (v == null ? null : Number(v));
const s = (v: number | null) => (v == null ? null : v.toFixed(2));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Writes one product's price change: products row, append-only history row and an audit entry with
 * old and new values. Shared by the admin endpoints and the generic masters path (source 'masters').
 */
export async function recordPriceChange(
  tx: Tx,
  audit: AuditService,
  p: Principal,
  productId: string,
  before: Prices,
  after: Prices,
  source: 'single' | 'bulk' | 'masters',
  bulkId: string | null = null,
) {
  await tx.insert(productPriceHistory).values({
    id: uuidv7(),
    companyId: p.companyId,
    productId,
    oldMrp: s(before.mrp),
    oldPtr: s(before.ptr),
    oldPts: s(before.pts),
    newMrp: s(after.mrp),
    newPtr: s(after.ptr),
    newPts: s(after.pts),
    source,
    bulkId,
    changedBy: p.userId,
  });
  await audit.record(tx, p, 'product.prices_updated', {
    entityType: 'product',
    entityId: productId,
    before,
    after: { ...after, source, ...(bulkId ? { bulkId } : {}) },
  });
}

@Injectable()
export class ProductPricesService {
  constructor(
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
  ) {}

  private async listRows(tx: Tx, where: ReturnType<typeof sql>, limit: number, offset: number) {
    const r = await tx.execute<{
      id: string;
      code: string;
      name: string;
      brand: string | null;
      division_id: string;
      active: boolean;
      mrp: string | null;
      ptr: string | null;
      pts: string | null;
      updated_at: Date | string;
      version: number;
      by_id: string | null;
      by_name: string | null;
      changed_at: Date | string | null;
    }>(sql`select p.id, p.code, p.name, p.brand, p.division_id, p.active, p.mrp, p.ptr, p.pts,
        p.updated_at, p.version, h.changed_by as by_id, u.name as by_name, h.changed_at
      from products p
      left join lateral (select changed_by, changed_at from product_price_history h
        where h.product_id = p.id order by h.changed_at desc, h.id desc limit 1) h on true
      left join users u on u.id = h.changed_by
      where p.deleted_at is null and ${where}
      order by p.code, p.id limit ${limit} offset ${offset}`);
    const iso = (d: Date | string) => new Date(d).toISOString();
    return r.rows.map((x): AdminProduct => ({
      id: x.id,
      code: x.code,
      name: x.name,
      brand: x.brand,
      divisionId: x.division_id,
      active: x.active,
      mrp: n(x.mrp),
      ptr: n(x.ptr),
      pts: n(x.pts),
      updatedAt: iso(x.updated_at),
      updatedBy: x.by_id ? { id: x.by_id, name: x.by_name ?? '' } : null,
      pricesUpdatedAt: x.changed_at ? iso(x.changed_at) : null,
      version: x.version,
    }));
  }

  list(p: Principal, q: AdminProductQuery) {
    return this.tenant.run(p, async (tx) => {
      const limit = q.limit ?? 50;
      const offset = decodeCursor(q.cursor);
      const conds = [sql`true`];
      if (q.q) {
        const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        conds.push(sql`(p.code ilike ${like} or p.name ilike ${like})`);
      }
      if (q.missingPtr === 'true') conds.push(sql`p.ptr is null`);
      if (q.missingPtr === 'false') conds.push(sql`p.ptr is not null`);
      if (q.active) conds.push(sql`p.active = ${q.active === 'true'}`);
      if (q.brand) conds.push(sql`lower(p.brand) = lower(${q.brand})`);
      if (q.divisionId) conds.push(sql`p.division_id = ${q.divisionId}`);
      const rows = await this.listRows(tx, sql.join(conds, sql` and `), limit + 1, offset);
      return {
        items: rows.slice(0, limit),
        nextCursor: rows.length > limit ? encodeCursor(offset + limit) : null,
      };
    });
  }

  history(p: Principal, productId: string) {
    return this.tenant.run(p, async (tx) => {
      await this.find(tx, { productId });
      const r = await tx.execute<{
        id: string;
        product_id: string;
        old_mrp: string | null;
        old_ptr: string | null;
        old_pts: string | null;
        new_mrp: string | null;
        new_ptr: string | null;
        new_pts: string | null;
        source: 'single' | 'bulk' | 'masters';
        bulk_id: string | null;
        changed_by: string;
        name: string;
        changed_at: Date | string;
      }>(sql`select h.*, u.name from product_price_history h join users u on u.id = h.changed_by
        where h.product_id = ${productId} order by h.changed_at desc, h.id desc limit 200`);
      return {
        items: r.rows.map((h) => ({
          id: h.id,
          productId: h.product_id,
          old: { mrp: n(h.old_mrp), ptr: n(h.old_ptr), pts: n(h.old_pts) },
          new: { mrp: n(h.new_mrp), ptr: n(h.new_ptr), pts: n(h.new_pts) },
          source: h.source,
          bulkId: h.bulk_id,
          changedBy: { id: h.changed_by, name: h.name },
          changedAt: new Date(h.changed_at).toISOString(),
        })),
      };
    });
  }

  private async find(tx: Tx, k: { productId?: string; code?: string }) {
    const where = k.productId
      ? eq(products.id, k.productId)
      : sql`upper(${products.code}) = upper(${k.code ?? ''})`;
    const [row] = await tx
      .select()
      .from(products)
      .where(and(where, isNull(products.deletedAt)))
      .for('update');
    if (!row) throw err(404, 'PRODUCT_NOT_FOUND', 'Product not found', k);
    return row;
  }

  /** Applies a patch to one product inside tx; returns whether anything changed. */
  private async apply(
    tx: Tx,
    p: Principal,
    k: { productId?: string; code?: string },
    patch: Patch,
    version: number | undefined,
    source: 'single' | 'bulk',
    bulkId: string | null,
  ) {
    const row = await this.find(tx, k);
    if (version !== undefined && version !== row.version)
      throw err(409, 'VERSION_CONFLICT', 'Product changed; reload', { version: row.version });
    const before: Prices = { mrp: n(row.mrp), ptr: n(row.ptr), pts: n(row.pts) };
    const after: Prices = { ...before };
    for (const key of PRICE_KEYS) if (key in patch) after[key] = patch[key] ?? null;
    if (!pricesConsistent(after))
      throw err(422, 'PTR_ABOVE_MRP', 'PTR cannot be above MRP', {
        ptr: after.ptr,
        mrp: after.mrp,
      });
    const changed = PRICE_KEYS.some((key) => before[key] !== after[key]);
    if (changed) {
      await tx
        .update(products)
        .set({ mrp: s(after.mrp), ptr: s(after.ptr), pts: s(after.pts) })
        .where(eq(products.id, row.id));
      await recordPriceChange(tx, this.audit, p, row.id, before, after, source, bulkId);
    }
    return { row, changed };
  }

  update(p: Principal, id: string, b: ProductPricesUpdate) {
    return this.tenant.run(p, async (tx) => {
      const { version, ...patch } = b;
      await this.apply(tx, p, { productId: id }, patch, version, 'single', null);
      const [dto] = await this.listRows(tx, sql`p.id = ${id}`, 1, 0);
      return dto!;
    });
  }

  /** Each row in its own transaction; one summary audit entry at the end. */
  async bulk(p: Principal, rows: unknown[]): Promise<ProductPricesBulkResponse> {
    const bulkId = uuidv7();
    const results: ProductPricesBulkResult[] = [];
    for (const [index, raw] of rows.entries()) {
      const rawObj = (raw ?? {}) as Record<string, unknown>;
      const res: ProductPricesBulkResult = {
        index,
        productId: typeof rawObj.productId === 'string' ? rawObj.productId : null,
        productCode: typeof rawObj.code === 'string' ? rawObj.code : null,
        status: 'failed',
        code: null,
        message: null,
      };
      results.push(res);
      const parsed = ProductPricesBulkRow.safeParse(raw);
      if (!parsed.success) {
        res.code = 'VALIDATION';
        res.message = parsed.error.issues
          .map((i) => `${i.path.join('.') || 'row'}: ${i.message}`)
          .join('; ');
        continue;
      }
      const { productId, code, ...patch } = parsed.data;
      if (!productId === !code || (productId && !UUID.test(productId))) {
        res.code = 'VALIDATION';
        res.message = 'Send exactly one of productId or code';
        continue;
      }
      if (!PRICE_KEYS.some((key) => key in patch)) {
        res.code = 'VALIDATION';
        res.message = 'Send at least one of mrp, ptr, pts';
        continue;
      }
      try {
        const r = await this.tenant.run(p, (tx) =>
          this.apply(tx, p, { productId, code }, patch, undefined, 'bulk', bulkId),
        );
        res.productId = r.row.id;
        res.productCode = r.row.code;
        res.status = r.changed ? 'updated' : 'unchanged';
      } catch (e) {
        const body = (e as { getResponse?: () => unknown }).getResponse?.() as
          | { code?: string; message?: string; error?: { code?: string; message?: string } }
          | undefined;
        if (!body) throw e;
        res.code = body.error?.code ?? body.code ?? 'ERROR';
        res.message = body.error?.message ?? body.message ?? 'Failed';
      }
    }
    const summary = {
      total: results.length,
      updated: results.filter((r) => r.status === 'updated').length,
      unchanged: results.filter((r) => r.status === 'unchanged').length,
      failed: results.filter((r) => r.status === 'failed').length,
    };
    await this.tenant.run(p, (tx) =>
      this.audit.record(tx, p, 'product.prices_bulk', {
        entityType: 'product_prices_bulk',
        entityId: bulkId,
        after: summary,
      }),
    );
    return { bulkId, summary, results };
  }
}
