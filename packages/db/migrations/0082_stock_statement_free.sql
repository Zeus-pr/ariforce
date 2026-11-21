-- GENERATED from packages/db/drizzle/0082_stock_statement_free.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0082_stock_statement_free') THEN
    RAISE NOTICE 'skip 0082_stock_statement_free (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$ALTER TABLE "stock_statement_lines" ADD COLUMN IF NOT EXISTS "free_qty" integer DEFAULT 0 NOT NULL;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "stock_statements" ADD COLUMN IF NOT EXISTS "free_qty" integer DEFAULT 0 NOT NULL;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "stock_statements" ADD COLUMN IF NOT EXISTS "free_value" numeric(14, 2) DEFAULT '0' NOT NULL;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "stock_statement_lines" DROP CONSTRAINT IF EXISTS "stock_statement_lines_qty_ck";$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "stock_statement_lines" ADD CONSTRAINT "stock_statement_lines_qty_ck" CHECK (("stock_statement_lines"."opening_qty" is null or "stock_statement_lines"."opening_qty" >= 0) and "stock_statement_lines"."purchase_qty" >= 0 and "stock_statement_lines"."free_qty" >= 0 and "stock_statement_lines"."secondary_qty" >= 0 and "stock_statement_lines"."frs_qty" >= 0);$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0082_stock_statement_free');
END
$ariforce_migration$;
COMMIT;
