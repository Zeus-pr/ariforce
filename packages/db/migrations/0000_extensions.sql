-- GENERATED from packages/db/drizzle/0000_extensions.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0000_extensions') THEN
    RAISE NOTICE 'skip 0000_extensions (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- Extensions live in schema `extensions` (Supabase convention; PostGIS + pgcrypto are pre-enabled there).
-- Idempotent: a no-op on Supabase, creates them locally/CI.
CREATE SCHEMA IF NOT EXISTS extensions;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0000_extensions');
END
$ariforce_migration$;
COMMIT;
