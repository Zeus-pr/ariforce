import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  productBrand,
  type StockStatementFileBody,
  type StockStatementLineInput,
} from '@ariforce/contracts';
import {
  approvalRequests,
  approvalSteps,
  companies,
  products,
  roles,
  salesActuals,
  salesTargets,
  stockStatementLines,
  stockStatements,
  stockists,
  territories,
  userTerritories,
  userRoles,
  users,
  type Tx,
} from '@ariforce/db';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Principal } from '../auth/principal';
import { AuditService } from '../common/audit.service';
import { TenantService } from '../common/tenant.service';
import { err } from '../field/checkins.service';
import { companySettings, localDate } from '../field/field.util';
import { excelContentMatches } from './excel-sniff';
import { StorageService } from '../files/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ApprovalsService } from '../plans/approvals.service';
import {
  figureLine,
  isPastLock,
  lockInstant,
  monthStart,
  nextMonth,
  totalsOf,
  type FiguredLine,
} from './math';
import { statementPdf } from './pdf';

type LineRow = typeof stockStatementLines.$inferSelect;
type StatementRow = typeof stockStatements.$inferSelect;

const money = (n: number) => n.toFixed(2);
const num = (v: string | null) => (v == null ? null : Number(v));
const FILE_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel.sheet.macroEnabled.12': 'xlsm',
  'application/vnd.ms-excel.sheet.binary.macroEnabled.12': 'xlsb',
  'application/excel': 'xls',
  'application/x-excel': 'xls',
  'application/x-msexcel': 'xls',
  'application/vnd.ms-office': 'xls',
};
const fileExtension = (contentType: string) =>
  FILE_EXT[contentType.split(';')[0]!.trim().toLowerCase()] ?? 'bin';

@Injectable()
export class StockStatementsService implements OnModuleInit {
  constructor(
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.approvals.register(
      'stock_statement',
      async (tx, p, req, approved, comment) => {
        const [row] = await tx
          .select()
          .from(stockStatements)
          .where(eq(stockStatements.id, req.entityId))
          .for('update');
        if (!row || row.status !== 'pending') return;
        if (approved) await this.writeSales(tx, row);
        await tx
          .update(stockStatements)
          .set({
            status: approved ? 'approved' : 'rejected',
            decisionComment: comment,
          })
          .where(eq(stockStatements.id, row.id));
        if (approved) await this.applyClosingToNext(tx, row);
        const stockist = await this.stockistName(tx, row.stockistId);
        await this.notifications.notify(tx, p, {
          type: approved ? 'stock_statement.approved' : 'stock_statement.rejected',
          recipientId: req.requestedBy,
          entityType: 'stock_statement',
          entityId: row.id,
          dedupeKey: `stock_statement.${approved ? 'approved' : 'rejected'}:${req.id}`,
          data: {
            month: row.month.slice(0, 7),
            stockistName: stockist,
            reason: comment,
            comment,
          },
        });
      },
      {
        permission: 'stock_statements:approve',
        exactSteps: true,
        beforeApprove: async (tx, _p, req) => {
          const [row] = await tx
            .select()
            .from(stockStatements)
            .where(eq(stockStatements.id, req.entityId));
          if (row) {
            await this.fillBlankOpenings(tx, row);
            await this.assertReady(tx, row, 'sheet');
          }
        },
        onStep: async (tx, p, req, _step, nextApproverId) => {
          const [row] = await tx
            .select({ month: stockStatements.month, stockistId: stockStatements.stockistId })
            .from(stockStatements)
            .where(eq(stockStatements.id, req.entityId));
          if (!row) return;
          await this.notifications.notify(tx, p, {
            type: 'stock_statement.submitted',
            recipientId: nextApproverId,
            entityType: 'stock_statement',
            entityId: req.entityId,
            dedupeKey: `stock_statement.submitted:${req.id}:${_step}`,
            data: {
              month: row.month.slice(0, 7),
              stockistName: await this.stockistName(tx, row.stockistId),
            },
          });
        },
      },
    );
    this.approvals.register(
      'stock_statement_unlock',
      async (tx, _p, req, approved) => {
        if (!approved) return;
        const [row] = await tx
          .select()
          .from(stockStatements)
          .where(eq(stockStatements.id, req.entityId))
          .for('update');
        if (!row) return;
        await tx
          .update(approvalRequests)
          .set({ state: 'cancelled' })
          .where(
            and(
              eq(approvalRequests.entityType, 'stock_statement'),
              eq(approvalRequests.entityId, row.id),
              eq(approvalRequests.state, 'pending'),
            ),
          );
        await tx
          .update(stockStatements)
          .set({ status: 'draft', editOpen: true, approvalRequestId: null, decisionComment: null })
          .where(eq(stockStatements.id, row.id));
      },
      { permission: 'dcr_unlock:decide', route: 'permission_holders' },
    );
  }

  stockists(p: Principal) {
    this.blockAdmin(p);
    return this.tenant.run(p, async (tx) => {
      const scope = this.tenant.scope(p, territories.path);
      const rows = await tx
        .select({ id: stockists.id, name: stockists.name, city: stockists.city })
        .from(stockists)
        .innerJoin(territories, eq(territories.id, stockists.territoryId))
        .where(and(isNull(stockists.deletedAt), scope))
        .orderBy(asc(stockists.name));
      return { items: rows };
    });
  }

  list(
    p: Principal,
    q: { stockistId?: string; status?: StatementRow['status']; waiting?: string },
  ) {
    this.blockAdmin(p);
    return this.tenant.run(p, async (tx) => ({ items: await this.history(tx, p, q) }));
  }

  open(p: Principal, stockistId: string, month: string) {
    this.blockAdmin(p);
    return this.tenant.run(p, async (tx) => {
      await this.visibleStockist(tx, p, stockistId);
      const start = monthStart(month);
      const today = localDate(new Date(), (await companySettings(tx, p)).timezone);
      if (start > monthStart(today.slice(0, 7)))
        throw err(422, 'MONTH_IN_FUTURE', 'A future month cannot be opened');
      const [existing] = await tx
        .select()
        .from(stockStatements)
        .where(
          and(
            eq(stockStatements.stockistId, stockistId),
            eq(stockStatements.month, start),
            isNull(stockStatements.deletedAt),
          ),
        );
      if (existing) return this.sheet(tx, p, existing);
      if (!(await this.isFiller(tx, p, stockistId)))
        throw err(422, 'NOT_STARTED', await this.fillerMessage(tx, stockistId));
      const priorMonth = this.previous(start);
      const [prior] = await tx
        .select()
        .from(stockStatements)
        .where(
          and(
            eq(stockStatements.stockistId, stockistId),
            eq(stockStatements.month, priorMonth),
            isNull(stockStatements.deletedAt),
          ),
        )
        .limit(1);
      const [latest] = await tx
        .select()
        .from(stockStatements)
        .where(and(eq(stockStatements.stockistId, stockistId), isNull(stockStatements.deletedAt)))
        .orderBy(desc(stockStatements.month))
        .limit(1);
      const latestMonth = latest ? String(latest.month).slice(0, 10) : null;
      if (latest && start > latestMonth!) {
        if (latestMonth !== priorMonth || latest.status !== 'approved') {
          throw err(
            422,
            latest.status === 'approved' ? 'MONTH_OUT_OF_SEQUENCE' : 'PREVIOUS_MONTH_OPEN',
            latest.status === 'approved'
              ? `The next month is ${nextMonth(latest.month).slice(0, 7)}`
              : `${latest.month.slice(0, 7)} has to be approved before the next month opens`,
          );
        }
      } else if (latest && start < latestMonth!) {
        const [later] = await tx
          .select({ month: stockStatements.month, status: stockStatements.status })
          .from(stockStatements)
          .where(
            and(
              eq(stockStatements.stockistId, stockistId),
              isNull(stockStatements.deletedAt),
              sql`${stockStatements.month} > ${start}`,
              sql`${stockStatements.status} <> 'draft'`,
            ),
          )
          .orderBy(desc(stockStatements.month))
          .limit(1);
        if (later) {
          const word = later.status === 'approved' ? 'approved' : 'submitted';
          throw err(
            422,
            'LATER_MONTH_CLOSED',
            `${String(later.month).slice(0, 7)} is already ${word}, so an earlier month cannot be opened`,
          );
        }
      }
      if (prior && prior.status !== 'approved') {
        throw err(
          422,
          'PREVIOUS_MONTH_OPEN',
          `${String(prior.month).slice(0, 7)} has to be approved before the next month opens`,
        );
      }
      const id = uuidv7();
      const [created] = await tx
        .insert(stockStatements)
        .values({ id, companyId: p.companyId, stockistId, month: start })
        .returning();
      if (prior?.status === 'approved') await this.carry(tx, p, prior, created!);
      await this.audit.record(tx, p, 'stock_statement.opened', {
        entityType: 'stock_statement',
        entityId: id,
        after: { stockistId, month: start },
      });
      const [fresh] = await tx.select().from(stockStatements).where(eq(stockStatements.id, id));
      return this.sheet(tx, p, fresh!);
    });
  }

  get(p: Principal, id: string) {
    this.blockAdmin(p);
    return this.tenant.run(p, async (tx) => this.sheet(tx, p, await this.owned(tx, p, id)));
  }

  /** Approved sheets only. Primary is purchase value. Secondary is secondary minus FRS. */
  salesReport(p: Principal, q: { from: string; to: string; territoryId?: string }) {
    if (q.from > q.to)
      throw err(422, 'VALIDATION', 'from must be on or before to', { field: 'from' });
    return this.tenant.run(p, async (tx) => {
      const scope = this.tenant.scope(p, territories.path);
      let under: ReturnType<typeof sql> | undefined;
      if (q.territoryId) {
        const [place] = await tx
          .select({ path: territories.path })
          .from(territories)
          .where(and(eq(territories.id, q.territoryId), isNull(territories.deletedAt)));
        if (!place) throw new NotFoundException('Territory not found');
        under = sql`(${territories.path} = ${place.path} or starts_with(${territories.path}, ${place.path + '.'}))`;
      }
      const found = await tx
        .select({
          month: stockStatements.month,
          hq: territories.name,
          hqPath: territories.path,
          stockist: stockists.name,
          productId: stockStatementLines.productId,
          lineName: stockStatementLines.productName,
          catalogName: products.name,
          catalogBrand: products.brand,
          purchaseQty: stockStatementLines.purchaseQty,
          secondaryQty: stockStatementLines.secondaryQty,
          frsQty: stockStatementLines.frsQty,
          freeQty: stockStatementLines.freeQty,
          openingQty: stockStatementLines.openingQty,
          pts: stockStatementLines.pts,
        })
        .from(stockStatements)
        .innerJoin(stockists, eq(stockists.id, stockStatements.stockistId))
        .innerJoin(territories, eq(territories.id, stockists.territoryId))
        .innerJoin(
          stockStatementLines,
          and(
            eq(stockStatementLines.statementId, stockStatements.id),
            isNull(stockStatementLines.deletedAt),
          ),
        )
        .leftJoin(products, eq(products.id, stockStatementLines.productId))
        .where(
          and(
            isNull(stockStatements.deletedAt),
            eq(stockStatements.status, 'approved'),
            gte(stockStatements.month, `${q.from}-01`),
            lte(stockStatements.month, `${q.to}-01`),
            scope,
            under,
          ),
        );
      const named = await tx
        .select({ name: territories.name, path: territories.path, level: territories.level })
        .from(territories)
        .where(and(isNull(territories.deletedAt), scope));
      const hqName = (path: string) => {
        let best = '';
        let name = '';
        for (const place of named) {
          if (place.level !== 'headquarter') continue;
          if (path !== place.path && !path.startsWith(`${place.path}.`)) continue;
          if (place.path.length < best.length) continue;
          best = place.path;
          name = place.name;
        }
        return name;
      };
      const holders = await tx
        .select({
          userId: users.id,
          name: users.name,
          path: territories.path,
          territory: territories.name,
        })
        .from(userTerritories)
        .innerJoin(users, eq(users.id, userTerritories.userId))
        .innerJoin(territories, eq(territories.id, userTerritories.territoryId))
        .where(and(isNull(users.deletedAt), isNull(territories.deletedAt), scope, under));
      const depth = (path: string) => path.split('.').length;
      const nearest = (path: string) => {
        let best = 0;
        const hits: typeof holders = [];
        for (const holder of holders) {
          if (path !== holder.path && !path.startsWith(`${holder.path}.`)) continue;
          const d = depth(holder.path);
          if (d > best) {
            best = d;
            hits.length = 0;
            hits.push(holder);
          } else if (d === best) hits.push(holder);
        }
        return hits;
      };
      const productsOut = new Map<
        string,
        {
          productId: string;
          name: string;
          brand: string;
          primaryQty: number;
          primaryValue: number;
          secondaryQty: number;
          secondaryValue: number;
          closingQty: number;
        }
      >();
      type SalesProduct = {
        productId: string;
        name: string;
        brand: string;
        primaryQty: number;
        primaryValue: number;
        secondaryQty: number;
        secondaryValue: number;
        closingQty: number;
      };
      const lines = [];
      const peopleOut = new Map<
        string,
        {
          userId: string;
          name: string;
          headquarters: Set<string>;
          products: Map<string, SalesProduct>;
        }
      >();
      for (const row of found) {
        const pts = row.pts == null ? null : Number(row.pts);
        const figured = figureLine({
          openingQty: row.openingQty,
          purchaseQty: row.purchaseQty,
          freeQty: row.freeQty,
          secondaryQty: row.secondaryQty,
          frsQty: row.frsQty,
          pts,
        });
        const primaryValue = figured.purchaseValue ?? 0;
        const secondaryValue = (figured.secondaryValue ?? 0) - (figured.frsValue ?? 0);
        const closingQty = figured.closingQty ?? 0;
        if (row.purchaseQty === 0 && row.secondaryQty === 0 && row.frsQty === 0) continue;
        const name = row.lineName || row.catalogName || 'Product';
        const brand = productBrand({ name, brand: row.catalogBrand });
        const month = String(row.month).slice(0, 7);
        const owners = nearest(row.hqPath);
        const headquarters = hqName(row.hqPath) || row.hq;
        lines.push({
          month,
          headquarters,
          stockist: row.stockist,
          person: owners.map((owner) => owner.name).join(', ') || null,
          product: name,
          brand,
          primaryQty: row.purchaseQty,
          primaryValue,
          secondaryQty: row.secondaryQty,
          secondaryValue,
          closingQty,
        });
        for (const owner of owners) {
          const person = peopleOut.get(owner.userId) ?? {
            userId: owner.userId,
            name: owner.name,
            headquarters: new Set<string>(),
            products: new Map<string, SalesProduct>(),
          };
          person.headquarters.add(headquarters);
          const theirs = person.products.get(row.productId) ?? {
            productId: row.productId,
            name,
            brand,
            primaryQty: 0,
            primaryValue: 0,
            secondaryQty: 0,
            secondaryValue: 0,
            closingQty: 0,
          };
          theirs.primaryQty += row.purchaseQty;
          theirs.primaryValue = Math.round((theirs.primaryValue + primaryValue) * 100) / 100;
          theirs.secondaryQty += row.secondaryQty;
          theirs.secondaryValue = Math.round((theirs.secondaryValue + secondaryValue) * 100) / 100;
          theirs.closingQty += closingQty;
          person.products.set(row.productId, theirs);
          peopleOut.set(owner.userId, person);
        }
        const cur = productsOut.get(row.productId) ?? {
          productId: row.productId,
          name,
          brand,
          primaryQty: 0,
          primaryValue: 0,
          secondaryQty: 0,
          secondaryValue: 0,
          closingQty: 0,
        };
        cur.primaryQty += row.purchaseQty;
        cur.primaryValue = Math.round((cur.primaryValue + primaryValue) * 100) / 100;
        cur.secondaryQty += row.secondaryQty;
        cur.secondaryValue = Math.round((cur.secondaryValue + secondaryValue) * 100) / 100;
        cur.closingQty += closingQty;
        productsOut.set(row.productId, cur);
      }
      const targetRows = await tx
        .select({ brand: salesTargets.brand, kind: salesTargets.kind, value: salesTargets.value })
        .from(salesTargets)
        .innerJoin(territories, eq(territories.id, salesTargets.territoryId))
        .where(
          and(
            isNull(salesTargets.deletedAt),
            isNull(salesTargets.productId),
            isNotNull(salesTargets.brand),
            gte(salesTargets.month, `${q.from}-01`),
            lte(salesTargets.month, `${q.to}-01`),
            scope,
            under,
          ),
        );
      const brandTargets = new Map<string, { name: string; primary: number; secondary: number }>();
      for (const row of targetRows) {
        const name = row.brand?.trim();
        if (!name) continue;
        const cur = brandTargets.get(name.toLowerCase()) ?? { name, primary: 0, secondary: 0 };
        const amount = Number(row.value);
        if (row.kind === 'primary') cur.primary = Math.round((cur.primary + amount) * 100) / 100;
        else cur.secondary = Math.round((cur.secondary + amount) * 100) / 100;
        brandTargets.set(name.toLowerCase(), cur);
      }
      const byValue = (a: SalesProduct, b: SalesProduct) =>
        b.primaryValue + b.secondaryValue - (a.primaryValue + a.secondaryValue);
      const productsList = [...productsOut.values()].sort(byValue);
      const people = [...peopleOut.values()]
        .map((person) => ({
          userId: person.userId,
          name: person.name,
          headquarters: [...person.headquarters].sort((a, b) => a.localeCompare(b)),
          products: [...person.products.values()].sort(byValue),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { products: productsList, people, brandTargets: [...brandTargets.values()], lines };
    });
  }

  save(p: Principal, id: string, version: number, inputs: StockStatementLineInput[]) {
    this.blockAdmin(p);
    return this.tenant.run(p, async (tx) => {
      const row = await this.editable(tx, p, id, version);
      const catalog = await this.catalog(tx, row.id);
      const byId = new Map(catalog.map((c) => [c.productId, c]));
      for (const input of inputs) {
        const known = byId.get(input.productId);
        if (!known) throw err(422, 'PRODUCT_NOT_ON_SHEET', 'That product is not on this sheet');
        const openingQty = known.openingLocked ? known.openingQty : input.openingQty;
        const pts = known.pts;
        await tx
          .insert(stockStatementLines)
          .values({
            id: uuidv7(),
            companyId: p.companyId,
            statementId: row.id,
            productId: input.productId,
            openingQty,
            openingSource: known.openingLocked ? 'carried' : 'typed',
            purchaseQty: input.purchaseQty,
            freeQty: input.freeQty,
            secondaryQty: input.secondaryQty,
            frsQty: input.frsQty,
            pts: pts == null ? null : money(pts),
            productName: known.name,
            packSize: known.packSize,
          })
          .onConflictDoUpdate({
            target: [stockStatementLines.statementId, stockStatementLines.productId],
            targetWhere: sql`${stockStatementLines.deletedAt} is null`,
            set: {
              openingQty,
              purchaseQty: input.purchaseQty,
              freeQty: input.freeQty,
              secondaryQty: input.secondaryQty,
              frsQty: input.frsQty,
              pts: pts == null ? null : money(pts),
              productName: known.name,
              packSize: known.packSize,
            },
          });
      }
      await this.retotal(tx, row);
      if (row.status === 'pending')
        await this.audit.record(tx, p, 'stock_statement.edited', {
          entityType: 'stock_statement',
          entityId: row.id,
          after: { lines: inputs.length },
        });
      const [fresh] = await tx.select().from(stockStatements).where(eq(stockStatements.id, row.id));
      return this.sheet(tx, p, fresh!);
    });
  }

  submit(p: Principal, id: string, version: number) {
    this.blockAdmin(p);
    return this.tenant.run(p, async (tx) => {
      const row = await this.owned(tx, p, id);
      if (!(await this.canSubmitRow(tx, p, row)))
        throw err(409, 'STATEMENT_LOCKED', 'This statement cannot be edited');
      if (row.version !== version)
        throw err(409, 'VERSION_CONFLICT', 'This statement was saved somewhere else. Reload it.', {
          version: row.version,
        });
      const prior = await this.priorStatement(tx, row);
      if (prior && prior.status !== 'approved')
        throw err(
          422,
          'PREVIOUS_MONTH_OPEN',
          `${String(prior.month).slice(0, 7)} has to be approved before this month can be submitted`,
        );
      await this.fillBlankOpenings(tx, row);
      await this.assertReady(tx, row, 'catalog');
      const chain = await this.approvers(tx, p.userId);
      if (!chain.length) {
        await tx
          .update(stockStatements)
          .set({
            status: 'approved',
            submittedBy: p.userId,
            submittedAt: new Date(),
            approvalRequestId: null,
            decisionComment: null,
            editOpen: false,
          })
          .where(eq(stockStatements.id, row.id));
        const [done] = await tx
          .select()
          .from(stockStatements)
          .where(eq(stockStatements.id, row.id));
        await this.writeSales(tx, done!);
        await this.applyClosingToNext(tx, done!);
        return this.sheet(tx, p, done!);
      }
      await tx
        .update(approvalRequests)
        .set({ state: 'cancelled' })
        .where(
          and(
            eq(approvalRequests.entityType, 'stock_statement'),
            eq(approvalRequests.entityId, row.id),
            eq(approvalRequests.state, 'pending'),
          ),
        );
      const requestId = uuidv7();
      const stockist = await this.stockistName(tx, row.stockistId);
      await tx.insert(approvalRequests).values({
        id: requestId,
        companyId: p.companyId,
        entityType: 'stock_statement',
        entityId: row.id,
        requestedBy: p.userId,
        payload: { month: row.month.slice(0, 7), stockistName: stockist },
      });
      await tx.insert(approvalSteps).values(
        chain.map((person, i) => ({
          id: uuidv7(),
          companyId: p.companyId,
          requestId,
          stepNo: i + 1,
          approverUserId: person.id,
        })),
      );
      await tx
        .update(stockStatements)
        .set({
          status: 'pending',
          submittedBy: p.userId,
          submittedAt: new Date(),
          approvalRequestId: requestId,
          decisionComment: null,
          editOpen: false,
        })
        .where(eq(stockStatements.id, row.id));
      await this.notifications.notify(tx, p, {
        type: 'stock_statement.submitted',
        recipientId: chain[0]!.id,
        entityType: 'stock_statement',
        entityId: row.id,
        dedupeKey: `stock_statement.submitted:${requestId}:1`,
        data: { month: row.month.slice(0, 7), stockistName: stockist },
      });
      await this.audit.record(tx, p, 'stock_statement.submitted', {
        entityType: 'stock_statement',
        entityId: row.id,
        after: { requestId, approvers: chain.map((person) => person.id) },
      });
      const [fresh] = await tx.select().from(stockStatements).where(eq(stockStatements.id, row.id));
      return this.sheet(tx, p, fresh!);
    });
  }

  async fileUrl(p: Principal, id: string, kind: 'aws' | 'ss') {
    this.blockAdmin(p);
    return this.tenant.run(p, async (tx) => {
      const row = await this.owned(tx, p, id);
      const key = kind === 'aws' ? row.awsFileKey : row.ssFileKey;
      const status = kind === 'aws' ? row.awsStatus : row.ssStatus;
      const contentType = kind === 'aws' ? row.awsContentType : row.ssContentType;
      if (!key || status !== 'confirmed')
        throw err(409, 'UPLOAD_NOT_CONFIRMED', 'That file is not ready');
      return this.storage.downloadUrl(
        p.companyId,
        key,
        new Date(),
        `${kind}-${row.month.slice(0, 7)}.${contentType ? fileExtension(contentType) : 'bin'}`,
      );
    });
  }

  presign(p: Principal, id: string, body: StockStatementFileBody) {
    this.blockAdmin(p);
    return this.tenant.run(p, async (tx) => {
      const row = await this.owned(tx, p, id);
      if (!(await this.mayEdit(tx, p, row)))
        throw err(409, 'STATEMENT_LOCKED', 'This statement cannot be edited');
      const up = await this.storage.presignPut(
        p.companyId,
        body.kind === 'aws' ? 'stock_statement_aws' : 'stock_statement_ss',
        body.contentType,
        body.sizeBytes,
        fileExtension(body.contentType),
        new Date(),
      );
      const patch =
        body.kind === 'aws'
          ? {
              awsFileKey: up.fileKey,
              awsContentType: body.contentType,
              awsSizeBytes: body.sizeBytes,
              awsStatus: 'pending' as const,
            }
          : {
              ssFileKey: up.fileKey,
              ssContentType: body.contentType,
              ssSizeBytes: body.sizeBytes,
              ssStatus: 'pending' as const,
            };
      await tx.update(stockStatements).set(patch).where(eq(stockStatements.id, row.id));
      return up;
    });
  }

  confirmFile(p: Principal, id: string, kind: 'aws' | 'ss') {
    this.blockAdmin(p);
    return this.tenant.run(p, async (tx) => {
      const row = await this.owned(tx, p, id);
      if (!(await this.mayEdit(tx, p, row)))
        throw err(409, 'STATEMENT_LOCKED', 'This statement cannot be edited');
      const key = kind === 'aws' ? row.awsFileKey : row.ssFileKey;
      const type = kind === 'aws' ? row.awsContentType : row.ssContentType;
      const size = kind === 'aws' ? row.awsSizeBytes : row.ssSizeBytes;
      if (!key || !type || size == null) throw err(409, 'UPLOAD_MISSING', 'Upload the file first');
      const head = await this.storage.head(key);
      if (!head) throw err(409, 'UPLOAD_MISSING', 'Upload the file first');
      if (head.sizeBytes !== size || head.sizeBytes > 10 * 1024 * 1024)
        throw err(422, 'UPLOAD_SIZE_MISMATCH', 'Uploaded size differs from the declared size');
      const bytes = await this.storage.firstBytes(key, 65536);
      if (!sniff(type, bytes))
        throw err(422, 'UPLOAD_FORMAT_INVALID', 'File content does not match its type');
      await tx
        .update(stockStatements)
        .set(kind === 'aws' ? { awsStatus: 'confirmed' } : { ssStatus: 'confirmed' })
        .where(eq(stockStatements.id, row.id));
      const [fresh] = await tx.select().from(stockStatements).where(eq(stockStatements.id, row.id));
      return this.sheet(tx, p, fresh!);
    });
  }

  removeFile(p: Principal, id: string, kind: 'aws' | 'ss') {
    this.blockAdmin(p);
    return this.tenant.run(p, async (tx) => {
      const row = await this.owned(tx, p, id);
      if (!(await this.mayEdit(tx, p, row)))
        throw err(409, 'STATEMENT_LOCKED', 'This statement cannot be edited');
      await tx
        .update(stockStatements)
        .set(
          kind === 'aws'
            ? { awsFileKey: null, awsContentType: null, awsSizeBytes: null, awsStatus: null }
            : { ssFileKey: null, ssContentType: null, ssSizeBytes: null, ssStatus: null },
        )
        .where(eq(stockStatements.id, row.id));
      const [fresh] = await tx.select().from(stockStatements).where(eq(stockStatements.id, row.id));
      return this.sheet(tx, p, fresh!);
    });
  }

  async pdf(p: Principal, id: string) {
    this.blockAdmin(p);
    return this.tenant.run(p, async (tx) => {
      const row = await this.owned(tx, p, id);
      const [company] = await tx
        .select({ name: companies.name })
        .from(companies)
        .where(eq(companies.id, p.companyId));
      const stockist = await this.visibleStockist(tx, p, row.stockistId);
      const lines = await this.merged(tx, row.id);
      const address = [stockist.addressLine, stockist.city, stockist.state]
        .filter(Boolean)
        .join(', ');
      return statementPdf({
        company: company?.name ?? 'ARIGHNA PHARMA PVT. LTD.',
        stockist: stockist.name,
        address,
        month: row.month,
        lines: lines.map((l) => ({
          name: l.name,
          pack: l.packSize,
          openingQty: l.openingQty,
          openingValue: l.openingValue,
          purchaseQty: l.purchaseQty,
          purchaseValue: l.purchaseValue,
          freeQty: l.freeQty,
          freeValue: l.freeValue,
          secondaryQty: l.secondaryQty,
          secondaryValue: l.secondaryValue,
          closingQty: l.closingQty,
          closingValue: l.closingValue,
          frsQty: l.frsQty,
          frsValue: l.frsValue,
        })),
      });
    });
  }

  private blockAdmin(p: Principal) {
    if (p.roles.includes('system_admin'))
      throw new ForbiddenException('System admin cannot open stock statements');
  }

  private async dateLocked(tx: Tx, p: Principal, row: StatementRow) {
    const tz = (await companySettings(tx, p)).timezone;
    return isPastLock(String(row.month), new Date(), tz);
  }

  private async canSubmitRow(tx: Tx, p: Principal, row: StatementRow) {
    if (!(await this.isFiller(tx, p, row.stockistId))) return false;
    if (row.status !== 'draft' && row.status !== 'rejected') return false;
    if ((await this.dateLocked(tx, p, row)) && !row.editOpen) return false;
    return true;
  }

  private async mayEdit(tx: Tx, p: Principal, row: StatementRow) {
    if (p.roles.includes('system_admin')) return false;
    if ((await this.dateLocked(tx, p, row)) && !row.editOpen) return false;
    if (
      (await this.isFiller(tx, p, row.stockistId)) &&
      (row.status === 'draft' || row.status === 'rejected')
    )
      return true;
    if (row.status !== 'pending' || !row.approvalRequestId) return false;
    const [req] = await tx
      .select({ step: approvalRequests.currentStep, state: approvalRequests.state })
      .from(approvalRequests)
      .where(eq(approvalRequests.id, row.approvalRequestId));
    if (!req || req.state !== 'pending') return false;
    return (await this.stepUser(tx, row.approvalRequestId, req.step)) === p.userId;
  }

  private async assertReady(tx: Tx, row: StatementRow, scope: 'sheet' | 'catalog') {
    const lines = await this.merged(tx, row.id);
    const check = scope === 'sheet' ? lines.filter((l) => l.onSheet) : lines;
    const blank = check.filter((l) => l.openingQty == null).map((l) => l.name);
    if (blank.length)
      throw err(
        422,
        'OPENING_REQUIRED',
        'Type an opening for every product, using 0 where there is none',
        { products: blank.slice(0, 20) },
      );
    const negative = check.filter((l) => (l.closingQty ?? 0) < 0).map((l) => l.name);
    if (negative.length)
      throw err(422, 'CLOSING_NEGATIVE', 'Closing cannot be negative', {
        products: negative.slice(0, 20),
      });
  }

  private async fillBlankOpenings(tx: Tx, row: StatementRow) {
    const lines = await this.merged(tx, row.id);
    const blanks = lines.filter((l) => l.openingQty == null);
    if (!blanks.length) return;
    const carried = await this.closingByProduct(tx, await this.priorStatement(tx, row));
    for (const line of blanks) {
      const fromClosing = carried.get(line.productId);
      await tx
        .insert(stockStatementLines)
        .values({
          id: uuidv7(),
          companyId: row.companyId,
          statementId: row.id,
          productId: line.productId,
          openingQty: fromClosing ?? 0,
          openingSource: fromClosing == null ? 'typed' : 'carried',
          purchaseQty: line.purchaseQty,
          freeQty: line.freeQty,
          secondaryQty: line.secondaryQty,
          frsQty: line.frsQty,
          pts: line.pts == null ? null : money(line.pts),
          productName: line.name,
          packSize: line.packSize,
        })
        .onConflictDoUpdate({
          target: [stockStatementLines.statementId, stockStatementLines.productId],
          targetWhere: sql`${stockStatementLines.deletedAt} is null`,
          set: {
            openingQty: fromClosing ?? 0,
            openingSource: fromClosing == null ? 'typed' : 'carried',
          },
        });
    }
    await this.retotal(tx, row);
  }

  private async applyClosingToNext(tx: Tx, row: StatementRow) {
    const nextKey = nextMonth(String(row.month).slice(0, 10));
    const [next] = await tx
      .select()
      .from(stockStatements)
      .where(
        and(
          eq(stockStatements.stockistId, row.stockistId),
          eq(stockStatements.month, nextKey),
          isNull(stockStatements.deletedAt),
        ),
      )
      .limit(1);
    if (!next || next.status === 'pending' || next.status === 'approved') return;
    const closings = await this.merged(tx, row.id);
    let wrote = false;
    for (const line of closings) {
      if (line.closingQty == null) continue;
      wrote = true;
      await tx
        .insert(stockStatementLines)
        .values({
          id: uuidv7(),
          companyId: next.companyId,
          statementId: next.id,
          productId: line.productId,
          openingQty: line.closingQty,
          openingSource: 'carried',
          purchaseQty: 0,
          freeQty: 0,
          secondaryQty: 0,
          frsQty: 0,
          pts: line.pts == null ? null : money(line.pts),
          productName: line.name,
          packSize: line.packSize,
        })
        .onConflictDoUpdate({
          target: [stockStatementLines.statementId, stockStatementLines.productId],
          targetWhere: sql`${stockStatementLines.deletedAt} is null`,
          set: { openingQty: line.closingQty, openingSource: 'carried' },
        });
    }
    if (wrote) await this.retotal(tx, next);
  }

  private async priorStatement(tx: Tx, row: StatementRow) {
    const [prior] = await tx
      .select()
      .from(stockStatements)
      .where(
        and(
          eq(stockStatements.stockistId, row.stockistId),
          eq(stockStatements.month, this.previous(String(row.month).slice(0, 10))),
          isNull(stockStatements.deletedAt),
        ),
      )
      .limit(1);
    return prior;
  }

  private async closingByProduct(tx: Tx, prior: StatementRow | undefined) {
    const carried = new Map<string, number>();
    if (!prior || prior.status !== 'approved') return carried;
    for (const line of await this.merged(tx, prior.id)) {
      if (line.closingQty != null) carried.set(line.productId, line.closingQty);
    }
    return carried;
  }

  private previous(month: string) {
    const [y, m] = month.slice(0, 7).split('-').map(Number) as [number, number];
    const d = new Date(Date.UTC(y, m - 2, 1));
    return d.toISOString().slice(0, 10);
  }

  private async visibleStockist(tx: Tx, p: Principal, id: string) {
    const scope = this.tenant.scope(p, territories.path);
    const [row] = await tx
      .select({
        id: stockists.id,
        name: stockists.name,
        addressLine: stockists.addressLine,
        city: stockists.city,
        state: stockists.state,
        territoryId: stockists.territoryId,
      })
      .from(stockists)
      .innerJoin(territories, eq(territories.id, stockists.territoryId))
      .where(and(eq(stockists.id, id), isNull(stockists.deletedAt), scope));
    if (!row) throw new NotFoundException('Stockist not found');
    return row;
  }

  private async owned(tx: Tx, p: Principal, id: string) {
    const [row] = await tx
      .select()
      .from(stockStatements)
      .where(and(eq(stockStatements.id, id), isNull(stockStatements.deletedAt)))
      .for('update');
    if (!row) throw new NotFoundException('Statement not found');
    await this.visibleStockist(tx, p, row.stockistId);
    return row;
  }

  private async editable(tx: Tx, p: Principal, id: string, version: number) {
    const row = await this.owned(tx, p, id);
    if (!(await this.mayEdit(tx, p, row)))
      throw err(409, 'STATEMENT_LOCKED', 'This statement cannot be edited');
    if (row.version !== version)
      throw err(409, 'VERSION_CONFLICT', 'This statement was saved somewhere else. Reload it.', {
        version: row.version,
      });
    return row;
  }

  private async carry(tx: Tx, p: Principal, previous: StatementRow, created: StatementRow) {
    const lines = await tx
      .select()
      .from(stockStatementLines)
      .where(
        and(
          eq(stockStatementLines.statementId, previous.id),
          isNull(stockStatementLines.deletedAt),
        ),
      );
    const catalog = await this.productRows(tx);
    const prev = new Map(lines.map((l) => [l.productId, l]));
    const rows = catalog.flatMap((product) => {
      const old = prev.get(product.id);
      if (!old) return [];
      const figured = figureLine(this.qty(old));
      if (figured.closingQty == null) return [];
      return [
        {
          id: uuidv7(),
          companyId: p.companyId,
          statementId: created.id,
          productId: product.id,
          openingQty: figured.closingQty,
          openingSource: 'carried' as const,
          purchaseQty: 0,
          freeQty: 0,
          secondaryQty: 0,
          frsQty: 0,
          pts: product.pts,
          productName: product.name,
          packSize: product.packSize,
        },
      ];
    });
    if (rows.length) await tx.insert(stockStatementLines).values(rows);
    await this.retotal(tx, created);
  }

  private async retotal(tx: Tx, row: StatementRow) {
    const lines = await this.merged(tx, row.id);
    const t = totalsOf(lines);
    await tx
      .update(stockStatements)
      .set({
        openingQty: t.openingQty,
        openingValue: money(t.openingValue),
        purchaseQty: t.purchaseQty,
        purchaseValue: money(t.purchaseValue),
        freeQty: t.freeQty,
        freeValue: money(t.freeValue),
        secondaryQty: t.secondaryQty,
        secondaryValue: money(t.secondaryValue),
        closingQty: t.closingQty,
        closingValue: money(t.closingValue),
        frsQty: t.frsQty,
        frsValue: money(t.frsValue),
        actualSecondary: money(t.actualSecondary),
      })
      .where(and(eq(stockStatements.id, row.id), eq(stockStatements.version, row.version)));
  }

  private async catalog(tx: Tx, statementId: string) {
    return this.merged(tx, statementId);
  }

  private async merged(tx: Tx, statementId: string): Promise<Merged[]> {
    const [stored, catalog] = await Promise.all([
      tx
        .select()
        .from(stockStatementLines)
        .where(
          and(
            eq(stockStatementLines.statementId, statementId),
            isNull(stockStatementLines.deletedAt),
          ),
        ),
      this.productRows(tx),
    ]);
    const byProduct = new Map(stored.map((l) => [l.productId, l]));
    const ids = new Set(catalog.map((p) => p.id));
    const extras = stored.filter((l) => !ids.has(l.productId));
    const rows = [
      ...catalog.map((product) => this.mergeOne(product, byProduct.get(product.id))),
      ...extras.map((line) =>
        this.mergeOne(
          {
            id: line.productId,
            name: line.productName,
            packSize: line.packSize,
            pts: line.pts,
          },
          line,
        ),
      ),
    ];
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows;
  }

  private mergeOne(
    product: { id: string; name: string; packSize: string | null; pts: string | null },
    line: LineRow | undefined,
  ): Merged {
    const pts = num(line?.pts ?? product.pts);
    const figured = figureLine({
      openingQty: line?.openingQty ?? null,
      purchaseQty: line?.purchaseQty ?? 0,
      freeQty: line?.freeQty ?? 0,
      secondaryQty: line?.secondaryQty ?? 0,
      frsQty: line?.frsQty ?? 0,
      pts,
    });
    return {
      ...figured,
      productId: product.id,
      name: line?.productName || product.name,
      packSize: line?.packSize ?? product.packSize,
      openingLocked: line?.openingSource === 'carried',
      onSheet: line != null,
    };
  }

  private qty(line: LineRow) {
    return {
      openingQty: line.openingQty,
      purchaseQty: line.purchaseQty,
      freeQty: line.freeQty,
      secondaryQty: line.secondaryQty,
      frsQty: line.frsQty,
      pts: num(line.pts),
    };
  }

  private async productRows(tx: Tx) {
    return tx
      .select({
        id: products.id,
        name: products.name,
        packSize: products.packSize,
        pts: products.pts,
      })
      .from(products)
      .where(and(isNull(products.deletedAt), eq(products.isSample, false)))
      .orderBy(asc(products.name));
  }

  private async sheet(tx: Tx, p: Principal, row: StatementRow) {
    const stockist = await this.visibleStockist(tx, p, row.stockistId);
    const lines = await this.merged(tx, row.id);
    const [approver] = row.approvalRequestId
      ? await tx
          .select({
            name: users.name,
            step: approvalRequests.currentStep,
            state: approvalRequests.state,
          })
          .from(approvalRequests)
          .innerJoin(
            approvalSteps,
            and(
              eq(approvalSteps.requestId, approvalRequests.id),
              eq(approvalSteps.stepNo, approvalRequests.currentStep),
            ),
          )
          .innerJoin(users, eq(users.id, approvalSteps.approverUserId))
          .where(eq(approvalRequests.id, row.approvalRequestId))
      : [];
    const canDecide =
      row.status === 'pending' &&
      !!approver &&
      approver.state === 'pending' &&
      (await this.stepUser(tx, row.approvalRequestId!, approver.step)) === p.userId;
    const locked = await this.dateLocked(tx, p, row);
    const filler = await this.isFiller(tx, p, row.stockistId);
    const submitter =
      filler && (row.status === 'draft' || row.status === 'rejected') && (!locked || row.editOpen);
    const [unlock] = await tx
      .select({ id: approvalRequests.id })
      .from(approvalRequests)
      .where(
        and(
          eq(approvalRequests.entityType, 'stock_statement_unlock'),
          eq(approvalRequests.entityId, row.id),
          eq(approvalRequests.state, 'pending'),
        ),
      )
      .limit(1);
    const tz = (await companySettings(tx, p)).timezone;
    return {
      id: row.id,
      stockistId: row.stockistId,
      stockistName: stockist.name,
      address:
        [stockist.addressLine, stockist.city, stockist.state].filter(Boolean).join(', ') || null,
      month: row.month.slice(0, 7),
      status: row.status,
      version: row.version,
      editable: submitter || (canDecide && !locked),
      canSubmit: submitter,
      canDecide,
      approvalRequestId: row.status === 'pending' ? row.approvalRequestId : null,
      rejectionReason: row.status === 'rejected' ? row.decisionComment : null,
      currentApproverName: row.status === 'pending' ? (approver?.name ?? null) : null,
      locked,
      lockAt: lockInstant(String(row.month), tz).toISOString(),
      editOpen: row.editOpen,
      unlockPending: !!unlock,
      canRequestUnlock: locked && filler && !row.editOpen && !unlock,
      totals: {
        openingQty: row.openingQty,
        openingValue: Number(row.openingValue),
        purchaseQty: row.purchaseQty,
        purchaseValue: Number(row.purchaseValue),
        freeQty: row.freeQty,
        freeValue: Number(row.freeValue),
        secondaryQty: row.secondaryQty,
        secondaryValue: Number(row.secondaryValue),
        closingQty: row.closingQty,
        closingValue: Number(row.closingValue),
        frsQty: row.frsQty,
        frsValue: Number(row.frsValue),
        actualSecondary: Number(row.actualSecondary),
      },
      lines: lines.map((l) => ({
        productId: l.productId,
        name: l.name,
        packSize: l.packSize,
        pts: l.pts,
        openingQty: l.openingQty,
        openingLocked: l.openingLocked,
        purchaseQty: l.purchaseQty,
        freeQty: l.freeQty,
        secondaryQty: l.secondaryQty,
        frsQty: l.frsQty,
        openingValue: l.openingValue,
        purchaseValue: l.purchaseValue,
        freeValue: l.freeValue,
        secondaryValue: l.secondaryValue,
        frsValue: l.frsValue,
        closingQty: l.closingQty,
        closingValue: l.closingValue,
      })),
      aws: { status: row.awsStatus, contentType: row.awsContentType },
      ss: { status: row.ssStatus, contentType: row.ssContentType },
      history: await this.history(tx, p, { stockistId: row.stockistId }),
    };
  }

  private async stepUser(tx: Tx, requestId: string, step: number) {
    const [s] = await tx
      .select({ id: approvalSteps.approverUserId })
      .from(approvalSteps)
      .where(and(eq(approvalSteps.requestId, requestId), eq(approvalSteps.stepNo, step)));
    return s?.id ?? null;
  }

  private async history(
    tx: Tx,
    p: Principal,
    q: { stockistId?: string; status?: StatementRow['status']; waiting?: string },
  ) {
    const scope = this.tenant.scope(p, territories.path);
    const waiting =
      q.waiting === 'true'
        ? sql`exists (
            select 1 from approval_requests r
            join approval_steps s on s.request_id = r.id and s.step_no = r.current_step
            where r.id = ${stockStatements.approvalRequestId}
              and r.state = 'pending' and s.approver_user_id = ${p.userId}
          )`
        : undefined;
    const rows = await tx
      .select({
        id: stockStatements.id,
        stockistId: stockStatements.stockistId,
        stockistName: stockists.name,
        month: stockStatements.month,
        status: stockStatements.status,
        actualSecondary: stockStatements.actualSecondary,
        submittedByName: users.name,
      })
      .from(stockStatements)
      .innerJoin(stockists, eq(stockists.id, stockStatements.stockistId))
      .innerJoin(territories, eq(territories.id, stockists.territoryId))
      .leftJoin(users, eq(users.id, stockStatements.submittedBy))
      .where(
        and(
          isNull(stockStatements.deletedAt),
          scope,
          q.stockistId ? eq(stockStatements.stockistId, q.stockistId) : undefined,
          q.status ? eq(stockStatements.status, q.status) : undefined,
          waiting,
        ),
      )
      .orderBy(desc(stockStatements.month), asc(stockists.name));
    return rows.map((r) => ({
      id: r.id,
      stockistId: r.stockistId,
      stockistName: r.stockistName,
      month: r.month.slice(0, 7),
      status: r.status,
      actualSecondary: Number(r.actualSecondary),
      submittedByName: r.submittedByName,
    }));
  }

  private async approvers(tx: Tx, userId: string) {
    const me = await this.person(tx, userId);
    if (me?.role === 'regional_business_manager') return [];
    if (me?.role === 'area_business_manager') {
      if (!me.managerId)
        throw err(422, 'APPROVER_MISSING', 'You have no regional manager to send this to');
      const regional = await this.person(tx, me.managerId);
      if (
        !regional ||
        regional.status !== 'active' ||
        regional.role !== 'regional_business_manager'
      )
        throw err(422, 'APPROVER_MISSING', 'Your regional manager is not active', {
          name: regional?.name ?? null,
        });
      return [regional];
    }
    if (!me?.managerId) throw err(422, 'APPROVER_MISSING', 'You have no manager to send this to');
    const area = await this.person(tx, me.managerId);
    if (area?.status === 'active' && area.role === 'regional_business_manager') return [area];
    if (!area || area.status !== 'active' || area.role !== 'area_business_manager')
      throw err(422, 'APPROVER_MISSING', 'Your area manager is not active', {
        name: area?.name ?? null,
      });
    if (!area.managerId)
      throw err(422, 'APPROVER_MISSING', 'Your area manager has no regional manager');
    const regional = await this.person(tx, area.managerId);
    if (!regional || regional.status !== 'active' || regional.role !== 'regional_business_manager')
      throw err(422, 'APPROVER_MISSING', 'Your regional manager is not active', {
        name: regional?.name ?? null,
      });
    return [area, regional];
  }

  private async person(tx: Tx, id: string) {
    const [row] = await tx
      .select({
        id: users.id,
        name: users.name,
        status: users.status,
        managerId: users.managerId,
        role: roles.key,
      })
      .from(users)
      .leftJoin(userRoles, eq(userRoles.userId, users.id))
      .leftJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .orderBy(desc(roles.rank))
      .limit(1);
    return row ?? null;
  }

  async requestUnlock(p: Principal, id: string) {
    this.blockAdmin(p);
    return this.tenant.run(p, async (tx) => {
      const row = await this.owned(tx, p, id);
      const view = await this.sheet(tx, p, row);
      if (!view.canRequestUnlock)
        throw err(409, 'STATEMENT_LOCKED', 'This statement cannot be unlocked');
      await this.approvals.request(tx, p, 'stock_statement_unlock', row.id, null, {
        month: row.month.slice(0, 7),
        stockistName: view.stockistName,
      });
      const directors = await tx
        .select({ id: users.id })
        .from(users)
        .innerJoin(userRoles, eq(userRoles.userId, users.id))
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(and(eq(roles.key, 'director'), eq(users.status, 'active'), isNull(users.deletedAt)));
      for (const director of directors)
        await this.notifications.notify(tx, p, {
          type: 'stock_statement.unlock',
          recipientId: director.id,
          entityType: 'stock_statement',
          entityId: row.id,
          dedupeKey: `stock_statement.unlock:${row.id}:${director.id}`,
          data: { month: row.month.slice(0, 7), stockistName: view.stockistName },
        });
      const [fresh] = await tx.select().from(stockStatements).where(eq(stockStatements.id, row.id));
      return this.sheet(tx, p, fresh!);
    });
  }

  private async isFiller(tx: Tx, p: Principal, stockistId: string) {
    const seat = await this.fillerSeat(tx, stockistId);
    return seat?.userIds.has(p.userId) ?? false;
  }

  private async fillerMessage(tx: Tx, stockistId: string) {
    const seat = await this.fillerSeat(tx, stockistId);
    if (!seat) return 'No business manager, area manager, or regional manager is assigned here';
    if (seat.rank === 0) return 'The business manager opens this month';
    if (seat.rank === 1) return 'The area manager opens this month';
    return 'The regional manager opens this month';
  }

  private async fillerSeat(tx: Tx, stockistId: string) {
    const [stock] = await tx
      .select({ path: territories.path })
      .from(stockists)
      .innerJoin(territories, eq(territories.id, stockists.territoryId))
      .where(eq(stockists.id, stockistId));
    if (!stock) return null;
    const holders = await tx
      .select({ userId: users.id, role: roles.key })
      .from(userTerritories)
      .innerJoin(territories, eq(territories.id, userTerritories.territoryId))
      .innerJoin(users, eq(users.id, userTerritories.userId))
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(
        and(
          eq(users.status, 'active'),
          isNull(users.deletedAt),
          inArray(roles.key, [
            'business_manager',
            'area_business_manager',
            'regional_business_manager',
          ]),
          sql`(${stock.path} = ${territories.path} or starts_with(${stock.path}, ${territories.path} || '.'))`,
        ),
      );
    const rankOf = {
      business_manager: 0,
      area_business_manager: 1,
      regional_business_manager: 2,
    } as const;
    let rank = 99;
    const userIds = new Set<string>();
    for (const holder of holders) {
      const next = rankOf[holder.role as keyof typeof rankOf];
      if (next == null) continue;
      if (next < rank) {
        rank = next;
        userIds.clear();
      }
      if (next === rank) userIds.add(holder.userId);
    }
    return userIds.size ? { rank, userIds } : null;
  }

  private async stockistName(tx: Tx, id: string) {
    const [row] = await tx
      .select({ name: stockists.name })
      .from(stockists)
      .where(eq(stockists.id, id));
    return row?.name ?? '';
  }

  private async writeSales(tx: Tx, row: StatementRow) {
    const [stockist] = await tx
      .select({ territoryId: stockists.territoryId })
      .from(stockists)
      .where(eq(stockists.id, row.stockistId));
    if (!stockist) return;
    await tx
      .update(salesActuals)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(salesActuals.stockistId, row.stockistId),
          eq(salesActuals.month, row.month),
          inArray(salesActuals.kind, ['primary', 'secondary']),
          isNull(salesActuals.deletedAt),
        ),
      );
    const lines = await this.merged(tx, row.id);
    const base = {
      companyId: row.companyId,
      territoryId: stockist.territoryId,
      stockistId: row.stockistId,
      month: row.month,
    };
    const values = lines.flatMap((l) => {
      const rows = [];
      if (l.purchaseQty !== 0) {
        rows.push({
          ...base,
          id: uuidv7(),
          productId: l.productId,
          kind: 'primary' as const,
          quantity: l.purchaseQty,
          freeQuantity: 0,
          value: money(l.purchaseValue ?? 0),
        });
      }
      if (l.secondaryQty !== 0 || l.frsQty !== 0) {
        rows.push({
          ...base,
          id: uuidv7(),
          productId: l.productId,
          kind: 'secondary' as const,
          quantity: l.secondaryQty,
          freeQuantity: l.frsQty,
          value: money((l.secondaryValue ?? 0) - (l.frsValue ?? 0)),
        });
      }
      return rows;
    });
    if (values.length) await tx.insert(salesActuals).values(values);
  }
}

type Merged = FiguredLine & {
  productId: string;
  name: string;
  packSize: string | null;
  openingLocked: boolean;
  onSheet: boolean;
};

const EXCEL_TYPES = new Set([
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
  'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
  'application/excel',
  'application/x-excel',
  'application/x-msexcel',
  'application/vnd.ms-office',
]);

function sniff(type: string, b: Uint8Array) {
  const at = (sig: number[]) => b.length >= sig.length && sig.every((x, i) => b[i] === x);
  if (type === 'image/jpeg') return at([0xff, 0xd8, 0xff]);
  if (type === 'image/png') return at([0x89, 0x50, 0x4e, 0x47]);
  if (type === 'image/webp') return b.length > 12 && b[0] === 0x52 && b[1] === 0x49;
  if (type === 'application/pdf') return at([0x25, 0x50, 0x44, 0x46]);
  if (EXCEL_TYPES.has(type)) return excelContentMatches(type, b);
  return false;
}
