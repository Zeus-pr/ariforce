-- GENERATED from packages/db/drizzle/0055_dcr_expenses.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0055_dcr_expenses') THEN
    RAISE NOTICE 'skip 0055_dcr_expenses (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- DCR expenses (contract #121). Additive; re-runnable.
--  * dcrs.expenses: the day's expense items [{category, amount, note?}], default [] (old rows = none).
--    Linked into the month claim at DCR submit by the API (origin = 'dcr' lines, 0056).
ALTER TABLE "dcrs" ADD COLUMN IF NOT EXISTS "expenses" jsonb DEFAULT '[]'::jsonb NOT NULL;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "dcrs" DROP CONSTRAINT IF EXISTS "dcrs_expenses_ck";$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "dcrs" ADD CONSTRAINT "dcrs_expenses_ck" CHECK (jsonb_typeof("expenses") = 'array');$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0055_dcr_expenses');
END
$ariforce_migration$;
COMMIT;
