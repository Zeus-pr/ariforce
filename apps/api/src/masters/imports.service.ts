/* eslint-disable @typescript-eslint/no-explicit-any -- generic drizzle glue over many master tables */
import { ConflictException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import {
  duplicateKeys,
  Id,
  ImportJob,
  mapImportRow,
  type ImportEntity,
  type ImportLookup,
  type ImportRequest,
  type ImportRowResult,
} from '@ariforce/contracts';
import {
  divisions,
  doctorCategories,
  importJobs,
  importRows,
  products,
  specialties,
  territories,
  type Tx,
} from '@ariforce/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Principal } from '../auth/principal';
import { AuditService } from '../common/audit.service';
import { TenantService } from '../common/tenant.service';
import { MASTERS, type MasterDef } from './master-defs';
import { MastersService } from './masters.service';

type Row = Record<string, unknown>;
export type MasterImportEntity = Exclude<ImportEntity, 'users'>;

const DEF: Record<MasterImportEntity, MasterDef> = {
  doctors: MASTERS.doctors!,
  chemists: MASTERS.chemists!,
  stockists: MASTERS.stockists!,
  products: MASTERS.products!,
  divisions: MASTERS.divisions!,
  product_hq: MASTERS['product-hq-mappings']!,
  territories: MASTERS.territories!,
};
const up = (s: unknown) => String(s ?? '').toUpperCase();

/**
 * Excel/CSV import (docs/IMPORT.md): the shared template mapper from @ariforce/contracts (same code the
 * mock runs), then duplicate rules, then (apply only) one savepoint per row so valid rows are saved even
 * when others fail. Every attempt, dry run included, is stored in import_jobs/import_rows.
 */
/**
 * Materialised path of a new territory, following the parent's convention: real data uses code
 * segments (WB.HQ_MALDA), the seed and older imports use ids. Code segment = the code with every
 * non-alphanumeric as '_' (HQ-MALDA -> HQ_MALDA). Falls back to the id when the parent is id-based,
 * the code segment would be empty, or the path is already taken. Roots use the id.
 */
export function childPath(
  parentId: string | null | undefined,
  parentPath: string | null | undefined,
  code: string,
  id: string,
  taken: Set<string>,
): string {
  if (!parentId || !parentPath) return id;
  const parentSeg = parentPath.slice(parentPath.lastIndexOf('.') + 1);
  const seg = code.trim().replace(/[^A-Za-z0-9]/g, '_');
  const byCode = `${parentPath}.${seg}`;
  if (parentSeg !== parentId && seg && !taken.has(byCode)) return byCode;
  return `${parentPath}.${id}`;
}

@Injectable()
export class ImportsService {
  constructor(
    private readonly tenant: TenantService,
    private readonly masters: MastersService,
    private readonly audit: AuditService,
  ) {}

  private async lookup(
    tx: Tx,
    p: Principal,
  ): Promise<ImportLookup & { territoryPath: Map<string, string> }> {
    const terr = await tx
      .select({ id: territories.id, code: territories.code, path: territories.path })
      .from(territories)
      .where(and(isNull(territories.deletedAt), this.tenant.scope(p, territories.path)));
    const map = async (
      t: typeof specialties | typeof doctorCategories | typeof divisions | typeof products,
    ) =>
      new Map(
        (await tx.select({ id: t.id, code: t.code }).from(t).where(isNull(t.deletedAt))).map(
          (r) => [up(r.code), r.id],
        ),
      );
    const [sp, cat, div, prod] = await Promise.all([
      map(specialties),
      map(doctorCategories),
      map(divisions),
      map(products),
    ]);
    const tm = new Map(terr.map((t) => [up(t.code), t.id]));
    return {
      territory: (c) => tm.get(c),
      specialty: (c) => sp.get(c),
      category: (c) => cat.get(c),
      division: (c) => div.get(c),
      product: (c) => prod.get(c),
      territoryPath: new Map(terr.map((t) => [t.id, t.path])),
    };
  }

  /** Existing (non-deleted) rows company-wide, indexed by duplicate key. */
  private async existing(tx: Tx, entity: MasterImportEntity) {
    const def = DEF[entity];
    const t = def.table as any;
    const rows = (await tx.select().from(t).where(isNull(def.table.deletedAt))) as Row[];
    const idx = new Map<string, Row>();
    for (const r of rows) {
      const body = entity === 'territories' ? r : def.fromRow ? def.fromRow(r) : r;
      for (const k of duplicateKeys(entity, body)) idx.set(`${k.rule}:${k.key}`, r);
    }
    return idx;
  }

  async run(p: Principal, entity: MasterImportEntity, req: ImportRequest, idemKey?: string) {
    const def = DEF[entity];
    this.masters.assertCanWrite(def, p);
    if (req.fileKey && !req.fileKey.startsWith(`${p.companyId}/import_source/`))
      throw new HttpException(
        { code: 'VALIDATION', message: 'fileKey must come from an import_source upload' },
        422,
      );
    return this.tenant.run(p, async (tx) => {
      if (idemKey) {
        const [prev] = await tx
          .select()
          .from(importJobs)
          .where(and(eq(importJobs.idempotencyKey, idemKey), eq(importJobs.dryRun, req.dryRun)));
        if (prev) {
          if (prev.entity !== entity || prev.onDuplicate !== req.onDuplicate)
            throw new ConflictException({
              code: 'IDEMPOTENCY_CONFLICT',
              message: 'Idempotency-Key reused with a different request',
            });
          return this.load(tx, prev.id);
        }
      }
      const lk = await this.lookup(tx, p);
      const idx = await this.existing(tx, entity);
      const seen = new Map<string, number>();
      const createdTerr = new Map<string, { id: string; path: string }>();
      const takenPaths = new Set(lk.territoryPath.values());
      const jobId = uuidv7();
      const results: (ImportRowResult & { raw: Row })[] = [];

      for (const [i, raw] of req.rows.entries()) {
        const row = i + 1;
        const res = (o: Partial<ImportRowResult>) =>
          results.push({
            row,
            status: 'valid',
            errors: [],
            id: null,
            duplicateOf: null,
            duplicateRule: null,
            raw,
            ...o,
          });
        const m = mapImportRow(entity, raw, lk);
        if (!m.body) {
          res({ status: 'error', errors: m.errors });
          continue;
        }
        let body: Row = m.body;
        if (entity === 'territories') {
          // parent_code may refer to a row created earlier in this file
          const pc = body.parentCode as string | null;
          const parentId = pc ? (lk.territory(pc) ?? createdTerr.get(pc)?.id) : null;
          if (pc && !parentId) {
            res({
              status: 'error',
              errors: [
                {
                  column: 'parent_code',
                  code: 'unknown_code',
                  message: `Unknown or out-of-scope territory code '${pc}'`,
                },
              ],
            });
            continue;
          }
          if (!pc && body.level !== 'national') {
            res({
              status: 'error',
              errors: [
                {
                  column: 'parent_code',
                  code: 'required',
                  message: 'parent_code is required below national level',
                },
              ],
            });
            continue;
          }
          const parentPath = parentId
            ? (lk.territoryPath.get(parentId) ?? createdTerr.get(pc!)?.path)
            : null;
          const id = uuidv7();
          const c = body.centroid as { lat: number; lng: number } | null;
          body = {
            id,
            code: body.code,
            name: body.name,
            level: body.level,
            parentId,
            path: childPath(parentId, parentPath, String(body.code), id, takenPaths),
            centroid: c ? { x: c.lng, y: c.lat } : null,
          };
          takenPaths.add(String(body.path));
        }
        const keys = duplicateKeys(entity, body);
        const inFile = keys.find((k) => seen.has(`${k.rule}:${k.key}`));
        if (inFile) {
          res({
            status: 'error',
            duplicateRule: 'in_file',
            errors: [
              {
                column: null,
                code: 'duplicate_in_file',
                message: `Same ${inFile.rule} as row ${seen.get(`${inFile.rule}:${inFile.key}`)}`,
              },
            ],
          });
          continue;
        }
        for (const k of keys) seen.set(`${k.rule}:${k.key}`, row);
        const hitKey = keys.find((k) => idx.has(`${k.rule}:${k.key}`));
        if (hitKey) {
          const hit = idx.get(`${hitKey.rule}:${hitKey.key}`)!;
          const dup = {
            id: hit.id as string,
            duplicateOf: hit.id as string,
            duplicateRule: hitKey.rule,
          };
          if (req.onDuplicate === 'error') {
            res({
              status: 'error',
              ...dup,
              errors: [
                {
                  column: null,
                  code: 'duplicate',
                  message: `Matches existing record by ${hitKey.rule}`,
                },
              ],
            });
          } else if (req.onDuplicate === 'update' && entity !== 'territories') {
            if (req.dryRun) res({ status: 'valid', ...dup });
            else
              await this.saveRow(tx, res, async (t2) => {
                await this.masters.patch(t2, def, p, hit.id as string, body, 'import_update');
                return { status: 'updated', ...dup };
              });
          } else res({ status: req.dryRun ? 'duplicate' : 'skipped', ...dup });
          continue;
        }
        if (req.dryRun) {
          res({ status: 'valid' });
          if (entity === 'territories')
            createdTerr.set(String(body.code), { id: String(body.id), path: String(body.path) });
          continue;
        }
        await this.saveRow(tx, res, async (t2) => {
          if (entity === 'territories') {
            const [t] = await t2
              .insert(territories)
              .values({ ...(body as any), companyId: p.companyId })
              .returning({ id: territories.id });
            createdTerr.set(String(body.code), { id: t!.id, path: String(body.path) });
            return { status: 'created', id: t!.id };
          }
          const dto = await this.masters.insert(t2, def, p, body, 'import_create');
          return { status: 'created', id: dto.id as string };
        });
      }

      const count = (s: string) => results.filter((r) => r.status === s).length;
      const totals = {
        rows: results.length,
        valid: count('valid'),
        created: count('created'),
        updated: count('updated'),
        duplicate: count('duplicate'),
        skipped: count('skipped'),
        error: count('error'),
      };
      await tx.insert(importJobs).values({
        id: jobId,
        companyId: p.companyId,
        entity,
        dryRun: req.dryRun,
        status: req.dryRun ? 'validated' : 'completed',
        onDuplicate: req.onDuplicate,
        fileName: req.fileName ?? null,
        fileKey: req.fileKey ?? null,
        idempotencyKey: idemKey ?? null,
        totals,
        createdBy: p.userId,
        finishedAt: new Date(),
      });
      for (let i = 0; i < results.length; i += 500)
        await tx.insert(importRows).values(
          results.slice(i, i + 500).map((r) => ({
            id: uuidv7(),
            companyId: p.companyId,
            jobId,
            rowNo: r.row,
            status: r.status,
            raw: r.raw,
            errors: r.errors,
            entityId: r.id,
            duplicateOf: r.duplicateOf,
            duplicateRule: r.duplicateRule,
          })),
        );
      await this.audit.record(tx, p, req.dryRun ? 'import.dry_run' : 'import.apply', {
        entityType: 'import_job',
        entityId: jobId,
        after: { entity, totals, fileKey: req.fileKey ?? null },
      });
      return this.load(tx, jobId);
    });
  }

  /** One savepoint per row: a DB failure marks the row as error without losing the others. */
  private async saveRow(
    tx: Tx,
    res: (o: Partial<ImportRowResult>) => void,
    fn: (tx: Tx) => Promise<Partial<ImportRowResult>>,
  ) {
    try {
      res(await tx.transaction((t2) => fn(t2 as Tx)));
    } catch (e) {
      const msg = e instanceof HttpException ? e.message : 'Could not save row';
      res({ status: 'error', errors: [{ column: null, code: 'save_failed', message: msg }] });
    }
  }

  private async load(tx: Tx, id: string) {
    const [j] = await tx.select().from(importJobs).where(eq(importJobs.id, id));
    if (!j) throw new NotFoundException('Import job not found');
    const rows = await tx
      .select()
      .from(importRows)
      .where(eq(importRows.jobId, id))
      .orderBy(asc(importRows.rowNo));
    return ImportJob.parse({
      id: j.id,
      companyId: j.companyId,
      entity: j.entity,
      dryRun: j.dryRun,
      status: j.status,
      fileName: j.fileName,
      fileKey: j.fileKey,
      onDuplicate: j.onDuplicate,
      totals: j.totals,
      results: rows.map((r) => ({
        row: r.rowNo,
        status: r.status,
        errors: r.errors,
        id: r.entityId,
        duplicateOf: r.duplicateOf,
        duplicateRule: r.duplicateRule,
      })),
      createdBy: j.createdBy,
      createdAt: j.createdAt.toISOString(),
    });
  }

  get(p: Principal, id: string) {
    if (!Id.safeParse(id).success) throw new NotFoundException('Import job not found');
    return this.tenant.run(p, async (tx) => {
      const [j] = await tx
        .select({ by: importJobs.createdBy })
        .from(importJobs)
        .where(eq(importJobs.id, id));
      if (!j || (p.scopePaths !== null && j.by !== p.userId))
        throw new NotFoundException('Import job not found');
      return this.load(tx, id);
    });
  }
}
