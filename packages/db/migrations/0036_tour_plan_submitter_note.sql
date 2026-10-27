-- GENERATED from packages/db/drizzle/0036_tour_plan_submitter_note.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0036_tour_plan_submitter_note') THEN
    RAISE NOTICE 'skip 0036_tour_plan_submitter_note (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$ALTER TABLE "tour_plans" ADD COLUMN IF NOT EXISTS "submitter_note" text;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0036_tour_plan_submitter_note');
END
$ariforce_migration$;
COMMIT;
