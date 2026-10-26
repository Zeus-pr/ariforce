-- GENERATED from packages/db/drizzle/0020_signup_requests.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0020_signup_requests') THEN
    RAISE NOTICE 'skip 0020_signup_requests (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- Self sign-up requests. Idempotent (IF NOT EXISTS / DROP ... IF EXISTS); the generated wrapper also
-- records it in ariforce_migrations. New enum values are not used in this transaction (Postgres
-- forbids that), so status checks below compare ::text.
ALTER TYPE user_status ADD VALUE IF NOT EXISTS 'pending';$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TYPE user_status ADD VALUE IF NOT EXISTS 'rejected';$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE IF NOT EXISTS signup_requests (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL REFERENCES companies(id),
	"user_id" uuid NOT NULL REFERENCES users(id),
	"requested_role" role_key NOT NULL,
	"requested_territory_id" uuid REFERENCES territories(id),
	"requested_manager_id" uuid REFERENCES users(id),
	"status" text DEFAULT 'pending' NOT NULL,
	"approved_role" role_key,
	"decided_by" uuid REFERENCES users(id),
	"decided_at" timestamp with time zone,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT signup_requests_status_ck CHECK (status IN ('pending', 'approved', 'rejected')),
	CONSTRAINT signup_requests_role_ck CHECK (requested_role::text <> 'system_admin')
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX IF NOT EXISTS signup_requests_status_idx ON signup_requests USING btree (company_id, status);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE UNIQUE INDEX IF NOT EXISTS signup_requests_pending_user_uq ON signup_requests USING btree (user_id) WHERE status = 'pending';$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE signup_requests ENABLE ROW LEVEL SECURITY;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE signup_requests FORCE ROW LEVEL SECURITY;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DROP POLICY IF EXISTS tenant_isolation ON signup_requests;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE POLICY tenant_isolation ON signup_requests TO ariforce_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DROP TRIGGER IF EXISTS signup_requests_row_meta ON signup_requests;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TRIGGER signup_requests_row_meta BEFORE UPDATE ON signup_requests FOR EACH ROW EXECUTE FUNCTION set_row_meta();$ariforce_stmt$;
  EXECUTE $ariforce_stmt$REVOKE ALL ON signup_requests FROM PUBLIC;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT SELECT, INSERT, UPDATE ON signup_requests TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$-- Sign-in / session guard run before any tenant context: report only the account status of an
-- identity (no other columns). SECURITY DEFINER, fixed search_path, like auth_resolve_membership.
CREATE OR REPLACE FUNCTION auth_account_status(p_auth_user_id text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.status::text FROM public.users u
  WHERE u.auth_user_id = p_auth_user_id AND u.deleted_at IS NULL LIMIT 1
$$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$REVOKE ALL ON FUNCTION auth_account_status(text) FROM PUBLIC;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT EXECUTE ON FUNCTION auth_account_status(text) TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON signup_requests FROM anon;
    REVOKE ALL ON FUNCTION auth_account_status(text) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON signup_requests FROM authenticated;
    REVOKE ALL ON FUNCTION auth_account_status(text) FROM authenticated;
  END IF;
END $$;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0020_signup_requests');
END
$ariforce_migration$;
COMMIT;
