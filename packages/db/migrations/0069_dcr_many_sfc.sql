-- GENERATED from packages/db/drizzle/0069_dcr_many_sfc.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0069_dcr_many_sfc') THEN
    RAISE NOTICE 'skip 0069_dcr_many_sfc (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- A section can keep more than one SFC route, including two routes from the same HQ.
DROP INDEX IF EXISTS dcr_sfc_routes_dcr_section_hq_uq;
CREATE UNIQUE INDEX IF NOT EXISTS dcr_sfc_routes_dcr_section_route_uq
  ON dcr_sfc_routes (company_id, dcr_id, section_index, sfc_route_id)
  WHERE deleted_at IS NULL;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0069_dcr_many_sfc');
END
$ariforce_migration$;
COMMIT;
