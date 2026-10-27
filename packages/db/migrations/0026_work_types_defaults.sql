-- GENERATED from packages/db/drizzle/0026_work_types_defaults.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0026_work_types_defaults') THEN
    RAISE NOTICE 'skip 0026_work_types_defaults (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- Default work types (fix: empty work_types broke the DCR and Tour Plan dropdowns).
-- Inserts the 8 standard codes for EVERY existing company. Idempotent: ON CONFLICT on the unique key
-- work_types_company_code_uq (company_id, code) DO NOTHING, so rows a company already has (e.g. the
-- 8 rows hand-inserted for 'arighna') and any edited labels/flags are left untouched.
-- Keep in sync with DEFAULT_WORK_TYPES in packages/db/src/work-types.ts (test: work-types.test.ts).
INSERT INTO work_types (id, company_id, code, name, kind, counts_as_field_day, allowance_band, requires_location)
SELECT gen_random_uuid(), c.id, d.code, d.name, d.kind::work_type_kind, d.field_day, d.band, d.loc
FROM companies c
CROSS JOIN (VALUES
  ('FIELD_HQ',   'Field work (HQ)',         'field',     true,  'hq',         true),
  ('FIELD_EXHQ', 'Field work (ex-HQ)',      'field',     true,  'ex_hq',      true),
  ('FIELD_OUT',  'Field work (outstation)', 'field',     true,  'outstation', true),
  ('MEETING',    'Meeting',                 'non_field', false, 'none',       false),
  ('TRAINING',   'Training',                'non_field', false, 'none',       false),
  ('OFFICE',     'Office work',             'non_field', false, 'none',       false),
  ('LEAVE',      'Leave',                   'leave',     false, 'none',       false),
  ('HOLIDAY',    'Holiday',                 'holiday',   false, 'none',       false)
) AS d(code, name, kind, field_day, band, loc)
WHERE c.deleted_at IS NULL
ON CONFLICT (company_id, code) DO NOTHING;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$-- Startup/health check helper for the app role (RLS hides other companies): companies with no active
-- work types. Returns id + slug only. SECURITY DEFINER, fixed search_path, like company_id_by_slug.
CREATE OR REPLACE FUNCTION companies_without_work_types()
RETURNS TABLE (company_id uuid, slug text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.id, c.slug FROM companies c
  WHERE c.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM work_types w
                    WHERE w.company_id = c.id AND w.deleted_at IS NULL AND w.active)
  ORDER BY c.slug
$$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$REVOKE ALL ON FUNCTION companies_without_work_types() FROM PUBLIC;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT EXECUTE ON FUNCTION companies_without_work_types() TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION companies_without_work_types() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION companies_without_work_types() FROM authenticated;
  END IF;
END $$;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0026_work_types_defaults');
END
$ariforce_migration$;
COMMIT;
