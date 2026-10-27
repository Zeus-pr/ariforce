-- GENERATED from packages/db/drizzle/0035_doctor_duplicate_idx.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0035_doctor_duplicate_idx') THEN
    RAISE NOTICE 'skip 0035_doctor_duplicate_idx (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$CREATE INDEX IF NOT EXISTS "doctors_regno_idx" ON "doctors" USING btree ("company_id",upper("registration_no"));$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX IF NOT EXISTS "doctors_pincode_idx" ON "doctors" USING btree ("company_id","pincode");$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0035_doctor_duplicate_idx');
END
$ariforce_migration$;
COMMIT;
