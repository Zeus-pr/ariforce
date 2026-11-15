-- GENERATED from packages/db/drizzle/0062_doctor_email.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0062_doctor_email') THEN
    RAISE NOTICE 'skip 0062_doctor_email (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- Doctor email. date_of_birth and anniversary already exist (0001). Nullable, additive.
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS email text;
CREATE INDEX IF NOT EXISTS doctors_email_idx ON doctors (company_id, lower(email));$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0062_doctor_email');
END
$ariforce_migration$;
COMMIT;
