/**
 * Exports drizzle/NNNN_*.sql into packages/db/migrations/NNNN_*.sql: plain, ordered, idempotent
 * SQL files that can be applied by hand (Supabase SQL editor / connector) or by `db:migrate`.
 * Each file runs once: guarded by public.ariforce_migrations, wrapped in a transaction.
 * `--check` fails if migrations/ is out of date (CI).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const here = import.meta.dirname;
const src = resolve(here, '../drizzle');
const out = resolve(here, '../migrations');
const check = process.argv.includes('--check');
const TAG = '$ariforce_stmt$';

let stale = false;
mkdirSync(out, { recursive: true });
const files = readdirSync(src)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort();
for (const f of files) {
  const name = f.replace(/\.sql$/, '');
  const body = readFileSync(resolve(src, f), 'utf8');
  if (body.includes(TAG)) throw new Error(`${f} contains ${TAG}`);
  const stmts = body
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.replace(/--.*$/gm, '').trim().length > 0);
  const sql = `-- GENERATED from packages/db/drizzle/${f} by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '${name}') THEN
    RAISE NOTICE 'skip ${name} (already applied)';
    RETURN;
  END IF;
${stmts.map((s) => `  EXECUTE ${TAG}${s}${TAG};`).join('\n')}
  INSERT INTO public.ariforce_migrations (name) VALUES ('${name}');
END
$ariforce_migration$;
COMMIT;
`;
  const p = resolve(out, f);
  const cur = existsSync(p) ? readFileSync(p, 'utf8') : '';
  if (cur === sql) continue;
  if (check) {
    console.error(`STALE: ${p}. Run: pnpm -F @ariforce/db db:sql`);
    stale = true;
  } else {
    writeFileSync(p, sql);
    console.log(`wrote ${p}`);
  }
}
if (stale) process.exit(1);
