/**
 * Territory link import (docs/TERRITORY-MODEL.md "Next build item", docs/IMPORT.md): rows of
 * (HQ code, entity, name key, territory text) -> territory under that HQ (created when missing) and
 * doctors/chemists.local_territory_id. Pure planning only: the real API
 * (apps/api/src/masters/territory-links.ts) and the MSW mock load the context and run the same plan.
 */
import type {
  TerritoryLinkCreated,
  TerritoryLinkImportResult,
  TerritoryLinkReason,
  TerritoryLinkRowResult,
} from '../schemas/imports';

export type TerritoryLinkEntity = 'doctor' | 'chemist';

/** Same as SQL `ariforce_territory_key` (0042): lower case, non [a-z0-9] runs -> one space, trimmed; blank -> null. */
export function territoryKey(raw: unknown): string | null {
  const k = String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return k || null;
}

/**
 * Doctor/chemist name key (same as data-fixes/2026-10-28-durgapur-territory-text.sql): lower case,
 * leading "Dr."/"Dr " dropped, non [a-z0-9] runs -> one space, trimmed.
 */
export function masterNameKey(raw: unknown): string {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/^\s*dr(\.|\s)\s*/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Territory code `<HQ code>-<KEY>` (spaces -> '-'), 32 chars max (same as the backfill). */
export function territoryCodeFor(hqCode: string, key: string): string {
  return `${hqCode}-${key.toUpperCase().replace(/ /g, '-')}`.slice(0, 32);
}

/** Display name from the source text: whitespace collapsed, initcap (same as SQL initcap). */
export function territoryDisplayName(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/(^|[^a-z0-9])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase());
}

/** Near-duplicate rule of the backfill: same key without vowels/h/y/spaces, or same first 4 letters. */
export function nearDuplicateKeys(a: string, b: string): boolean {
  const strip = (s: string) => s.replace(/[aeiouhy ]/g, '');
  const head = (s: string) => s.replace(/ /g, '').slice(0, 4);
  return strip(a) === strip(b) || head(a) === head(b);
}

const headerKey = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIASES = {
  hqCode: ['hqcode', 'hq', 'hqterritorycode'],
  entity: ['entity', 'kind'],
  nameKey: ['namekey', 'name'],
  territoryText: ['territorytext', 'territory', 'territoryname'],
} as const;

export interface TerritoryLinkRow {
  hqCode: string;
  entity: string;
  nameKey: string;
  territoryText: string;
}

/** Row object (snake_case, camelCase or sheet headers) -> the four fields, trimmed. */
export function readTerritoryLinkRow(raw: Record<string, unknown>): TerritoryLinkRow {
  const byKey = new Map<string, unknown>();
  for (const [k, v] of Object.entries(raw))
    if (!byKey.has(headerKey(k))) byKey.set(headerKey(k), v);
  const get = (names: readonly string[]) => {
    for (const n of names) if (byKey.has(n)) return String(byKey.get(n) ?? '').trim();
    return '';
  };
  return {
    hqCode: get(ALIASES.hqCode),
    entity: get(ALIASES.entity).toLowerCase(),
    nameKey: get(ALIASES.nameKey),
    territoryText: get(ALIASES.territoryText),
  };
}

export interface TerritoryLinkHq {
  id: string;
  code: string;
  level: string;
}
export interface TerritoryLinkExisting {
  id: string;
  parentId: string;
  key: string;
  code: string;
  name: string;
}
export interface TerritoryLinkMaster {
  entity: TerritoryLinkEntity;
  id: string;
  hqId: string;
  name: string;
  localTerritoryId: string | null;
}
export interface TerritoryLinkContext {
  /** Live territory by upper-case code (any level), within the caller's scope. */
  territoryByCode(codeUpper: string): TerritoryLinkHq | undefined;
  /** Which levels count as an HQ (API: headquarter only). */
  isHq?(level: string): boolean;
  /** Live level-'territory' rows under the HQs (key = territory_key or key of the name). */
  territories: TerritoryLinkExisting[];
  /** Live doctors/chemists of the HQs in the file. */
  masters: TerritoryLinkMaster[];
  /** Every territory code in the company (deleted too), upper case. Mutated as codes are planned. */
  takenCodes: Set<string>;
  newId(): string;
}

export interface TerritoryLinkPlanCreate extends Omit<TerritoryLinkCreated, 'id'> {
  id: string;
  hqLevel: string;
}
export interface TerritoryLinkPlan {
  results: TerritoryLinkRowResult[];
  create: TerritoryLinkPlanCreate[];
  /** Row index (0-based) -> link to write. */
  links: { index: number; entity: TerritoryLinkEntity; id: string; territoryId: string }[];
  nearDuplicates: TerritoryLinkImportResult['nearDuplicates'];
}

const UNMATCHED = new Set<TerritoryLinkReason>([
  'unknown_hq',
  'not_headquarter',
  'no_match',
  'ambiguous',
]);

/** Plan a territory link import. Never merges near duplicates; never links by name alone across HQs. */
export function planTerritoryLinks(
  rawRows: Record<string, unknown>[],
  ctx: TerritoryLinkContext,
  onLinked: 'keep' | 'replace' = 'keep',
): TerritoryLinkPlan {
  const isHq = ctx.isHq ?? ((l: string) => l === 'headquarter');
  const rows = rawRows.map(readTerritoryLinkRow);
  const keys = rows.map((r) => ({
    hq: r.hqCode.toUpperCase(),
    name: masterNameKey(r.nameKey),
    terr: territoryKey(r.territoryText),
  }));

  // Same HQ + entity + name with different territory texts: every such row is an error.
  const terrsByName = new Map<string, Set<string>>();
  rows.forEach((r, i) => {
    const k = keys[i]!;
    if (!k.terr || !k.name || !k.hq) return;
    const id = `${k.hq}|${r.entity}|${k.name}`;
    const s = terrsByName.get(id) ?? new Set<string>();
    s.add(k.terr);
    terrsByName.set(id, s);
  });

  const masterIdx = new Map<string, TerritoryLinkMaster[]>();
  for (const m of ctx.masters) {
    const k = `${m.entity}|${m.hqId}|${masterNameKey(m.name)}`;
    masterIdx.set(k, [...(masterIdx.get(k) ?? []), m]);
  }
  const existing = new Map(ctx.territories.map((t) => [`${t.parentId}|${t.key}`, t]));
  const planned = new Map<string, TerritoryLinkPlanCreate & { spellings: Map<string, number> }>();
  const seen = new Map<string, number>();
  const linkedMaster = new Map<string, number>();
  const touchedHqs = new Map<string, string>();
  const results: TerritoryLinkRowResult[] = [];
  const links: TerritoryLinkPlan['links'] = [];

  rows.forEach((r, i) => {
    const k = keys[i]!;
    const out: TerritoryLinkRowResult = {
      row: i + 1,
      status: 'error',
      reason: null,
      message: null,
      entity: r.entity === 'doctor' || r.entity === 'chemist' ? r.entity : null,
      hqCode: r.hqCode || null,
      territoryKey: k.terr,
      entityId: null,
      territoryId: null,
      territoryCode: null,
      territoryCreated: false,
      previousTerritoryId: null,
      candidateIds: [],
    };
    const done = (
      reason: TerritoryLinkReason | null,
      status: TerritoryLinkRowResult['status'],
      message: string | null = null,
    ) => {
      out.reason = reason;
      out.status = status;
      out.message = message;
      results.push(out);
    };
    if (!r.hqCode) return done('blank_hq', 'error', 'hq_code is required');
    if (!out.entity)
      return done('invalid_entity', 'error', `entity must be doctor or chemist, got '${r.entity}'`);
    if (!k.name) return done('blank_name', 'error', 'name_key is required');
    const hq = ctx.territoryByCode(k.hq);
    if (!hq)
      return done('unknown_hq', 'unmatched', `Unknown or out-of-scope HQ code '${r.hqCode}'`);
    out.hqCode = hq.code;
    if (!isHq(hq.level))
      return done(
        'not_headquarter',
        'unmatched',
        `'${hq.code}' is a ${hq.level}, not a headquarter`,
      );
    if (!k.terr)
      return done('blank_territory', 'skipped', 'territory_text is blank (left unlinked)');
    const group = terrsByName.get(`${k.hq}|${r.entity}|${k.name}`);
    if (group && group.size > 1)
      return done(
        'conflict_in_file',
        'error',
        `Same HQ, entity and name with different territories: ${[...group].sort().join(', ')}`,
      );
    const dupKey = `${k.hq}|${r.entity}|${k.name}|${k.terr}`;
    const first = seen.get(dupKey);
    if (first) return done('duplicate_in_file', 'skipped', `Same as row ${first}`);
    seen.set(dupKey, i + 1);

    const cands = masterIdx.get(`${out.entity}|${hq.id}|${k.name}`) ?? [];
    if (cands.length === 0)
      return done(
        'no_match',
        'unmatched',
        `No ${out.entity} named '${r.nameKey}' under ${hq.code}`,
      );
    if (cands.length > 1) {
      out.candidateIds = cands.map((c) => c.id).sort();
      return done(
        'ambiguous',
        'unmatched',
        `${cands.length} ${out.entity}s named '${r.nameKey}' under ${hq.code}`,
      );
    }
    const m = cands[0]!;
    out.entityId = m.id;
    const prevRow = linkedMaster.get(m.id);
    if (prevRow) return done('duplicate_in_file', 'skipped', `Same record as row ${prevRow}`);
    linkedMaster.set(m.id, i + 1);
    touchedHqs.set(hq.id, hq.code);

    const ex = existing.get(`${hq.id}|${k.terr}`);
    const pl = planned.get(`${hq.id}|${k.terr}`);
    const targetId = ex?.id ?? pl?.id ?? null;
    if (targetId && m.localTerritoryId === targetId) {
      out.territoryId = targetId;
      out.territoryCode = ex?.code ?? pl!.code;
      return done(null, 'already_linked');
    }
    if (m.localTerritoryId && onLinked === 'keep') {
      out.previousTerritoryId = m.localTerritoryId;
      return done(
        'linked_elsewhere',
        'skipped',
        'Already linked to another territory (onLinked: keep)',
      );
    }
    out.previousTerritoryId = m.localTerritoryId;
    if (ex) {
      out.territoryId = ex.id;
      out.territoryCode = ex.code;
    } else {
      let p = pl;
      if (!p) {
        const id = ctx.newId();
        let code = territoryCodeFor(hq.code, k.terr);
        if (ctx.takenCodes.has(code.toUpperCase()))
          code = `${code.slice(0, 23)}-${id.replace(/-/g, '').slice(-8)}`;
        ctx.takenCodes.add(code.toUpperCase());
        p = {
          id,
          hqId: hq.id,
          hqCode: hq.code,
          hqLevel: hq.level,
          code,
          name: '',
          territoryKey: k.terr,
          rows: 0,
          spellings: new Map(),
        };
        planned.set(`${hq.id}|${k.terr}`, p);
      }
      const sp = territoryDisplayName(r.territoryText);
      p.spellings.set(sp, (p.spellings.get(sp) ?? 0) + 1);
      p.rows += 1;
      out.territoryId = p.id;
      out.territoryCode = p.code;
      out.territoryCreated = true;
    }
    links.push({ index: i, entity: out.entity, id: m.id, territoryId: out.territoryId! });
    done(null, 'linked');
  });

  const create = [...planned.values()].map(({ spellings, ...c }) => {
    let best = '';
    let n = 0;
    for (const [s, c2] of spellings) if (c2 > n) [best, n] = [s, c2];
    return { ...c, name: best.slice(0, 120) };
  });

  const nearDuplicates: TerritoryLinkPlan['nearDuplicates'] = [];
  for (const [hqId, hqCode] of touchedHqs) {
    const ks = [
      ...new Set([
        ...ctx.territories.filter((t) => t.parentId === hqId).map((t) => t.key),
        ...create.filter((c) => c.hqId === hqId).map((c) => c.territoryKey),
      ]),
    ].sort();
    for (let a = 0; a < ks.length; a++)
      for (let b = a + 1; b < ks.length; b++)
        if (nearDuplicateKeys(ks[a]!, ks[b]!))
          nearDuplicates.push({ hqCode, a: ks[a]!, b: ks[b]! });
  }
  return { results, create, links, nearDuplicates };
}

/** Plan (after any write outcome is applied to `results`) -> the response body. */
export function territoryLinkResult(
  plan: TerritoryLinkPlan,
  o: {
    dryRun: boolean;
    fileName?: string | null;
    fileKey?: string | null;
    onLinked: 'keep' | 'replace';
  },
): TerritoryLinkImportResult {
  const rs = plan.results;
  const n = (f: (r: TerritoryLinkRowResult) => boolean) => rs.filter(f).length;
  const createdIds = new Set(plan.create.map((c) => c.id));
  const linkedTo = new Map<string, number>();
  for (const r of rs)
    if (r.status === 'linked' && r.territoryId && createdIds.has(r.territoryId))
      linkedTo.set(r.territoryId, (linkedTo.get(r.territoryId) ?? 0) + 1);
  const created = plan.create.filter((c) => linkedTo.has(c.id));
  const results = rs.map((r) => (o.dryRun && r.territoryCreated ? { ...r, territoryId: null } : r));
  return {
    dryRun: o.dryRun,
    fileName: o.fileName ?? null,
    fileKey: o.fileKey ?? null,
    onLinked: o.onLinked,
    totals: {
      rows: rs.length,
      linked: n((r) => r.status === 'linked'),
      alreadyLinked: n((r) => r.status === 'already_linked'),
      skipped: n((r) => r.status === 'skipped'),
      unmatched: n((r) => r.status === 'unmatched'),
      error: n((r) => r.status === 'error'),
      territoriesCreated: created.length,
      doctorsLinked: n((r) => r.status === 'linked' && r.entity === 'doctor'),
      chemistsLinked: n((r) => r.status === 'linked' && r.entity === 'chemist'),
      unknownHq: n((r) => r.reason === 'unknown_hq' || r.reason === 'not_headquarter'),
      noMatch: n((r) => r.reason === 'no_match'),
      ambiguous: n((r) => r.reason === 'ambiguous'),
    },
    territoriesCreated: created.map((c) => ({
      id: o.dryRun ? null : c.id,
      hqId: c.hqId,
      hqCode: c.hqCode,
      code: c.code,
      name: c.name,
      territoryKey: c.territoryKey,
      rows: linkedTo.get(c.id) ?? 0,
    })),
    nearDuplicates: plan.nearDuplicates,
    results,
  };
}

export const TERRITORY_LINK_UNMATCHED_REASONS = UNMATCHED;
