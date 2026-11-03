/**
 * Territory link import from a CSV (docs/TERRITORY-MODEL.md). Dry run by default.
 *
 *   tsx scripts/import-territory-links.mts --company <slug> --file /path/outside/repo/x.csv          # dry run
 *   tsx scripts/import-territory-links.mts --company <slug> --file /path/outside/repo/x.csv --apply  # write
 *
 * CSV header: hq_code,entity,name_key,territory_text (entity = doctor|chemist). Same code path as
 * POST /v1/imports/territory-links: resolves the HQ by code, creates a missing territory under it
 * (code <HQ>-<KEY>, idempotent on company + HQ + territory_key), links doctors/chemists by name
 * (local_territory_id). Unknown HQ / no match / ambiguous rows are reported, never guessed.
 * --replace overwrites an existing different link (default keeps it). --json <file> writes the full
 * result. Connects with DATABASE_URL (app role, RLS applies). Exit 2 when any row is unmatched/error.
 * --read-only: dry run inside ONE transaction that starts with SET TRANSACTION READ ONLY, checks
 * transaction_read_only = on (aborts otherwise) and always rolls back. Use it against a shared or
 * production DB: unlike PGOPTIONS, it also holds through the Supabase transaction pooler. Cannot be
 * combined with --apply or --replace.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import type { TerritoryLinkImportResult } from '@ariforce/contracts';
import { auditLog, createDb, createPool, type Tx } from '@ariforce/db';
import { sql } from 'drizzle-orm';
import { runTerritoryLinks } from '../src/masters/territory-links';

const { values: a } = parseArgs({
  options: {
    company: { type: 'string' },
    file: { type: 'string' },
    apply: { type: 'boolean', default: false },
    replace: { type: 'boolean', default: false },
    'read-only': { type: 'boolean', default: false },
    json: { type: 'string' },
  },
});
const fail = (m: string): never => {
  console.error(m);
  process.exit(1);
};
if (!a.company) fail('--company <slug> is required');
if (!a.file || !existsSync(a.file)) fail('--file <rows.csv> is required and must exist');
if (!process.env.DATABASE_URL) fail('DATABASE_URL is not set');
const readOnly = a['read-only'] === true;
if (readOnly && (a.apply || a.replace))
  fail('--read-only cannot be combined with --apply or --replace');

/** Minimal RFC 4180 CSV (quotes, "" escapes, CRLF). First row = header. */
function parseCsv(text: string): Record<string, string>[] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  const s = text.replace(/^\uFEFF/, '');
  const endCell = () => {
    row.push(cell);
    cell = '';
  };
  const endRow = () => {
    endCell();
    out.push(row);
    row = [];
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (q) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') endCell();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      endRow();
    } else cell += c;
  }
  if (cell || row.length) endRow();
  const [head, ...body] = out.filter((r) => r.some((x) => x.trim()));
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ''])));
}

const rows = parseCsv(readFileSync(a.file!, 'utf8'));
if (!rows.length) fail('CSV has no data rows');
if (rows.length > 5000) fail('More than 5,000 rows: split the file');

const pool = createPool(process.env.DATABASE_URL!, { max: 1 });
const db = createDb(pool);
let exit = 0;
const ROLLBACK = new Error('read-only rollback');
try {
  const requestId = `import-territory-links-${randomUUID()}`;
  const work = async (tx: Tx) => {
    const cid = (
      (await tx.execute(sql`select company_id_by_slug(${a.company}) as id`)).rows[0] as
        { id: string | null } | undefined
    )?.id;
    if (!cid) fail(`company '${a.company}' not found`);
    await tx.execute(
      sql`select set_config('app.current_company_id', ${cid!}, true),
                 set_config('app.current_user_id', '', true),
                 set_config('app.request_id', ${requestId}, true)`,
    );
    return runTerritoryLinks(
      tx,
      {
        dryRun: readOnly || !a.apply,
        onLinked: a.replace ? 'replace' : 'keep',
        rows,
        fileName: a.file!.split('/').at(-1) ?? null,
      },
      cid!,
      async (action, e) => {
        if (readOnly) throw new Error(`write attempted in --read-only mode (${action})`);
        await tx.insert(auditLog).values({
          companyId: cid!,
          actorUserId: null,
          action,
          entityType: e.entityType,
          entityId: e.entityId,
          before: e.before ?? null,
          after: e.after ?? null,
          requestId,
        });
      },
    );
  };
  let res!: TerritoryLinkImportResult;
  if (readOnly) {
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`set transaction read only`);
        const ro = (await tx.execute(sql`show transaction_read_only`)).rows[0] as
          { transaction_read_only?: string } | undefined;
        if (ro?.transaction_read_only !== 'on')
          throw new Error('ABORT: transaction_read_only is not on');
        console.log('read-only guard: transaction_read_only = on (will roll back)');
        res = await work(tx);
        throw ROLLBACK;
      });
    } catch (e) {
      if (e !== ROLLBACK) throw e;
    }
  } else res = await db.transaction((tx) => work(tx));
  const t = res.totals;
  console.log(
    `${readOnly ? 'READ-ONLY DRY RUN (rolled back)' : a.apply ? 'APPLIED' : 'DRY RUN (nothing written; use --apply)'}: ${t.rows} row(s)`,
  );
  console.log(
    `  territories created: ${t.territoriesCreated}; linked: ${t.linked} (doctors ${t.doctorsLinked}, chemists ${t.chemistsLinked}); already linked: ${t.alreadyLinked}`,
  );
  console.log(
    `  skipped: ${t.skipped}; unmatched: ${t.unmatched} (unknown HQ ${t.unknownHq}, no match ${t.noMatch}, ambiguous ${t.ambiguous}); errors: ${t.error}`,
  );
  for (const c of res.territoriesCreated)
    console.log(`  + ${c.hqCode} / ${c.code} "${c.name}" (${c.rows} row(s))`);
  for (const n of res.nearDuplicates)
    console.log(`  ? near duplicate under ${n.hqCode}: "${n.a}" vs "${n.b}" (not merged)`);
  for (const r of res.results)
    if (r.status === 'unmatched' || r.status === 'error' || r.status === 'skipped')
      console.log(`  row ${r.row}: ${r.status} ${r.reason}${r.message ? `: ${r.message}` : ''}`);
  if (a.json) writeFileSync(a.json, JSON.stringify(res, null, 2));
  if (t.unmatched || t.error) exit = 2;
} finally {
  await pool.end();
}
process.exit(exit);
