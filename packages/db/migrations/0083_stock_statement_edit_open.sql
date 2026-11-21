-- GENERATED from packages/db/drizzle/0083_stock_statement_edit_open.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0083_stock_statement_edit_open') THEN
    RAISE NOTICE 'skip 0083_stock_statement_edit_open (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$ALTER TABLE "stock_statements" ADD COLUMN IF NOT EXISTS "edit_open" boolean DEFAULT false NOT NULL;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0083_stock_statement_edit_open');
END
$ariforce_migration$;
COMMIT;
