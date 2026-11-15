import { Injectable } from '@nestjs/common';
import {
  monthsBetween,
  monthStartOf,
  type SalesActual,
  type SalesActualCreate,
  type SalesImportRequest,
  type SalesImportResult,
  type SalesTarget,
  type SalesTargetSet,
} from '@ariforce/contracts';
import {
  products,
  salesActuals,
  salesTargets,
  stockists,
  territories,
  type Tx,
} from '@ariforce/db';
import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Principal } from '../auth/principal';
import { AuditService } from '../common/audit.service';
import { TenantService } from '../common/tenant.service';
import { err } from '../field/checkins.service';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const ym = (d: string) => d.slice(0, 7);
const up = (s: string) => s.trim().toUpperCase();

/** Targets and actuals live on HQ territories only: the KPI rollup sums a subtree, so any other level would double count. */
@Injectable()
export class SalesService {
  constructor(
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
  ) {}

  private async hq(tx: Tx, id: string) {
    const [t] = await tx
      .select({ id: territories.id, level: territories.level, name: territories.name })
      .from(territories)
      .where(and(eq(territories.id, id), isNull(territories.deletedAt)));
    if (!t) throw err(404, 'TERRITORY_NOT_FOUND', 'Territory not found');
    if (t.level !== 'headquarter')
      throw err(422, 'VALIDATION', 'Pick an HQ (headquarter level) territory', {
        field: 'territoryId',
      });
    return t;
  }

  listTargets(p: Principal, q: { from: string; to: string; territoryId?: string; kind?: string }) {
    return this.tenant.run(p, async (tx) => {
      const rows = await tx
        .select({ t: salesTargets, name: territories.name, code: territories.code })
        .from(salesTargets)
        .innerJoin(territories, eq(territories.id, salesTargets.territoryId))
        .where(
          and(
            isNull(salesTargets.deletedAt),
            isNull(salesTargets.productId),
            gte(salesTargets.month, monthStartOf(q.from)),
            lte(salesTargets.month, monthStartOf(q.to)),
            q.territoryId ? eq(salesTargets.territoryId, q.territoryId) : undefined,
            q.kind ? eq(salesTargets.kind, q.kind as 'primary' | 'secondary') : undefined,
          ),
        )
        .orderBy(asc(territories.name), asc(salesTargets.month), asc(salesTargets.kind));
      const data: SalesTarget[] = rows.map(({ t, name, code }) => ({
        id: t.id,
        territoryId: t.territoryId,
        territoryName: name,
        territoryCode: code,
        month: ym(t.month),
        kind: t.kind,
        value: Number(t.value),
        quantity: t.quantity,
        updatedAt: t.updatedAt.toISOString(),
      }));
      return { data };
    });
  }

  /** Inserts or updates the all-products target of one HQ and kind for a month (revives a soft-deleted row). */
  private async upsertTarget(
    tx: Tx,
    p: Principal,
    territoryId: string,
    kind: 'primary' | 'secondary',
    month: string,
    value: number,
    quantity: number | null,
    overwrite: boolean,
  ): Promise<'created' | 'updated' | 'exists'> {
    const [cur] = await tx
      .select()
      .from(salesTargets)
      .where(
        and(
          eq(salesTargets.territoryId, territoryId),
          eq(salesTargets.kind, kind),
          eq(salesTargets.month, monthStartOf(month)),
          isNull(salesTargets.productId),
        ),
      );
    if (!cur) {
      await tx.insert(salesTargets).values({
        id: uuidv7(),
        companyId: p.companyId,
        territoryId,
        kind,
        month: monthStartOf(month),
        value: String(value),
        quantity,
      });
      return 'created';
    }
    if (!cur.deletedAt && !overwrite) return 'exists';
    await tx
      .update(salesTargets)
      .set({
        value: String(value),
        quantity,
        deletedAt: null,
        updatedAt: new Date(),
        version: cur.version + 1,
      })
      .where(eq(salesTargets.id, cur.id));
    return cur.deletedAt ? 'created' : 'updated';
  }

  setTargets(p: Principal, b: SalesTargetSet) {
    return this.tenant.run(p, async (tx) => {
      const t = await this.hq(tx, b.territoryId);
      const months = monthsBetween(b.fromMonth, b.toMonth);
      if (months.length > 36)
        throw err(422, 'VALIDATION', 'A period may cover at most 36 months', { field: 'toMonth' });
      const each = b.spread === 'total' ? r2(b.value / months.length) : b.value;
      const quantity =
        b.quantity === null
          ? null
          : b.spread === 'total'
            ? Math.round(b.quantity / months.length)
            : b.quantity;
      if (!b.overwrite) {
        const taken = await tx
          .select({ month: salesTargets.month })
          .from(salesTargets)
          .where(
            and(
              eq(salesTargets.territoryId, b.territoryId),
              eq(salesTargets.kind, b.kind),
              isNull(salesTargets.productId),
              isNull(salesTargets.deletedAt),
              inArray(salesTargets.month, months.map(monthStartOf)),
            ),
          );
        if (taken.length)
          throw err(409, 'TARGETS_EXIST', 'Some months already have a target', {
            months: taken.map((x) => ym(x.month)).sort(),
          });
      }
      let created = 0;
      let updated = 0;
      for (const m of months) {
        const r = await this.upsertTarget(tx, p, b.territoryId, b.kind, m, each, quantity, true);
        if (r === 'created') created++;
        else updated++;
      }
      await this.audit.record(tx, p, 'sales.targets_set', {
        entityType: 'territory',
        entityId: b.territoryId,
        after: {
          territory: t.name,
          kind: b.kind,
          fromMonth: b.fromMonth,
          toMonth: b.toMonth,
          value: each,
          created,
          updated,
        },
      });
      return { months: months.length, created, updated };
    });
  }

  listActuals(p: Principal, q: { month: string; territoryId?: string; kind?: string }) {
    return this.tenant.run(p, async (tx) => {
      const rows = await tx
        .select({
          a: salesActuals,
          tName: territories.name,
          tCode: territories.code,
          pName: products.name,
        })
        .from(salesActuals)
        .innerJoin(territories, eq(territories.id, salesActuals.territoryId))
        .innerJoin(products, eq(products.id, salesActuals.productId))
        .where(
          and(
            isNull(salesActuals.deletedAt),
            eq(salesActuals.month, monthStartOf(q.month)),
            q.territoryId ? eq(salesActuals.territoryId, q.territoryId) : undefined,
            q.kind ? eq(salesActuals.kind, q.kind as 'primary' | 'secondary') : undefined,
          ),
        )
        .orderBy(asc(territories.name), asc(products.name))
        .limit(1000);
      const data: SalesActual[] = rows.map(({ a, tName, tCode, pName }) => ({
        id: a.id,
        territoryId: a.territoryId,
        territoryName: tName,
        territoryCode: tCode,
        productId: a.productId,
        productName: pName,
        stockistId: a.stockistId,
        month: ym(a.month),
        kind: a.kind,
        quantity: a.quantity,
        freeQuantity: a.freeQuantity,
        value: Number(a.value),
        isReturn: a.isReturn,
        updatedAt: a.updatedAt.toISOString(),
      }));
      return { data };
    });
  }

  createActual(p: Principal, b: SalesActualCreate) {
    return this.tenant.run(p, async (tx) => {
      await this.hq(tx, b.territoryId);
      const [prod] = await tx
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.id, b.productId), isNull(products.deletedAt)));
      if (!prod) throw err(422, 'VALIDATION', 'Unknown product', { field: 'productId' });
      if (b.stockistId) {
        const [s] = await tx
          .select({ id: stockists.id })
          .from(stockists)
          .where(
            and(
              eq(stockists.id, b.stockistId),
              eq(stockists.territoryId, b.territoryId),
              isNull(stockists.deletedAt),
            ),
          );
        if (!s)
          throw err(422, 'VALIDATION', 'Stockist is not under this HQ', { field: 'stockistId' });
      }
      const id = uuidv7();
      await tx.insert(salesActuals).values({
        id,
        companyId: p.companyId,
        territoryId: b.territoryId,
        stockistId: b.stockistId,
        productId: b.productId,
        month: monthStartOf(b.month),
        kind: b.kind,
        quantity: b.quantity,
        freeQuantity: b.freeQuantity,
        value: String(b.value),
        isReturn: b.isReturn,
      });
      await this.audit.record(tx, p, 'sales.actual_added', {
        entityType: 'sales_actual',
        entityId: id,
        after: b,
      });
      return { id };
    });
  }

  deleteActual(p: Principal, id: string) {
    return this.tenant.run(p, async (tx) => {
      const [a] = await tx
        .update(salesActuals)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(salesActuals.id, id), isNull(salesActuals.deletedAt)))
        .returning();
      if (!a) throw err(404, 'SALES_ACTUAL_NOT_FOUND', 'Sales row not found');
      await this.audit.record(tx, p, 'sales.actual_deleted', {
        entityType: 'sales_actual',
        entityId: id,
        before: { month: ym(a.month), kind: a.kind, value: Number(a.value) },
      });
      return { id };
    });
  }

  /** Dry run validates every row; apply saves the valid ones (the rest stay reported as errors). */
  import(p: Principal, req: SalesImportRequest): Promise<SalesImportResult> {
    return this.tenant.run(p, async (tx) => {
      const terr = await tx
        .select({ id: territories.id, code: territories.code, level: territories.level })
        .from(territories)
        .where(isNull(territories.deletedAt));
      const tm = new Map(terr.map((t) => [up(t.code), t]));
      const prod = await tx
        .select({ id: products.id, code: products.code })
        .from(products)
        .where(isNull(products.deletedAt));
      const pm = new Map(prod.map((x) => [up(x.code), x.id]));
      const results: SalesImportResult['results'] = [];
      const totals = { rows: req.rows.length, valid: 0, created: 0, updated: 0, errors: 0 };
      let n = 0;
      for (const r of req.rows) {
        n++;
        const t = tm.get(up(r.territoryCode));
        const productId = r.productCode ? pm.get(up(r.productCode)) : undefined;
        let error: SalesImportResult['results'][number]['error'] = null;
        if (!t) error = 'unknown_territory';
        else if (t.level !== 'headquarter') error = 'not_headquarter';
        else if (req.entity === 'actuals' && !r.productCode) error = 'product_required';
        else if (r.productCode && !productId) error = 'unknown_product';
        if (error) {
          totals.errors++;
          results.push({ row: n, status: 'error', error });
          continue;
        }
        if (req.dryRun) {
          totals.valid++;
          results.push({ row: n, status: 'valid', error: null });
          continue;
        }
        if (req.entity === 'targets') {
          // A product-level target is not read by the KPI views, so only the all-products row is stored.
          const s = await this.upsertTarget(
            tx,
            p,
            t!.id,
            r.kind,
            r.month,
            r.value,
            r.quantity,
            true,
          );
          const status = s === 'created' ? 'created' : 'updated';
          totals[status]++;
          results.push({ row: n, status, error: null });
        } else {
          await tx.insert(salesActuals).values({
            id: uuidv7(),
            companyId: p.companyId,
            territoryId: t!.id,
            productId: productId!,
            month: monthStartOf(r.month),
            kind: r.kind,
            quantity: r.quantity ?? 0,
            freeQuantity: r.freeQuantity,
            value: String(r.value),
            isReturn: r.isReturn,
          });
          totals.created++;
          results.push({ row: n, status: 'created', error: null });
        }
      }
      if (!req.dryRun)
        await this.audit.record(tx, p, `sales.${req.entity}_imported`, {
          entityType: 'sales_import',
          after: totals,
        });
      return { dryRun: req.dryRun, totals, results };
    });
  }
}
