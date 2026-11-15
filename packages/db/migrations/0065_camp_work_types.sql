-- GENERATED from packages/db/drizzle/0065_camp_work_types.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0065_camp_work_types') THEN
    RAISE NOTICE 'skip 0065_camp_work_types (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- Camp work types. Same bands and SFC as field work; no call-average day and no calls.
-- Inserts CAMP_HQ / CAMP_EXHQ / CAMP_OUT for every existing company.
-- Idempotent: ON CONFLICT (company_id, code) DO NOTHING. Keep in sync with CAMP_WORK_TYPES.
INSERT INTO work_types (id, company_id, code, name, kind, counts_as_field_day, allowance_band, requires_location)
SELECT gen_random_uuid(), c.id, d.code, d.name, d.kind::work_type_kind, d.field_day, d.band, d.loc
FROM companies c
CROSS JOIN (VALUES
  ('CAMP_HQ',   'Camp (HQ)',         'field', false, 'hq',         true),
  ('CAMP_EXHQ', 'Camp (ex-HQ)',      'field', false, 'ex_hq',      true),
  ('CAMP_OUT',  'Camp (outstation)', 'field', false, 'outstation', true)
) AS d(code, name, kind, field_day, band, loc)
WHERE c.deleted_at IS NULL
ON CONFLICT (company_id, code) DO NOTHING;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0065_camp_work_types');
END
$ariforce_migration$;
COMMIT;
