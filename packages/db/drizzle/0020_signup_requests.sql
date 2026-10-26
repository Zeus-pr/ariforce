-- Self sign-up requests. Idempotent (IF NOT EXISTS / DROP ... IF EXISTS); the generated wrapper also
-- records it in ariforce_migrations. New enum values are not used in this transaction (Postgres
-- forbids that), so status checks below compare ::text.
ALTER TYPE user_status ADD VALUE IF NOT EXISTS 'pending';--> statement-breakpoint
ALTER TYPE user_status ADD VALUE IF NOT EXISTS 'rejected';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS signup_requests (
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
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS signup_requests_status_idx ON signup_requests USING btree (company_id, status);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS signup_requests_pending_user_uq ON signup_requests USING btree (user_id) WHERE status = 'pending';--> statement-breakpoint
ALTER TABLE signup_requests ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE signup_requests FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON signup_requests;--> statement-breakpoint
CREATE POLICY tenant_isolation ON signup_requests TO ariforce_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());--> statement-breakpoint
DROP TRIGGER IF EXISTS signup_requests_row_meta ON signup_requests;--> statement-breakpoint
CREATE TRIGGER signup_requests_row_meta BEFORE UPDATE ON signup_requests FOR EACH ROW EXECUTE FUNCTION set_row_meta();--> statement-breakpoint
REVOKE ALL ON signup_requests FROM PUBLIC;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON signup_requests TO ariforce_app;--> statement-breakpoint
-- Sign-in / session guard run before any tenant context: report only the account status of an
-- identity (no other columns). SECURITY DEFINER, fixed search_path, like auth_resolve_membership.
CREATE OR REPLACE FUNCTION auth_account_status(p_auth_user_id text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.status::text FROM public.users u
  WHERE u.auth_user_id = p_auth_user_id AND u.deleted_at IS NULL LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_account_status(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_account_status(text) TO ariforce_app;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON signup_requests FROM anon;
    REVOKE ALL ON FUNCTION auth_account_status(text) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON signup_requests FROM authenticated;
    REVOKE ALL ON FUNCTION auth_account_status(text) FROM authenticated;
  END IF;
END $$;
