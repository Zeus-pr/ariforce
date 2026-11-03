-- GENERATED from packages/db/drizzle/0053_login_otp.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0053_login_otp') THEN
    RAISE NOTICE 'skip 0053_login_otp (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- Sign-in OTP (better-auth twoFactor plugin, emailed code only). Additive; re-runnable.
-- Every identity is covered: two_factor_enabled defaults to true. Rollback = leave the API flag
-- LOGIN_OTP off; the column and table are harmless when unused.
ALTER TABLE auth_user ADD COLUMN IF NOT EXISTS two_factor_enabled boolean DEFAULT true NOT NULL;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE IF NOT EXISTS auth_two_factor (
	id text PRIMARY KEY NOT NULL,
	secret text NOT NULL,
	backup_codes text NOT NULL,
	user_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
	verified boolean DEFAULT true NOT NULL,
	failed_verification_count integer DEFAULT 0 NOT NULL,
	locked_until timestamp with time zone
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX IF NOT EXISTS auth_two_factor_user_idx ON auth_two_factor USING btree (user_id);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$-- Identity tables are API-only (same policy as 0005_auth).
ALTER TABLE auth_two_factor ENABLE ROW LEVEL SECURITY;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE auth_two_factor FORCE ROW LEVEL SECURITY;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DROP POLICY IF EXISTS api_only ON auth_two_factor;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE POLICY api_only ON auth_two_factor TO ariforce_app USING (true) WITH CHECK (true);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT SELECT, INSERT, UPDATE, DELETE ON auth_two_factor TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON auth_two_factor FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON auth_two_factor FROM authenticated;
  END IF;
END $$;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0053_login_otp');
END
$ariforce_migration$;
COMMIT;
