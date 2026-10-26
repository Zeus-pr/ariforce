-- GENERATED from packages/db/drizzle/0017_users_joined_on.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0017_users_joined_on') THEN
    RAISE NOTICE 'skip 0017_users_joined_on (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- Lead already applied this by hand on the real DB (tracked there as 0010a_users_joined_on); IF NOT EXISTS keeps it a no-op.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "joined_on" date;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0017_users_joined_on');
END
$ariforce_migration$;
COMMIT;
