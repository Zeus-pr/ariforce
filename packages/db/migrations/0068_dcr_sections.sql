-- GENERATED from packages/db/drizzle/0068_dcr_sections.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0068_dcr_sections') THEN
    RAISE NOTICE 'skip 0068_dcr_sections (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- One DCR day holds more than one section. Header columns stay section 0.
ALTER TABLE dcrs ADD COLUMN IF NOT EXISTS sections jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE dcr_calls ADD COLUMN IF NOT EXISTS section_index integer NOT NULL DEFAULT 0;
ALTER TABLE dcr_sfc_routes ADD COLUMN IF NOT EXISTS section_index integer NOT NULL DEFAULT 0;
DROP INDEX IF EXISTS dcr_sfc_routes_dcr_hq_uq;
CREATE UNIQUE INDEX IF NOT EXISTS dcr_sfc_routes_dcr_section_hq_uq
  ON dcr_sfc_routes (company_id, dcr_id, section_index, hq_territory_id)
  WHERE deleted_at IS NULL;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0068_dcr_sections');
END
$ariforce_migration$;
COMMIT;
