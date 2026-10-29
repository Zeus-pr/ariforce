/* eslint-disable @typescript-eslint/no-explicit-any -- generic drizzle glue over many master tables */
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Id } from '@ariforce/contracts';
import { territories, type Tx } from '@ariforce/db';
import { and, asc, count, desc, eq, gt, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Principal } from '../auth/principal';
import { AuditService } from '../common/audit.service';
import { TenantService } from '../common/tenant.service';
import { StorageService } from '../files/storage.service';
import { PRICE_KEYS, recordPriceChange } from '../product-prices/product-prices.service';
import { DoctorsService } from './doctors.service';
import { baseFromRow, type MasterDef } from './master-defs';

type Row = Record<string, unknown>;
type Q = Record<string, unknown> & {
  limit?: number;
  cursor?: string;
  updatedSince?: string;
  q?: string;
  sort?: string;
  includeTotal?: 'true' | 'false';
};

export const encodeCursor = (offset: number) => Buffer.from(`o:${offset}`).toString('base64');
export function decodeCursor(c: string | undefined): number {
  if (!c) return 0;
  const m = /^o:(\d+)$/.exec(Buffer.from(c, 'base64').toString());
  if (!m) throw new HttpException({ code: 'VALIDATION', message: 'Invalid cursor' }, 422);
  return Number(m[1]);
}

/**
 * Generic masters CRUD. Company isolation = RLS (TenantService.run); hierarchy = territory path of the
 * owning territory for territory-owned masters. Out-of-scope reads are 404 (no existence leak).
 */
@Injectable()
export class MastersService {
  constructor(
    readonly tenant: TenantService,
    private readonly audit: AuditService,
    private readonly doctorsSvc: DoctorsService,
    private readonly storage: StorageService,
  ) {}

  dto(def: MasterDef, r: Row) {
    const plain = baseFromRow(r);
    return def.dto.parse(def.fromRow ? def.fromRow(plain) : plain) as Row;
  }

  /** Products: presigned imageUrl for rows with a picture (local crypto; dto/audit keep it null). */
  async withImages(def: MasterDef, p: Principal, items: Row[]): Promise<Row[]> {
    if (def.entity !== 'product') return items;
    return Promise.all(
      items.map(async (r) => ({
        ...r,
        imageUrl: r.imageFileKey
          ? await this.storage.imageUrl(p.companyId, String(r.imageFileKey))
          : null,
      })),
    );
  }

  /** Base select with hierarchy scope (and the territories join it needs). */
  private select(tx: Tx, def: MasterDef, p: Principal, where: (SQL | undefined)[]) {
    const t = def.table as any;
    if (def.table === (territories as unknown)) {
      return {
        q: tx.select({ r: t }).from(t),
        where: and(this.tenant.scope(p, territories.path), ...where),
      };
    }
    if (def.territoryCol) {
      return {
        q: tx.select({ r: t }).from(t).innerJoin(territories, eq(territories.id, def.territoryCol)),
        where: and(this.tenant.scope(p, territories.path), ...where),
      };
    }
    return { q: tx.select({ r: t }).from(t), where: and(...where) };
  }

  async list(def: MasterDef, p: Principal, q: Q) {
    const limit = q.limit ?? 50;
    const offset = decodeCursor(q.cursor);
    const serverTime = new Date().toISOString();
    const t = def.table;
    const term = q.q?.trim();
    const where = [
      q.updatedSince ? gt(t.updatedAt, new Date(q.updatedSince)) : isNull(t.deletedAt),
      term && def.search.length
        ? or(...def.search.map((c) => ilike(c, `%${term.replace(/[\\%_]/g, '\\$&')}%`)))
        : undefined,
      ...(def.filters?.(q) ?? []),
    ];
    let order: SQL[];
    if (q.sort) {
      const desc_ = q.sort.startsWith('-');
      const col = def.sort[q.sort.replace(/^-/, '')];
      if (!col)
        throw new HttpException({ code: 'VALIDATION', message: `Unknown sort '${q.sort}'` }, 422);
      const key = q.sort.replace(/^-/, '') === 'name' && def.nameOrder ? sql`lower(${col})` : col;
      order = [desc_ ? desc(key) : asc(key), asc(t.id)];
    } else if (q.updatedSince) order = [asc(t.updatedAt), asc(t.id)];
    else order = def.nameOrder ? [asc(sql`lower(${def.nameOrder})`), asc(t.id)] : [asc(t.id)];
    return this.tenant.run(p, async (tx) => {
      const s = this.select(tx, def, p, where);
      const rows = (await s.q
        .where(s.where)
        .orderBy(...order)
        .limit(limit + 1)
        .offset(offset)) as { r: Row }[];
      let total: number | undefined;
      if (q.includeTotal === 'true' && !q.updatedSince) {
        const base =
          def.territoryCol && def.table !== (territories as unknown)
            ? tx
                .select({ n: count() })
                .from(t)
                .innerJoin(territories, eq(territories.id, def.territoryCol))
            : tx.select({ n: count() }).from(t);
        const [n] = await base.where(s.where);
        total = Number(n?.n ?? 0);
      }
      let items = rows.slice(0, limit).map((r) => this.dto(def, r.r));
      if (def.entity === 'doctor') items = await this.doctorsSvc.withRejection(tx, p, items);
      items = await this.withImages(def, p, items);
      return {
        items,
        nextCursor: rows.length > limit ? encodeCursor(offset + limit) : null,
        serverTime,
        ...(total === undefined ? {} : { total }),
      };
    });
  }

  async findRow(tx: Tx, def: MasterDef, p: Principal, id: string): Promise<Row> {
    if (!Id.safeParse(id).success) throw new NotFoundException(`${def.entity} not found`);
    const s = this.select(tx, def, p, [eq(def.table.id, id), isNull(def.table.deletedAt)]);
    const [r] = (await s.q.where(s.where)) as { r: Row }[];
    if (!r) throw new NotFoundException(`${def.entity} not found`);
    return r.r;
  }

  get(def: MasterDef, p: Principal, id: string) {
    return this.tenant.run(p, async (tx) => {
      if (def.entity !== 'doctor') {
        const [d] = await this.withImages(def, p, [
          this.dto(def, await this.findRow(tx, def, p, id)),
        ]);
        return d!;
      }
      // Doctors: an assigned approver may read the doctor by id even outside their territory scope.
      let row: Row | null;
      try {
        row = await this.findRow(tx, def, p, id);
      } catch (e) {
        if (!(e instanceof NotFoundException)) throw e;
        row = await this.doctorsSvc.assignedRow(tx, p, id);
        if (!row) throw e;
      }
      const [d] = await this.doctorsSvc.withRejection(tx, p, [this.dto(def, row)]);
      return d!;
    });
  }

  assertCanWrite(def: MasterDef, p: Principal) {
    if (!p.permissions.includes(def.writePermission))
      throw new ForbiddenException(`Missing permission: ${def.writePermission}`);
    if (def.wideWrite && p.scopePaths !== null)
      throw new ForbiddenException(`Only company-wide roles can change ${def.entity} masters`);
  }

  /** The territory must exist and be inside the caller's hierarchy. */
  async assertTerritory(tx: Tx, p: Principal, territoryId: unknown) {
    const [t] = await tx
      .select({ id: territories.id })
      .from(territories)
      .where(
        and(
          eq(territories.id, String(territoryId)),
          isNull(territories.deletedAt),
          this.tenant.scope(p, territories.path),
        ),
      );
    if (!t) throw new ForbiddenException('Territory outside your hierarchy');
  }

  /** Price changes through the generic product routes are recorded in price history (source 'masters'). */
  private async trackPrices(tx: Tx, def: MasterDef, p: Principal, row: Row, before?: Row) {
    if (def.entity !== 'product') return;
    const pick = (r?: Row) => ({
      mrp: r?.mrp == null ? null : Number(r.mrp),
      ptr: r?.ptr == null ? null : Number(r.ptr),
      pts: r?.pts == null ? null : Number(r.pts),
    });
    const [b, a] = [pick(before), pick(row)];
    if (PRICE_KEYS.some((k) => a[k] !== b[k]))
      await recordPriceChange(tx, this.audit, p, String(row.id), b, a, 'masters');
  }

  /** Insert inside an existing transaction (used by import too). */
  async insert(tx: Tx, def: MasterDef, p: Principal, body: Row, action = 'create') {
    if (def.territoryCol && 'territoryId' in body)
      await this.assertTerritory(tx, p, body.territoryId);
    const isDoctor = def.entity === 'doctor';
    const { allowPossibleDuplicate: _allow, ...fields } = body;
    // Duplicate detection (#26); imports run their own duplicate rules.
    const possible =
      isDoctor && action === 'create' ? await this.doctorsSvc.guardCreate(tx, body) : [];
    const values: Row = {
      ...(def.toRow ? def.toRow(fields, p) : fields),
      id: uuidv7(),
      companyId: p.companyId,
    };
    if (isDoctor)
      // Field-added doctors need manager approval (#26); company-wide roles add approved masters.
      values.approvalStatus = p.scopePaths === null ? 'approved' : 'pending';
    const [row] = await tx
      .insert(def.table)
      .values(values as any)
      .returning();
    if (isDoctor && values.approvalStatus === 'pending')
      await this.doctorsSvc.requestApproval(
        tx,
        p,
        row as Row,
        possible,
        `New doctor ${String(fields.name)}`,
      );
    await this.trackPrices(tx, def, p, row as Row);
    const dto = this.dto(def, row as Row);
    await this.audit.record(tx, p, `${def.entity}.${action}`, {
      entityType: def.entity,
      entityId: dto.id as string,
      after: dto,
    });
    return dto;
  }

  create(def: MasterDef, p: Principal, body: Row) {
    this.assertCanWrite(def, p);
    return this.tenant.run(p, (tx) => this.insert(tx, def, p, body));
  }

  async patch(tx: Tx, def: MasterDef, p: Principal, id: string, body: Row, action = 'update') {
    const before = await this.findRow(tx, def, p, id);
    const { version, ...changes } = body;
    if (def.territoryCol && changes.territoryId && changes.territoryId !== before.territoryId)
      await this.assertTerritory(tx, p, changes.territoryId);
    const set: Row = def.toRow ? def.toRow(changes, p) : { ...changes };
    // The territory link sits under the HQ: a new HQ drops it (TERRITORY-MODEL.md).
    if (
      'localTerritoryId' in before &&
      before.localTerritoryId &&
      changes.territoryId &&
      changes.territoryId !== before.territoryId
    )
      set.localTerritoryId = null;
    // A rejected field-added doctor goes back for approval when its owner edits it (#26).
    const resubmit =
      def.entity === 'doctor' && before.approvalStatus === 'rejected' && p.scopePaths !== null;
    if (resubmit) set.approvalStatus = 'pending';
    const [row] = await tx
      .update(def.table)
      .set(set as any)
      .where(
        and(
          eq(def.table.id, id),
          version === undefined ? undefined : eq(def.table.version, Number(version)),
        ),
      )
      .returning();
    if (!row)
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'Stale version',
        details: this.dto(def, before),
      });
    if (resubmit)
      await this.doctorsSvc.requestApproval(
        tx,
        p,
        row as Row,
        [],
        `Doctor resubmitted ${String((row as Row).name)}`,
      );
    await this.trackPrices(tx, def, p, row as Row, before);
    const dto = this.dto(def, row as Row);
    await this.audit.record(tx, p, `${def.entity}.${action}`, {
      entityType: def.entity,
      entityId: id,
      before: this.dto(def, before),
      after: dto,
    });
    return dto;
  }

  update(def: MasterDef, p: Principal, id: string, body: Row) {
    this.assertCanWrite(def, p);
    return this.tenant
      .run(p, (tx) => this.patch(tx, def, p, id, body))
      .then(async (d) => (await this.withImages(def, p, [d]))[0]!);
  }

  remove(def: MasterDef, p: Principal, id: string) {
    this.assertCanWrite(def, p);
    return this.tenant.run(p, async (tx) => {
      await this.findRow(tx, def, p, id);
      await tx
        .update(def.table)
        .set({ deletedAt: sql`now()` } as any)
        .where(eq(def.table.id, id));
      await this.audit.record(tx, p, `${def.entity}.delete`, {
        entityType: def.entity,
        entityId: id,
      });
    });
  }
}
