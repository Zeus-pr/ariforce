-- GENERATED from packages/db/drizzle/0067_doctor_lock_cap.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0067_doctor_lock_cap') THEN
    RAISE NOTICE 'skip 0067_doctor_lock_cap (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- How many active GPS pins a doctor may have. Default 1. ABM and above set 1–5.
-- A deactivated pin does not count. Chemists and stockists stay at one active pin.
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS max_active_locks integer NOT NULL DEFAULT 1;
DO $lockcap$
BEGIN
  ALTER TABLE doctors ADD CONSTRAINT doctors_lock_cap_ck CHECK (max_active_locks BETWEEN 1 AND 5);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$lockcap$;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0067_doctor_lock_cap');
END
$ariforce_migration$;
COMMIT;
