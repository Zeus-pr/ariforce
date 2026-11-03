/**
 * Import SFC (Standard Fare Chart) sheets into sfc_routes. Dry-run by default.
 *
 *   pnpm -F @ariforce/api sfc:import --company arighna --file /path/to/sfc.xlsx          # dry run
 *   pnpm -F @ariforce/api sfc:import --company arighna --file /path/to/sfc.xlsx --apply  # write
 *
 * One sheet = one BM ("BM NAME : <name>", "HQ : <hq>", header row "SL. NO | FROM PLACE | ...").
 * The BM is fuzzy-matched by name AND HQ against sales-hierarchy employees; unmatched or ambiguous
 * sheets are reported and skipped. Rows are upserted by (employee, from, to, category), so re-runs
 * converge; routes not in the sheet are left alone (reported). Amounts are computed from the
 * company rate (companies.sfc_rate_per_km); "ACTUAL FARE" rows store null amounts.
 * Connects with DATABASE_URL (app role, RLS applies); prints names only, no other personal data.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { Client } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { sfcAmounts } from '@ariforce/contracts';
import {
  matchSheet,
  normCategory,
  parseSfcWorkbook,
  type SfcCandidate,
} from '../src/sfc/sfc-import';

const envFile = resolve(import.meta.dirname, '../.env');
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);

const { values: a } = parseArgs({
  options: {
    company: { type: 'string' },
    file: { type: 'string' },
    apply: { type: 'boolean', default: false },
  },
});
const fail = (m: string): never => {
  console.error(m);
  process.exit(1);
};
if (!a.company) fail('--company <slug> is required');
if (!a.file || !existsSync(a.file)) fail('--file <workbook.xlsx> is required and must exist');
if (!process.env.DATABASE_URL) fail('DATABASE_URL is not set');

const sheets = await parseSfcWorkbook(a.file!);
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
let exit = 0;
try {
  const cid = (
    await c.query<{ id: string | null }>('select company_id_by_slug($1) as id', [a.company])
  ).rows[0]?.id;
  if (!cid) fail(`company '${a.company}' not found`);
  await c.query('begin');
  await c.query(
    `select set_config('app.current_company_id', $1, true), set_config('app.current_user_id', '', true),
            set_config('app.request_id', $2, true)`,
    [cid, `import-sfc-${randomUUID()}`],
  );
  const rate = Number(
    (await c.query<{ r: string }>('select sfc_rate_per_km r from companies where id = $1', [cid]))
      .rows[0]!.r,
  );
  const cands: SfcCandidate[] = (
    await c.query<SfcCandidate>(`
      select u.id, u.name,
        coalesce(json_agg(json_build_object('id', t.id, 'name', t.name, 'code', t.code))
          filter (where t.id is not null), '[]') as hqs
      from users u
      left join user_territories ut on ut.user_id = u.id
      left join territories t on t.id = ut.territory_id and t.deleted_at is null and t.level = 'headquarter'
      where u.deleted_at is null and u.status not in ('rejected')
        and exists (select 1 from user_roles ur join roles r on r.id = ur.role_id
                    where ur.user_id = u.id and r.rank >= 1)
      group by u.id`)
  ).rows;
  console.log(`${a.apply ? 'APPLY' : 'DRY RUN'}: ${sheets.length} sheet(s), rate ${rate}/km`);
  const used = new Set<string>();
  for (const s of sheets) {
    const head = `- "${s.title}" (BM ${s.bmName || '?'}, HQ ${s.hqText || '?'})`;
    const m = matchSheet(s, cands);
    if (m.kind !== 'matched') {
      console.log(`${head}: SKIPPED ${m.kind}: ${m.reason}`);
      exit = 2;
      continue;
    }
    if (used.has(m.user.id)) {
      console.log(`${head}: SKIPPED: ${m.user.name} already matched by another sheet`);
      exit = 2;
      continue;
    }
    used.add(m.user.id);
    const existing = (
      await c.query<{
        id: string;
        k: string;
        one_way_km: string;
        actual_fare: boolean;
        travel_mode: string | null;
        sort_order: number;
        category: string | null;
      }>(
        `select id, lower(from_place) || '|' || lower(to_place) || '|' || coalesce(category, '') k,
           one_way_km, actual_fare, travel_mode, sort_order, category
         from sfc_routes where user_id = $1 and deleted_at is null`,
        [m.user.id],
      )
    ).rows;
    // Legacy rows ('EX', 'EX HQ', ...) key on their mapped category so a re-import before the
    // category data fix updates them instead of adding duplicates; unknown text keys as is.
    for (const r of existing) {
      const i = r.k.lastIndexOf('|');
      const raw = r.k.slice(i + 1);
      const m = normCategory(raw);
      r.k = r.k.slice(0, i + 1) + (m === undefined ? raw.toLowerCase() : (m ?? ''));
    }
    const byKey = new Map(existing.map((r) => [r.k, r]));
    let ins = 0;
    let upd = 0;
    let same = 0;
    const seen = new Set<string>();
    for (const [i, r] of s.rows.entries()) {
      const k = `${r.fromPlace.toLowerCase()}|${r.toPlace.toLowerCase()}|${r.category ?? ''}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const am = sfcAmounts(r.oneWayKm, r.actualFare, rate);
      const vals = [
        m.hqId,
        i + 1,
        r.fromPlace,
        r.toPlace,
        r.oneWayKm.toFixed(2),
        am.bothWayKm.toFixed(2),
        am.oneWayAmount?.toFixed(2) ?? null,
        am.bothWayAmount?.toFixed(2) ?? null,
        r.actualFare,
        r.travelMode,
        r.category,
      ];
      const old = byKey.get(k);
      if (!old) {
        ins++;
        if (a.apply)
          await c.query(
            `insert into sfc_routes (hq_territory_id, sort_order, from_place, to_place, one_way_km,
               both_way_km, one_way_amount, both_way_amount, actual_fare, travel_mode, category,
               id, company_id, user_id)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [...vals, uuidv7(), cid, m.user.id],
          );
      } else if (
        Number(old.one_way_km) !== r.oneWayKm ||
        old.actual_fare !== r.actualFare ||
        old.travel_mode !== r.travelMode ||
        old.sort_order !== i + 1 ||
        old.category !== r.category
      ) {
        upd++;
        if (a.apply)
          await c.query(
            `update sfc_routes set hq_territory_id=$1, sort_order=$2, from_place=$3, to_place=$4,
               one_way_km=$5, both_way_km=$6, one_way_amount=$7, both_way_amount=$8, actual_fare=$9,
               travel_mode=$10, category=$11 where id = $12`,
            [...vals, old.id],
          );
      } else same++;
    }
    const extra = existing.filter((r) => !seen.has(r.k)).length;
    if (a.apply && (ins || upd))
      await c.query(
        `insert into audit_log (company_id, action, entity_type, entity_id, after)
         values ($1, 'sfc.imported', 'user', $2, $3)`,
        [cid, m.user.id, JSON.stringify({ sheet: s.title, inserted: ins, updated: upd })],
      );
    console.log(
      `${head}: -> ${m.user.name} (name ${m.nameScore.toFixed(2)}, HQ ${m.hqScore.toFixed(2)}): ` +
        `${s.rows.length} row(s): ${ins} new, ${upd} changed, ${same} unchanged, ` +
        `${s.skippedEmpty} empty skipped, ${extra} existing not in sheet (kept)` +
        (s.problems.length ? `; problems: ${s.problems.join('; ')}` : ''),
    );
  }
  await c.query(a.apply ? 'commit' : 'rollback');
  console.log(a.apply ? 'committed' : 'dry run: nothing written (use --apply)');
} catch (e) {
  await c.query('rollback').catch(() => {});
  throw e;
} finally {
  await c.end();
}
process.exit(exit);
