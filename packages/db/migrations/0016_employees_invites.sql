-- GENERATED from packages/db/drizzle/0016_employees_invites.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0016_employees_invites') THEN
    RAISE NOTICE 'skip 0016_employees_invites (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$CREATE TABLE "user_invites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "territories" ADD COLUMN "city" text;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "territories" ADD COLUMN "state" text;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "users" ADD COLUMN "designation" text;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "user_invites" ADD CONSTRAINT "user_invites_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "user_invites" ADD CONSTRAINT "user_invites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE UNIQUE INDEX "user_invites_token_uq" ON "user_invites" USING btree ("token_hash");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX "user_invites_user_idx" ON "user_invites" USING btree ("company_id","user_id");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE user_invites ENABLE ROW LEVEL SECURITY;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE user_invites FORCE ROW LEVEL SECURITY;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE POLICY tenant_isolation ON user_invites TO ariforce_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TRIGGER user_invites_row_meta BEFORE UPDATE ON user_invites FOR EACH ROW EXECUTE FUNCTION set_row_meta();$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT SELECT, INSERT, UPDATE ON user_invites TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$-- Public invite acceptance has no tenant context yet: resolve a token hash to (invite, company, user)
-- for a usable invite only. SECURITY DEFINER, minimal output, fixed search_path.
CREATE OR REPLACE FUNCTION invite_resolve(p_token_hash text)
RETURNS TABLE (invite_id uuid, company_id uuid, user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.id, i.company_id, i.user_id FROM public.user_invites i
  JOIN public.users u ON u.id = i.user_id AND u.deleted_at IS NULL AND u.status = 'invited'
  WHERE i.token_hash = p_token_hash AND i.used_at IS NULL AND i.revoked_at IS NULL
    AND i.deleted_at IS NULL AND i.expires_at > now()
  LIMIT 1
$$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$REVOKE ALL ON FUNCTION invite_resolve(text) FROM PUBLIC;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT EXECUTE ON FUNCTION invite_resolve(text) TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON user_invites FROM anon;
    REVOKE ALL ON FUNCTION invite_resolve(text) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON user_invites FROM authenticated;
    REVOKE ALL ON FUNCTION invite_resolve(text) FROM authenticated;
  END IF;
END $$;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0016_employees_invites');
END
$ariforce_migration$;
COMMIT;
