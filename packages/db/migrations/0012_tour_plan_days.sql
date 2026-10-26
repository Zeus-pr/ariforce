-- GENERATED from packages/db/drizzle/0012_tour_plan_days.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0012_tour_plan_days') THEN
    RAISE NOTICE 'skip 0012_tour_plan_days (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$CREATE TABLE "standard_tour_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"days" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "tour_plans" ADD COLUMN "days" jsonb DEFAULT '[]'::jsonb NOT NULL;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "tour_plans" ADD COLUMN "decision_comment" text;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "standard_tour_plans" ADD CONSTRAINT "standard_tour_plans_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "standard_tour_plans" ADD CONSTRAINT "standard_tour_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE UNIQUE INDEX "standard_tour_plans_user_uq" ON "standard_tour_plans" USING btree ("company_id","user_id");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE standard_tour_plans ENABLE ROW LEVEL SECURITY;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE standard_tour_plans FORCE ROW LEVEL SECURITY;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE POLICY tenant_isolation ON standard_tour_plans TO ariforce_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TRIGGER standard_tour_plans_row_meta BEFORE UPDATE ON standard_tour_plans FOR EACH ROW EXECUTE FUNCTION set_row_meta();$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT SELECT, INSERT, UPDATE ON standard_tour_plans TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON standard_tour_plans FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON standard_tour_plans FROM authenticated;
  END IF;
END $$;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0012_tour_plan_days');
END
$ariforce_migration$;
COMMIT;
