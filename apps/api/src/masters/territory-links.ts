/**
 * Territory link import, DB side (docs/TERRITORY-MODEL.md, docs/IMPORT.md). Loads the context for the
 * shared planner (`planTerritoryLinks`, @ariforce/contracts), then (apply only) creates missing
 * territories under each HQ and sets doctors/chemists.local_territory_id. Used by
 * POST /v1/imports/territory-links and scripts/import-territory-links.mts. Runs inside a tenant
 * transaction (RLS = company); the caller is company-wide.
 */
import {
  planTerritoryLinks,
  territoryLinkResult,
  type TerritoryLinkImportRequest,
  type TerritoryLinkImportResult,
  type TerritoryLinkMaster,
} from '@ariforce/contracts';
import { chemists, doctors, territories, type Tx } from '@ariforce/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { childPath } from './territory-path';

export type TerritoryLinkAudit = (
  action: string,
  e: { entityType: string; entityId: string | null; before?: unknown; after?: unknown },
) => Promise<void>;

export async function runTerritoryLinks(
  tx: Tx,
  req: Pick<TerritoryLinkImportRequest, 'dryRun' | 'onLinked' | 'rows'> & {
    fileName?: string | null;
    fileKey?: string | null;
  },
  companyId: string,
  audit: TerritoryLinkAudit,
): Promise<TerritoryLinkImportResult> {
  const all = await tx
    .select({
      id: territories.id,
      code: territories.code,
      level: territories.level,
      path: territories.path,
      parentId: territories.parentId,
      name: territories.name,
      deletedAt: territories.deletedAt,
      key: sql<
        string | null
      >`coalesce(${territories.territoryKey}, ariforce_territory_key(${territories.name}))`,
    })
    .from(territories);
  const live = all.filter((t) => !t.deletedAt);
  const byCode = new Map(live.map((t) => [t.code.toUpperCase(), t]));
  const pathOf = new Map(live.map((t) => [t.id, t.path]));
  const takenPaths = new Set(all.map((t) => t.path));

  const hqIds = [
    ...new Set(
      req.rows
        .map((r) => {
          const v = Object.entries(r).find(([k]) =>
            ['hqcode', 'hq', 'hqterritorycode'].includes(k.toLowerCase().replace(/[^a-z0-9]/g, '')),
          )?.[1];
          return byCode.get(
            String(v ?? '')
              .trim()
              .toUpperCase(),
          );
        })
        .filter((t) => t && t.level === 'headquarter')
        .map((t) => t!.id),
    ),
  ];
  const masters: TerritoryLinkMaster[] = [];
  if (hqIds.length) {
    for (const [entity, t] of [
      ['doctor', doctors],
      ['chemist', chemists],
    ] as const) {
      const rows = await tx
        .select({
          id: t.id,
          hqId: t.territoryId,
          name: t.name,
          localTerritoryId: t.localTerritoryId,
        })
        .from(t)
        .where(and(isNull(t.deletedAt), inArray(t.territoryId, hqIds)));
      for (const r of rows) masters.push({ entity, ...r });
    }
  }

  const plan = planTerritoryLinks(
    req.rows,
    {
      territoryByCode: (c) => byCode.get(c),
      territories: live
        .filter((t) => t.level === 'territory' && t.parentId && t.key)
        .map((t) => ({ id: t.id, parentId: t.parentId!, key: t.key!, code: t.code, name: t.name })),
      masters,
      takenCodes: new Set(all.map((t) => t.code.toUpperCase())),
      newId: uuidv7,
    },
    req.onLinked,
  );
  const opts = {
    dryRun: req.dryRun,
    fileName: req.fileName,
    fileKey: req.fileKey,
    onLinked: req.onLinked,
  };
  if (req.dryRun) return territoryLinkResult(plan, opts);

  // 1. Territories. ON CONFLICT DO NOTHING covers a concurrent run creating the same HQ + key; that
  //    row is then reused (ids remapped in the plan).
  const remap = new Map<string, string>();
  for (const c of plan.create) {
    const path = childPath(c.hqId, pathOf.get(c.hqId), c.code, c.id, takenPaths);
    takenPaths.add(path);
    const ins = await tx
      .insert(territories)
      .values({
        id: c.id,
        companyId,
        parentId: c.hqId,
        level: 'territory',
        code: c.code,
        name: c.name,
        path,
        territoryKey: c.territoryKey,
      })
      .onConflictDoNothing()
      .returning({ id: territories.id });
    if (ins.length) {
      await audit('territory.import_create', {
        entityType: 'territory',
        entityId: c.id,
        after: { code: c.code, name: c.name, parentId: c.hqId, territoryKey: c.territoryKey },
      });
      continue;
    }
    const [got] = await tx
      .select({ id: territories.id })
      .from(territories)
      .where(
        and(
          eq(territories.parentId, c.hqId),
          eq(territories.territoryKey, c.territoryKey),
          isNull(territories.deletedAt),
        ),
      );
    if (!got) throw new Error(`territory code '${c.code}' is taken`);
    remap.set(c.id, got.id);
  }
  if (remap.size) {
    plan.create = plan.create.filter((c) => !remap.has(c.id));
    for (const l of plan.links) l.territoryId = remap.get(l.territoryId) ?? l.territoryId;
    for (const r of plan.results)
      if (r.territoryId && remap.has(r.territoryId)) {
        r.territoryId = remap.get(r.territoryId)!;
        r.territoryCreated = false;
      }
  }

  // 2. Links, grouped per entity + territory. Rows changed since the plan was made are not touched
  //    (keep: only still-unlinked or same-target rows) and reported as skipped.
  const groups = new Map<string, typeof plan.links>();
  for (const l of plan.links) {
    const k = `${l.entity}|${l.territoryId}`;
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  const done = new Set<string>();
  for (const g of groups.values()) {
    const t = g[0]!.entity === 'doctor' ? doctors : chemists;
    const upd = await tx
      .update(t)
      .set({ localTerritoryId: g[0]!.territoryId })
      .where(
        and(
          inArray(
            t.id,
            g.map((l) => l.id),
          ),
          isNull(t.deletedAt),
          req.onLinked === 'replace' ? undefined : isNull(t.localTerritoryId),
        ),
      )
      .returning({ id: t.id });
    for (const u of upd) done.add(u.id);
  }
  const linked: Record<string, string[]> = { doctor: [], chemist: [] };
  const replaced: { id: string; from: string }[] = [];
  for (const l of plan.links) {
    const r = plan.results[l.index]!;
    if (done.has(l.id)) {
      linked[l.entity]!.push(l.id);
      if (r.previousTerritoryId) replaced.push({ id: l.id, from: r.previousTerritoryId });
    } else {
      r.status = 'skipped';
      r.reason = 'linked_elsewhere';
      r.message = 'Changed while importing; not touched';
    }
  }
  const result = territoryLinkResult(plan, opts);
  if (result.totals.linked || result.totals.territoriesCreated)
    await audit('territory_links.apply', {
      entityType: 'territory_link_import',
      entityId: null,
      // Rollback marker: the ids linked by this run (and what a replace overwrote).
      after: {
        totals: result.totals,
        fileName: req.fileName ?? null,
        fileKey: req.fileKey ?? null,
        territoriesCreated: result.territoriesCreated.map((c) => c.id),
        linked,
        replaced,
      },
    });
  return result;
}
