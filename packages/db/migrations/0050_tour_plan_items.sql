-- GENERATED from packages/db/drizzle/0050_tour_plan_items.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0050_tour_plan_items') THEN
    RAISE NOTICE 'skip 0050_tour_plan_items (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- Tour plan items (0050): one-day or from-to plans with the DCR's day fields, approved through
-- approval_requests (entity_type 'tour_plan_item'; the column is text with no check constraint, so
-- no change there). Additive only: a new table and one nullable column on dcrs. KPI views unchanged.
CREATE TABLE IF NOT EXISTS "tour_plan_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "public"."companies"("id"),
	"user_id" uuid NOT NULL REFERENCES "public"."users"("id"),
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"status" "doc_status" DEFAULT 'draft' NOT NULL,
	"plan" jsonb NOT NULL,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decided_by" uuid REFERENCES "public"."users"("id"),
	"decision_comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "tour_plan_items_range_ck" CHECK ("to_date" >= "from_date" AND "to_date" - "from_date" <= 30)
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX IF NOT EXISTS "tour_plan_items_user_idx" ON "tour_plan_items" USING btree ("company_id","user_id","from_date");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX IF NOT EXISTS "tour_plan_items_status_idx" ON "tour_plan_items" USING btree ("company_id","status");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE tour_plan_items ENABLE ROW LEVEL SECURITY;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE tour_plan_items FORCE ROW LEVEL SECURITY;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DROP POLICY IF EXISTS tenant_isolation ON tour_plan_items;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE POLICY tenant_isolation ON tour_plan_items TO ariforce_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DROP TRIGGER IF EXISTS tour_plan_items_row_meta ON tour_plan_items;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TRIGGER tour_plan_items_row_meta BEFORE UPDATE ON tour_plan_items FOR EACH ROW EXECUTE FUNCTION set_row_meta();$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT SELECT, INSERT, UPDATE ON tour_plan_items TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON tour_plan_items FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON tour_plan_items FROM authenticated;
  END IF;
END $$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE dcrs ADD COLUMN IF NOT EXISTS tour_plan_item_id uuid REFERENCES tour_plan_items(id);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX IF NOT EXISTS "dcrs_tour_plan_item_idx" ON "dcrs" USING btree ("tour_plan_item_id") WHERE "tour_plan_item_id" IS NOT NULL;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0050_tour_plan_items');
END
$ariforce_migration$;
COMMIT;
