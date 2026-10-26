-- GENERATED from packages/db/drizzle/0014_functional_roles_enum.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0014_functional_roles_enum') THEN
    RAISE NOTICE 'skip 0014_functional_roles_enum (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- Functional roles outside the sales hierarchy (rank 0). Enum values only: Postgres cannot use a new
-- enum value in the transaction that adds it, so role rows are in 0015. Safe to re-run.
ALTER TYPE "public"."role_key" ADD VALUE IF NOT EXISTS 'distribution_head';$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TYPE "public"."role_key" ADD VALUE IF NOT EXISTS 'accountant';$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0014_functional_roles_enum');
END
$ariforce_migration$;
COMMIT;
