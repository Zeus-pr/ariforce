-- GENERATED from packages/db/drizzle/0057_expense_categories.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0057_expense_categories') THEN
    RAISE NOTICE 'skip 0057_expense_categories (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- Expense categories widened for the monthly statement: courier, mobile, team_meeting,
-- additional_ta_da. Additive and re-runnable (the check is dropped and re-added).
ALTER TABLE "expense_lines" DROP CONSTRAINT IF EXISTS "expense_lines_category_ck";$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "expense_lines" ADD CONSTRAINT "expense_lines_category_ck" CHECK ("category" IN ('travel', 'hotel', 'food', 'mileage', 'allowance', 'courier', 'mobile', 'team_meeting', 'additional_ta_da', 'other'));$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0057_expense_categories');
END
$ariforce_migration$;
COMMIT;
