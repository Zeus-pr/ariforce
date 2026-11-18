-- GENERATED from packages/db/drizzle/0077_hr_role_enum.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0077_hr_role_enum') THEN
    RAISE NOTICE 'skip 0077_hr_role_enum (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- HR sits outside the sales hierarchy. Postgres cannot use a new enum value in the transaction
-- that adds it, so the role rows are in 0078. Safe to re-run.
ALTER TYPE "public"."role_key" ADD VALUE IF NOT EXISTS 'hr';$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0077_hr_role_enum');
END
$ariforce_migration$;
COMMIT;
