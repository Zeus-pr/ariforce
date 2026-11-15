import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import type { StockStatementFileBody, StockStatementLineInput } from '@ariforce/contracts';
import {
  approvalRequests,
  approvalSteps,
  companies,
  products,
  roles,
  salesActuals,
  stockStatementLines,
  stockStatements,
  stockists,
  territories,
  userRoles,
  users,
  type Tx,
} from '@ariforce/db';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Principal } from '../auth/principal';
import { AuditService } from '../common/audit.service';
import { TenantService } from '../common/tenant.service';
import { err } from '../field/checkins.service';
import { companySettings, localDate } from '../field/field.util';
import { StorageService } from '../files/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ApprovalsService } from '../plans/approvals.service';
import { figureLine, monthStart, nextMonth, totalsOf, type FiguredLine } from './math';
import { statementPdf } from './pdf';

type LineRow = typeof stockStatementLines.$inferSelect;
type StatementRow = typeof stockStatements.$inferSelect;

const money = (n: number) => n.toFixed(2);
const num = (v: string | null) => (v == null ? null : Number(v));

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
          if (row) await this.assertReady(tx, row);
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
      if (!p.roles.includes('business_manager'))
        throw err(422, 'NOT_STARTED', 'The business manager has not opened this month');
      const [latest] = await tx
        .select()
        .from(stockStatements)
        .where(and(eq(stockStatements.stockistId, stockistId), isNull(stockStatements.deletedAt)))
        .orderBy(desc(stockStatements.month))
        .limit(1);
      if (latest && (latest.month !== this.previous(start) || latest.status !== 'approved')) {
        throw err(
          422,
          latest.status === 'approved' ? 'MONTH_OUT_OF_SEQUENCE' : 'PREVIOUS_MONTH_OPEN',
          latest.status === 'approved'
            ? `The next month is ${nextMonth(latest.month).slice(0, 7)}`
            : `${latest.month.slice(0, 7)} has to be approved before the next month opens`,
        );
      }
      const id = uuidv7();
      const [created] = await tx
        .insert(stockStatements)
        .values({ id, companyId: p.companyId, stockistId, month: start })
        .returning();
      if (latest) await this.carry(tx, p, latest, created!);
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
              secondaryQty: input.secondaryQty,
              frsQty: input.frsQty,
              pts: pts == null ? null : money(pts),
              productName: known.name,
              packSize: known.packSize,
            },
          });
      }
      await this.retotal(tx, row);
      const [fresh] = await tx.select().from(stockStatements).where(eq(stockStatements.id, row.id));
      return this.sheet(tx, p, fresh!);
    });
  }

  submit(p: Principal, id: string, version: number) {
    this.blockAdmin(p);
    return this.tenant.run(p, async (tx) => {
      const row = await this.owned(tx, p, id);
      if (!this.bmDraft(p, row))
        throw err(409, 'STATEMENT_LOCKED', 'This statement cannot be edited');
      if (row.version !== version)
        throw err(409, 'VERSION_CONFLICT', 'This statement was saved somewhere else. Reload it.', {
          version: row.version,
        });
      await this.assertReady(tx, row);
      const chain = await this.approvers(tx, p.userId);
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
      if (!key || status !== 'confirmed')
        throw err(409, 'UPLOAD_NOT_CONFIRMED', 'That file is not ready');
      return this.storage.downloadUrl(
        p.companyId,
        key,
        new Date(),
        `${kind}-${row.month.slice(0, 7)}.pdf`,
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
        body.contentType === 'application/pdf' ? 'pdf' : body.contentType.split('/')[1]!,
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
      const bytes = await this.storage.firstBytes(key, 16);
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
        company: company?.name ?? 'Arighna Pharmaceutical',
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
          secondaryQty: l.secondaryQty,
          secondaryValue: l.secondaryValue,
          closingQty: l.closingQty,
          closingValue: l.closingValue,
          frsQty: l.frsQty,
        })),
      });
    });
  }

  private blockAdmin(p: Principal) {
    if (p.roles.includes('system_admin'))
      throw new ForbiddenException('System admin cannot open stock statements');
  }

  private bmDraft(p: Principal, row: StatementRow) {
    return (
      p.roles.includes('business_manager') && (row.status === 'draft' || row.status === 'rejected')
    );
  }

  private async mayEdit(tx: Tx, p: Principal, row: StatementRow) {
    if (p.roles.includes('system_admin')) return false;
    if (this.bmDraft(p, row)) return true;
    if (row.status !== 'pending' || !row.approvalRequestId) return false;
    const [req] = await tx
      .select({ step: approvalRequests.currentStep, state: approvalRequests.state })
      .from(approvalRequests)
      .where(eq(approvalRequests.id, row.approvalRequestId));
    if (!req || req.state !== 'pending') return false;
    return (await this.stepUser(tx, row.approvalRequestId, req.step)) === p.userId;
  }

  private async assertReady(tx: Tx, row: StatementRow) {
    const lines = await this.merged(tx, row.id);
    const blank = lines.filter((l) => l.openingQty == null).map((l) => l.name);
    if (blank.length)
      throw err(
        422,
        'OPENING_REQUIRED',
        'Type an opening for every product, using 0 where there is none',
        { products: blank.slice(0, 20) },
      );
    const negative = lines.filter((l) => (l.closingQty ?? 0) < 0).map((l) => l.name);
    if (negative.length)
      throw err(422, 'CLOSING_NEGATIVE', 'Closing cannot be negative', {
        products: negative.slice(0, 20),
      });
    const unpriced = lines
      .filter(
        (l) =>
          l.pts == null && (l.openingQty != null || l.purchaseQty || l.secondaryQty || l.frsQty),
      )
      .map((l) => l.name);
    if (unpriced.length)
      throw err(
        422,
        'PTS_REQUIRED',
        'These products have no PTS, so the value cannot be calculated',
        {
          products: unpriced.slice(0, 20),
        },
      );
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
    };
  }

  private qty(line: LineRow) {
    return {
      openingQty: line.openingQty,
      purchaseQty: line.purchaseQty,
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
      .where(
        and(isNull(products.deletedAt), eq(products.active, true), eq(products.isSample, false)),
      )
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
    return {
      id: row.id,
      stockistId: row.stockistId,
      stockistName: stockist.name,
      address:
        [stockist.addressLine, stockist.city, stockist.state].filter(Boolean).join(', ') || null,
      month: row.month.slice(0, 7),
      status: row.status,
      version: row.version,
      editable: this.bmDraft(p, row) || canDecide,
      canSubmit: this.bmDraft(p, row),
      canDecide,
      approvalRequestId: row.status === 'pending' ? row.approvalRequestId : null,
      rejectionReason: row.status === 'rejected' ? row.decisionComment : null,
      currentApproverName: row.status === 'pending' ? (approver?.name ?? null) : null,
      totals: {
        openingQty: row.openingQty,
        openingValue: Number(row.openingValue),
        purchaseQty: row.purchaseQty,
        purchaseValue: Number(row.purchaseValue),
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
        secondaryQty: l.secondaryQty,
        frsQty: l.frsQty,
        openingValue: l.openingValue,
        purchaseValue: l.purchaseValue,
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
    if (!me?.managerId)
      throw err(422, 'APPROVER_MISSING', 'You have no area manager to send this to');
    const area = await this.person(tx, me.managerId);
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
      .where(and(eq(users.id, id), isNull(users.deletedAt)));
    return row ?? null;
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
          eq(salesActuals.kind, 'secondary'),
          isNull(salesActuals.deletedAt),
        ),
      );
    const lines = await this.merged(tx, row.id);
    const values = lines.flatMap((l) => {
      if (l.secondaryQty === 0 && l.frsQty === 0) return [];
      return [
        {
          id: uuidv7(),
          companyId: row.companyId,
          territoryId: stockist.territoryId,
          stockistId: row.stockistId,
          productId: l.productId,
          month: row.month,
          kind: 'secondary' as const,
          quantity: l.secondaryQty,
          freeQuantity: l.frsQty,
          value: money((l.secondaryValue ?? 0) - (l.frsValue ?? 0)),
        },
      ];
    });
    if (values.length) await tx.insert(salesActuals).values(values);
  }
}

type Merged = FiguredLine & {
  productId: string;
  name: string;
  packSize: string | null;
  openingLocked: boolean;
};

function sniff(type: string, b: Uint8Array) {
  const at = (sig: number[]) => b.length >= sig.length && sig.every((x, i) => b[i] === x);
  if (type === 'image/jpeg') return at([0xff, 0xd8, 0xff]);
  if (type === 'image/png') return at([0x89, 0x50, 0x4e, 0x47]);
  if (type === 'image/webp') return b.length > 12 && b[0] === 0x52 && b[1] === 0x49;
  if (type === 'application/pdf') return at([0x25, 0x50, 0x44, 0x46]);
  return false;
}
