CREATE TABLE "user_invites" (
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
);
--> statement-breakpoint
ALTER TABLE "territories" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "territories" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "designation" text;--> statement-breakpoint
ALTER TABLE "user_invites" ADD CONSTRAINT "user_invites_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invites" ADD CONSTRAINT "user_invites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_invites_token_uq" ON "user_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "user_invites_user_idx" ON "user_invites" USING btree ("company_id","user_id");--> statement-breakpoint
ALTER TABLE user_invites ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE user_invites FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON user_invites TO ariforce_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());--> statement-breakpoint
CREATE TRIGGER user_invites_row_meta BEFORE UPDATE ON user_invites FOR EACH ROW EXECUTE FUNCTION set_row_meta();--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON user_invites TO ariforce_app;--> statement-breakpoint
-- Public invite acceptance has no tenant context yet: resolve a token hash to (invite, company, user)
-- for a usable invite only. SECURITY DEFINER, minimal output, fixed search_path.
CREATE OR REPLACE FUNCTION invite_resolve(p_token_hash text)
RETURNS TABLE (invite_id uuid, company_id uuid, user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.id, i.company_id, i.user_id FROM public.user_invites i
  JOIN public.users u ON u.id = i.user_id AND u.deleted_at IS NULL AND u.status = 'invited'
  WHERE i.token_hash = p_token_hash AND i.used_at IS NULL AND i.revoked_at IS NULL
    AND i.deleted_at IS NULL AND i.expires_at > now()
  LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION invite_resolve(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION invite_resolve(text) TO ariforce_app;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON user_invites FROM anon;
    REVOKE ALL ON FUNCTION invite_resolve(text) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON user_invites FROM authenticated;
    REVOKE ALL ON FUNCTION invite_resolve(text) FROM authenticated;
  END IF;
END $$;
