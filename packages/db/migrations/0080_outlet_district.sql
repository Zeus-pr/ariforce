-- GENERATED from packages/db/drizzle/0080_outlet_district.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0080_outlet_district') THEN
    RAISE NOTICE 'skip 0080_outlet_district (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$ALTER TABLE "doctors" ADD COLUMN IF NOT EXISTS "district" text;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "chemists" ADD COLUMN IF NOT EXISTS "district" text;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "stockists" ADD COLUMN IF NOT EXISTS "district" text;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0080_outlet_district');
END
$ariforce_migration$;
COMMIT;
