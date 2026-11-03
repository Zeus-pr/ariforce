-- Sign-in OTP (better-auth twoFactor plugin, emailed code only). Additive; re-runnable.
-- Every identity is covered: two_factor_enabled defaults to true. Rollback = leave the API flag
-- LOGIN_OTP off; the column and table are harmless when unused.
ALTER TABLE auth_user ADD COLUMN IF NOT EXISTS two_factor_enabled boolean DEFAULT true NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS auth_two_factor (
	id text PRIMARY KEY NOT NULL,
	secret text NOT NULL,
	backup_codes text NOT NULL,
	user_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
	verified boolean DEFAULT true NOT NULL,
	failed_verification_count integer DEFAULT 0 NOT NULL,
	locked_until timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS auth_two_factor_user_idx ON auth_two_factor USING btree (user_id);
--> statement-breakpoint
-- Identity tables are API-only (same policy as 0005_auth).
ALTER TABLE auth_two_factor ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE auth_two_factor FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS api_only ON auth_two_factor;
--> statement-breakpoint
CREATE POLICY api_only ON auth_two_factor TO ariforce_app USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON auth_two_factor TO ariforce_app;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON auth_two_factor FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON auth_two_factor FROM authenticated;
  END IF;
END $$;
