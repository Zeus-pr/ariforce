-- GENERATED from packages/db/drizzle/0070_user_date_of_birth.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0070_user_date_of_birth') THEN
    RAISE NOTICE 'skip 0070_user_date_of_birth (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- Employee birthday. Nullable. The daily occasion job reminds the direct manager.
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth date;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0070_user_date_of_birth');
END
$ariforce_migration$;
COMMIT;
