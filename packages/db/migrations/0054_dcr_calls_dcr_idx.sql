-- GENERATED from packages/db/drizzle/0054_dcr_calls_dcr_idx.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0054_dcr_calls_dcr_idx') THEN
    RAISE NOTICE 'skip 0054_dcr_calls_dcr_idx (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- dcr_calls lookups by parent DCR (toDto, call replace on save, DCR delete) had no index and
-- seq-scanned the company's calls. Additive; re-runnable.
-- Plain CREATE INDEX (not CONCURRENTLY): every migration runs inside a transaction
-- (scripts/sql-files.ts), where CONCURRENTLY is not allowed, same as all earlier index migrations.
-- It holds a SHARE lock on dcr_calls (blocks writes, not reads) for the build; apply off-peak.
CREATE INDEX IF NOT EXISTS dcr_calls_dcr_idx ON dcr_calls USING btree (company_id, dcr_id);$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0054_dcr_calls_dcr_idx');
END
$ariforce_migration$;
COMMIT;
